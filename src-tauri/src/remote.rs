//! LAN transport between an Orbit desktop Host and a Tauri mobile client.
//!
//! The transport mirrors Pi RPC values instead of translating individual Pi
//! event variants. This keeps the protocol forward compatible with the Pi
//! version bundled by Orbit.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: &str = "orbit.remote.v1";

#[derive(Deserialize)]
#[serde(tag = "name")]
enum RemoteHostOperation {
    #[serde(rename = "session.list")]
    SessionList { cwd: String },
    #[serde(rename = "project.files")]
    ProjectFiles { cwd: String },
    #[serde(rename = "session.turnDurations", rename_all = "camelCase")]
    SessionTurnDurations { session_path: String },
    #[serde(rename = "session.delete", rename_all = "camelCase")]
    SessionDelete { session_path: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostInfo {
    pub running: bool,
    pub protocol: &'static str,
    pub host_id: String,
    pub bind_address: String,
    pub advertised_address: String,
    pub port: u16,
    pub token: String,
    pub pairing_uri: String,
}

#[cfg(desktop)]
mod desktop {
    use super::{RemoteHostInfo, PROTOCOL};
    use crate::bridge::Bridge;
    use serde_json::{json, Value};
    use std::{
        collections::{HashMap, HashSet},
        io::{ErrorKind, Read, Write},
        net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc::{self, Receiver, SyncSender, TrySendError},
            Arc, Mutex,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::{AppHandle, Manager, State};
    use tungstenite::{accept_hdr, handshake::server::ErrorResponse, Message};
    use uuid::Uuid;

    const EVENT_BATCH_WINDOW: Duration = Duration::from_millis(16);
    const EVENT_QUEUE_CAPACITY: usize = 4096;
    const CLIENT_QUEUE_CAPACITY: usize = 256;
    const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(25);

    struct Client {
        sender: SyncSender<String>,
        projects: Arc<Mutex<HashSet<String>>>,
    }

    type Clients = Arc<Mutex<HashMap<Uuid, Client>>>;

    struct PiBroadcast {
        project: String,
        payload: Value,
    }

    struct RunningHost {
        info: RemoteHostInfo,
        stop: Arc<AtomicBool>,
        clients: Clients,
        events: SyncSender<PiBroadcast>,
    }

    #[derive(Default)]
    pub struct RemoteHost(Mutex<Option<RunningHost>>);

    impl RemoteHost {
        fn info(&self) -> Option<RemoteHostInfo> {
            self.0.lock().ok()?.as_ref().map(|host| host.info.clone())
        }

        pub fn stop(&self) {
            if let Ok(mut slot) = self.0.lock() {
                if let Some(host) = slot.take() {
                    host.stop.store(true, Ordering::Release);
                    host.clients.lock().ok().map(|mut clients| clients.clear());
                }
            }
        }

        pub fn publish(&self, project: &str, payload: &Value) {
            let Ok(slot) = self.0.lock() else { return };
            let Some(host) = slot.as_ref() else { return };
            let _ = host.events.try_send(PiBroadcast {
                project: project.to_owned(),
                payload: payload.clone(),
            });
            if payload.get("type").and_then(Value::as_str) == Some("response")
                && payload.get("success").and_then(Value::as_bool) == Some(true)
                && matches!(
                    payload.get("command").and_then(Value::as_str),
                    Some("new_session" | "switch_session")
                )
            {
                let _ = host.events.try_send(PiBroadcast {
                project: project.to_owned(),
                payload: serde_json::json!({"type":"connection.invalidated","project":project,"command":payload.get("command").and_then(Value::as_str).unwrap_or_default()}),
            });
            }
        }
    }

    impl Drop for RemoteHost {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn unix_millis() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }

    fn advertised_address(bound: IpAddr) -> String {
        if !bound.is_unspecified() {
            return bound.to_string();
        }
        // Prefer the route to the LAN gateway. A UDP socket connected to a
        // public address can select a Clash/TUN 198.18.x.x interface, which
        // is not reachable from a phone on the local Wi-Fi network.
        if let Ok(output) = std::process::Command::new("route")
            .args(["-n", "get", "default"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(interface) = text
                .lines()
                .find_map(|line| line.trim().strip_prefix("interface: ").map(str::trim))
            {
                if let Ok(address) = std::process::Command::new("ipconfig")
                    .args(["getifaddr", interface])
                    .output()
                {
                    let value = String::from_utf8_lossy(&address.stdout).trim().to_string();
                    if value.parse::<IpAddr>().is_ok() && !value.starts_with("198.18.") {
                        return value;
                    }
                }
            }
        }
        UdpSocket::bind("0.0.0.0:0")
            .and_then(|socket| {
                socket.connect("192.168.1.1:80")?;
                socket.local_addr()
            })
            .map(|address| address.ip().to_string())
            .ok()
            .filter(|address| !address.starts_with("198.18."))
            .unwrap_or_else(|| "127.0.0.1".into())
    }

    fn pairing_uri(address: &str, port: u16, token: &str) -> String {
        format!("orbit://pair?host={address}&port={port}&token={token}&protocol={PROTOCOL}")
    }

    fn broadcast(clients: &Clients, project: &str, frame: String) {
        let Ok(mut clients) = clients.lock() else {
            return;
        };
        clients.retain(|_, client| {
            let subscribed = client
                .projects
                .lock()
                .is_ok_and(|projects| projects.contains(project));
            if !subscribed {
                return true;
            }
            match client.sender.try_send(frame.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
            }
        });
    }

    fn broadcast_loop(receiver: Receiver<PiBroadcast>, clients: Clients, stop: Arc<AtomicBool>) {
        while !stop.load(Ordering::Acquire) {
            let first = match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => event,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let deadline = Instant::now() + EVENT_BATCH_WINDOW;
            let mut projects = HashMap::<String, Vec<Value>>::new();
            projects
                .entry(first.project)
                .or_default()
                .push(first.payload);
            loop {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    break;
                };
                match receiver.recv_timeout(remaining) {
                    Ok(event) => projects
                        .entry(event.project)
                        .or_default()
                        .push(event.payload),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            for (project, payloads) in projects {
                let frame =
                    json!({"type":"pi.events","project":&project,"payloads":payloads}).to_string();
                broadcast(&clients, &project, frame);
            }
        }
    }

    fn authorized(uri: &tungstenite::http::Uri, expected_token: &str) -> bool {
        if uri.path() != "/ws" {
            return false;
        }
        uri.query().is_some_and(|query| {
            query.split('&').any(|field| {
                field
                    .strip_prefix("token=")
                    .is_some_and(|token| token == expected_token)
            })
        })
    }

    fn rejected() -> ErrorResponse {
        tungstenite::http::Response::builder()
            .status(tungstenite::http::StatusCode::UNAUTHORIZED)
            .body(Some("Orbit pairing token is required".into()))
            .expect("static HTTP response")
    }

    fn is_websocket_request(stream: &TcpStream) -> std::io::Result<bool> {
        let mut buffer = [0_u8; 2048];
        let read = stream.peek(&mut buffer)?;
        let request = String::from_utf8_lossy(&buffer[..read]).to_ascii_lowercase();
        Ok(request.contains("upgrade: websocket"))
    }

    fn serve_http(mut stream: TcpStream) {
        let mut request = [0_u8; 2048];
        let _ = stream.read(&mut request);
        let body = json!({"service":"Orbit Host","protocol":PROTOCOL,"running":true}).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = stream.write_all(response.as_bytes());
    }

    fn response(request_id: Option<&str>, result: Result<Value, String>) -> String {
        match result {
            Ok(result) => {
                json!({"type":"remote.result","requestId":request_id,"ok":true,"result":result})
                    .to_string()
            }
            Err(error) => {
                json!({"type":"remote.result","requestId":request_id,"ok":false,"error":error})
                    .to_string()
            }
        }
    }

    fn run_operation(
        app: &AppHandle,
        operation: super::RemoteHostOperation,
    ) -> Result<Value, String> {
        tauri::async_runtime::block_on(async {
            match operation {
                super::RemoteHostOperation::SessionList { cwd } => {
                    crate::bridge::list_sessions(app.clone(), cwd).await
                }
                super::RemoteHostOperation::ProjectFiles { cwd } => {
                    crate::bridge::list_project_files(cwd).await
                }
                super::RemoteHostOperation::SessionTurnDurations { session_path } => {
                    crate::bridge::session_turn_durations(session_path).await
                }
                super::RemoteHostOperation::SessionDelete { session_path } => {
                    crate::bridge::delete_session(session_path)
                        .await
                        .map(|()| Value::Null)
                }
            }
        })
    }

    fn handle_request(
        app: &AppHandle,
        raw: &str,
        attached: &Arc<Mutex<HashSet<String>>>,
    ) -> String {
        let Ok(request) = serde_json::from_str::<Value>(raw) else {
            return json!({"type":"remote.error","error":"消息不是有效 JSON"}).to_string();
        };
        let request_id = request.get("requestId").and_then(Value::as_str);
        match request.get("type").and_then(Value::as_str) {
            Some("host.ping") => {
                json!({"type":"host.pong","requestId":request_id,"serverTime":unix_millis()})
                    .to_string()
            }
            Some("host.snapshot") => response(
                request_id,
                Ok(json!({
                    "protocol": PROTOCOL,
                    "serverTime": unix_millis(),
                    "connections": app.state::<Bridge>().connections(),
                })),
            ),
            Some("host.operation") => {
                let operation = request
                    .get("operation")
                    .cloned()
                    .ok_or_else(|| "host.operation 缺少 operation".to_string())
                    .and_then(|value| {
                        serde_json::from_value::<super::RemoteHostOperation>(value)
                            .map_err(|_| "host.operation 无效".to_string())
                    });
                response(
                    request_id,
                    operation.and_then(|operation| run_operation(app, operation)),
                )
            }
            Some("connection.attach") => {
                let Some(connection_id) = request
                    .get("connectionId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                else {
                    return json!({"type":"remote.error","requestId":request_id,"error":"connection.attach 缺少 connectionId"}).to_string();
                };
                let connection = app
                    .state::<Bridge>()
                    .connections()
                    .into_iter()
                    .find(|connection| connection["id"].as_str() == Some(connection_id));
                if connection.is_some() {
                    if let Ok(mut projects) = attached.lock() {
                        projects.clear();
                        projects.insert(connection_id.to_owned());
                    }
                }
                response(
                    request_id,
                    connection.ok_or_else(|| "桌面连接不存在或已经关闭".into()),
                )
            }
            Some("pi.command") => {
                let Some(project) = request
                    .get("project")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                else {
                    return json!({"type":"remote.error","requestId":request_id,"error":"pi.command 缺少 project"}).to_string();
                };
                let Some(command) = request.get("command").filter(|value| {
                    value.is_object() && value.get("type").and_then(Value::as_str).is_some()
                }) else {
                    return json!({"type":"remote.error","requestId":request_id,"error":"pi.command 缺少有效 command"}).to_string();
                };
                if !attached
                    .lock()
                    .is_ok_and(|projects| projects.contains(project))
                {
                    return json!({"type":"remote.error","requestId":request_id,"error":"请先附着桌面 connection"}).to_string();
                }
                response(
                    request_id,
                    app.state::<Bridge>()
                        .send(project, command.clone())
                        .map(|()| Value::Null),
                )
            }
            _ => json!({"type":"remote.error","requestId":request_id,"error":"不支持的远程消息"})
                .to_string(),
        }
    }

    fn client_loop(
        app: AppHandle,
        stream: TcpStream,
        token: String,
        clients: Clients,
        stop: Arc<AtomicBool>,
        host_id: String,
    ) {
        if is_websocket_request(&stream).ok() != Some(true) {
            serve_http(stream);
            return;
        }
        let expected = token;
        let Ok(mut socket) = accept_hdr(
            stream,
            move |request: &tungstenite::handshake::server::Request, response| {
                if authorized(request.uri(), &expected) {
                    Ok(response)
                } else {
                    Err(rejected())
                }
            },
        ) else {
            return;
        };
        let _ = socket
            .get_mut()
            .set_read_timeout(Some(SOCKET_POLL_INTERVAL));
        let _ = socket.send(Message::text(json!({"type":"host.hello","protocol":PROTOCOL,"hostId":host_id,"serverTime":unix_millis()}).to_string()));
        let client_id = Uuid::new_v4();
        let (outbound, incoming) = mpsc::sync_channel::<String>(CLIENT_QUEUE_CAPACITY);
        let attached = Arc::new(Mutex::new(HashSet::new()));
        if let Ok(mut connected) = clients.lock() {
            connected.insert(
                client_id,
                Client {
                    sender: outbound,
                    projects: attached.clone(),
                },
            );
        }
        while !stop.load(Ordering::Acquire) {
            while let Ok(frame) = incoming.try_recv() {
                if socket.send(Message::text(frame)).is_err() {
                    break;
                }
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    if socket
                        .send(Message::text(handle_request(&app, &text, &attached)))
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(tungstenite::Error::Io(error))
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                    break
                }
                Err(_) => break,
            }
        }
        if let Ok(mut connected) = clients.lock() {
            connected.remove(&client_id);
        }
    }

    pub(super) fn start(
        app: AppHandle,
        bind_address: Option<String>,
        port: Option<u16>,
        state: State<'_, RemoteHost>,
    ) -> Result<RemoteHostInfo, String> {
        if let Some(info) = state.info() {
            return Ok(info);
        }
        let bind_address = bind_address.unwrap_or_else(|| "0.0.0.0".into());
        let address = bind_address
            .parse::<IpAddr>()
            .map_err(|_| "Host 绑定地址无效".to_string())?;
        let listener = TcpListener::bind(SocketAddr::new(address, port.unwrap_or(0)))
            .map_err(|error| format!("启动 Orbit Host 失败：{error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let local = listener.local_addr().map_err(|error| error.to_string())?;
        let advertised_address = advertised_address(local.ip());
        let token = Uuid::new_v4().simple().to_string();
        let host_id = Uuid::new_v4().to_string();
        let info = RemoteHostInfo {
            running: true,
            protocol: PROTOCOL,
            host_id: host_id.clone(),
            bind_address,
            advertised_address: advertised_address.clone(),
            port: local.port(),
            pairing_uri: pairing_uri(&advertised_address, local.port(), &token),
            token: token.clone(),
        };
        let stop = Arc::new(AtomicBool::new(false));
        let clients = Arc::new(Mutex::new(HashMap::new()));
        let (events, event_receiver) = mpsc::sync_channel(EVENT_QUEUE_CAPACITY);
        let broadcast_clients = clients.clone();
        let broadcast_stop = stop.clone();
        thread::spawn(move || broadcast_loop(event_receiver, broadcast_clients, broadcast_stop));
        let accept_clients = clients.clone();
        let accept_stop = stop.clone();
        thread::spawn(move || {
            while !accept_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let app = app.clone();
                        let token = token.clone();
                        let clients = accept_clients.clone();
                        let stop = accept_stop.clone();
                        let host_id = host_id.clone();
                        thread::spawn(move || {
                            client_loop(app, stream, token, clients, stop, host_id)
                        });
                    }
                    Err(error) if error.kind() == ErrorKind::WouldBlock => {
                        thread::sleep(SOCKET_POLL_INTERVAL)
                    }
                    Err(_) => thread::sleep(SOCKET_POLL_INTERVAL),
                }
            }
        });
        let mut slot = state.0.lock().map_err(|error| error.to_string())?;
        *slot = Some(RunningHost {
            info: info.clone(),
            stop,
            clients,
            events,
        });
        Ok(info)
    }

    pub(super) fn status(state: State<'_, RemoteHost>) -> Option<RemoteHostInfo> {
        state.info()
    }

    pub(super) fn stop(state: State<'_, RemoteHost>) {
        state.stop();
    }

    pub(super) fn publish(app: &AppHandle, project: &str, payload: &Value) {
        app.state::<RemoteHost>().publish(project, payload);
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::str::FromStr;

        #[test]
        fn accepts_only_the_websocket_path_and_exact_token() {
            let valid = tungstenite::http::Uri::from_str("/ws?token=secret").unwrap();
            let invalid_path = tungstenite::http::Uri::from_str("/other?token=secret").unwrap();
            let invalid_token = tungstenite::http::Uri::from_str("/ws?token=other").unwrap();
            assert!(authorized(&valid, "secret"));
            assert!(!authorized(&invalid_path, "secret"));
            assert!(!authorized(&invalid_token, "secret"));
        }

        #[test]
        fn pairing_uri_contains_the_negotiated_endpoint() {
            assert_eq!(
                pairing_uri("192.168.1.5", 17777, "abc"),
                "orbit://pair?host=192.168.1.5&port=17777&token=abc&protocol=orbit.remote.v1"
            );
        }
    }
}

#[cfg(desktop)]
pub use desktop::RemoteHost;

#[cfg(mobile)]
#[derive(Default)]
pub struct RemoteHost;

#[cfg(mobile)]
impl RemoteHost {
    pub fn stop(&self) {}
}

#[tauri::command]
pub fn remote_host_start(
    app: tauri::AppHandle,
    bind_address: Option<String>,
    port: Option<u16>,
    state: tauri::State<'_, RemoteHost>,
) -> Result<RemoteHostInfo, String> {
    #[cfg(desktop)]
    {
        desktop::start(app, bind_address, port, state)
    }
    #[cfg(mobile)]
    {
        let _ = (app, bind_address, port, state);
        Err("移动端不能启动 Orbit Host，请连接一台桌面设备".into())
    }
}

#[tauri::command]
pub fn remote_host_status(state: tauri::State<'_, RemoteHost>) -> Option<RemoteHostInfo> {
    #[cfg(desktop)]
    {
        desktop::status(state)
    }
    #[cfg(mobile)]
    {
        let _ = state;
        None
    }
}

#[tauri::command]
pub fn remote_host_stop(state: tauri::State<'_, RemoteHost>) {
    #[cfg(desktop)]
    {
        desktop::stop(state)
    }
    #[cfg(mobile)]
    {
        let _ = state;
    }
}

pub fn publish_pi_event(app: &tauri::AppHandle, project: &str, payload: &Value) {
    #[cfg(desktop)]
    desktop::publish(app, project, payload);
    #[cfg(mobile)]
    let _ = (app, project, payload);
}
