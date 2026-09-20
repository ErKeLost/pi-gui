//! LAN transport between an Orbit desktop Host and a Tauri mobile client.
//!
//! The transport mirrors Pi RPC values instead of translating individual Pi
//! event variants. This keeps the protocol forward compatible with the Pi
//! version bundled by Orbit.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL: &str = "orbit.remote.v1";

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteTheme {
    #[default]
    Light,
    Dark,
}

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
pub struct RemoteHostAddresses {
    pub lan: String,
    pub tailscale: Option<String>,
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
    pub lan_pairing_uri: String,
    pub relay_pairing_uri: Option<String>,
    pub relay_url: Option<String>,
    pub machine_name: String,
    pub connected_clients: usize,
}

#[cfg(desktop)]
mod desktop {
    use super::{RemoteHostAddresses, RemoteHostInfo, RemoteTheme, PROTOCOL};
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
    use tungstenite::{
        accept_hdr, connect, handshake::server::ErrorResponse, stream::MaybeTlsStream, Message,
    };
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

    struct RelayClient {
        local_id: Uuid,
        attached: Arc<Mutex<HashSet<String>>>,
        incoming: Receiver<String>,
    }

    pub struct RemoteHost {
        running: Mutex<Option<RunningHost>>,
        theme: Mutex<RemoteTheme>,
    }

    impl Default for RemoteHost {
        fn default() -> Self {
            Self {
                running: Mutex::new(None),
                theme: Mutex::new(RemoteTheme::default()),
            }
        }
    }

    impl RemoteHost {
        fn info(&self) -> Option<RemoteHostInfo> {
            let slot = self.running.lock().ok()?;
            let host = slot.as_ref()?;
            let mut info = host.info.clone();
            info.connected_clients = host
                .clients
                .lock()
                .map(|clients| clients.len())
                .unwrap_or(0);
            Some(info)
        }

        fn theme(&self) -> RemoteTheme {
            self.theme.lock().map(|theme| *theme).unwrap_or_default()
        }

        fn set_theme(&self, theme: RemoteTheme) {
            let changed = self.theme.lock().is_ok_and(|mut current| {
                if *current == theme {
                    false
                } else {
                    *current = theme;
                    true
                }
            });
            if !changed {
                return;
            }
            let clients = self
                .running
                .lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|host| host.clients.clone()));
            if let Some(clients) = clients {
                broadcast_all(
                    &clients,
                    json!({"type":"host.theme","theme":theme,"serverTime":unix_millis()})
                        .to_string(),
                );
            }
        }

        pub fn stop(&self) {
            if let Ok(mut slot) = self.running.lock() {
                if let Some(host) = slot.take() {
                    host.stop.store(true, Ordering::Release);
                    host.clients.lock().ok().map(|mut clients| clients.clear());
                }
            }
        }

        pub fn publish(&self, project: &str, payload: &Value) {
            let Ok(slot) = self.running.lock() else {
                return;
            };
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

        pub fn publish_connection_closed(&self, project: &str) {
            let clients = self
                .running
                .lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|host| host.clients.clone()));
            if let Some(clients) = clients {
                broadcast(
                    &clients,
                    project,
                    json!({"type":"connection.closed","project":project}).to_string(),
                );
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

    fn is_tailscale_address(address: &str) -> bool {
        let Ok(IpAddr::V4(address)) = address.parse::<IpAddr>() else {
            return false;
        };
        let octets = address.octets();
        octets[0] == 100 && (64..=127).contains(&octets[1])
    }

    fn tailscale_address_from_text(text: &str) -> Option<String> {
        text.split(|character: char| !(character.is_ascii_digit() || character == '.'))
            .find(|value| is_tailscale_address(value))
            .map(str::to_owned)
    }

    fn command_stdout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
        let mut child = std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return None;
                    }
                    let mut stdout = String::new();
                    child.stdout.take()?.read_to_string(&mut stdout).ok()?;
                    return Some(stdout);
                }
                Ok(None) if started.elapsed() < timeout => {
                    thread::sleep(Duration::from_millis(20));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
    }

    fn tailscale_address() -> Option<String> {
        let mut commands = vec!["tailscale".to_owned()];
        #[cfg(target_os = "macos")]
        commands.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale".to_owned());
        #[cfg(target_os = "windows")]
        commands.push(r"C:\Program Files\Tailscale\tailscale.exe".to_owned());
        commands.into_iter().find_map(|program| {
            command_stdout(&program, &["ip", "-4"], Duration::from_secs(2))
                .and_then(|output| tailscale_address_from_text(&output))
        })
    }

    fn addresses() -> RemoteHostAddresses {
        RemoteHostAddresses {
            lan: advertised_address(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED)),
            tailscale: tailscale_address(),
        }
    }

    fn selected_address(
        mode: Option<&str>,
        detected: &RemoteHostAddresses,
    ) -> Result<String, String> {
        match mode.unwrap_or("lan") {
            "lan" => Ok(detected.lan.clone()),
            "tailscale" => detected.tailscale.clone().ok_or_else(|| {
                "未检测到 Tailscale 地址，请确认 Tailscale 已登录并处于开启状态".into()
            }),
            _ => Err("不支持的移动端连接方式".into()),
        }
    }

    fn pairing_uri(address: &str, port: u16, token: &str) -> String {
        format!("orbit://pair?host={address}&port={port}&token={token}&protocol={PROTOCOL}")
    }

    fn relay_pairing_uri(relay_url: &str, host_id: &str, token: &str) -> String {
        format!(
            "orbit://pair?relay={}&hostId={host_id}&token={token}&protocol={PROTOCOL}",
            percent_encode(relay_url)
        )
    }

    fn percent_encode(value: &str) -> String {
        value.bytes().fold(String::new(), |mut encoded, byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                encoded.push(byte as char);
            } else {
                encoded.push_str(&format!("%{byte:02X}"));
            }
            encoded
        })
    }

    fn machine_name() -> String {
        if let Ok(value) = std::env::var("COMPUTERNAME") {
            if !value.trim().is_empty() {
                return value.trim().to_owned();
            }
        }
        if let Ok(output) = std::process::Command::new("scutil")
            .args(["--get", "LocalHostName"])
            .output()
        {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if !value.is_empty() {
                return value;
            }
        }
        std::env::var("HOSTNAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Orbit Desktop".into())
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

    fn broadcast_all(clients: &Clients, frame: String) {
        let Ok(mut clients) = clients.lock() else {
            return;
        };
        clients.retain(|_, client| match client.sender.try_send(frame.clone()) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
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
                    "theme": app.state::<RemoteHost>().theme(),
                    "machineName": app.state::<RemoteHost>().info().map(|info| info.machine_name).unwrap_or_else(|| "Orbit Desktop".into()),
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
        let _ = socket.send(Message::text(json!({"type":"host.hello","protocol":PROTOCOL,"hostId":host_id,"serverTime":unix_millis(),"theme":app.state::<RemoteHost>().theme(),"machineName":app.state::<RemoteHost>().info().map(|info| info.machine_name).unwrap_or_else(|| "Orbit Desktop".into())}).to_string()));
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

    fn set_relay_timeout(stream: &mut MaybeTlsStream<TcpStream>) {
        let timeout = Some(Duration::from_millis(100));
        match stream {
            MaybeTlsStream::Plain(stream) => {
                let _ = stream.set_read_timeout(timeout);
                let _ = stream.set_write_timeout(timeout);
            }
            MaybeTlsStream::Rustls(stream) => {
                let _ = stream.sock.set_read_timeout(timeout);
                let _ = stream.sock.set_write_timeout(timeout);
            }
            _ => {}
        }
    }

    fn relay_envelope(client_id: &str, data: String) -> Message {
        Message::text(json!({"relay":"frame","clientId":client_id,"data":data}).to_string())
    }

    fn add_relay_client(
        app: &AppHandle,
        client_id: &str,
        host_id: &str,
        clients: &Clients,
        relay_clients: &mut HashMap<String, RelayClient>,
    ) -> Option<Message> {
        if let Some(previous) = relay_clients.remove(client_id) {
            clients.lock().ok()?.remove(&previous.local_id);
        }
        let (outbound, incoming) = mpsc::sync_channel::<String>(CLIENT_QUEUE_CAPACITY);
        let attached = Arc::new(Mutex::new(HashSet::new()));
        let local_id = Uuid::new_v4();
        clients.lock().ok()?.insert(
            local_id,
            Client {
                sender: outbound,
                projects: attached.clone(),
            },
        );
        relay_clients.insert(
            client_id.to_owned(),
            RelayClient {
                local_id,
                attached,
                incoming,
            },
        );
        Some(relay_envelope(client_id, json!({
            "type":"host.hello",
            "protocol":PROTOCOL,
            "hostId":host_id,
            "serverTime":unix_millis(),
            "theme":app.state::<RemoteHost>().theme(),
            "machineName":app.state::<RemoteHost>().info().map(|info| info.machine_name).unwrap_or_else(|| "Orbit Desktop".into())
        }).to_string()))
    }

    fn clear_relay_clients(clients: &Clients, relay_clients: &mut HashMap<String, RelayClient>) {
        if let Ok(mut connected) = clients.lock() {
            for relay_client in relay_clients.values() {
                connected.remove(&relay_client.local_id);
            }
        }
        relay_clients.clear();
    }

    fn relay_loop(
        app: AppHandle,
        relay_url: String,
        host_id: String,
        token: String,
        clients: Clients,
        stop: Arc<AtomicBool>,
    ) {
        let endpoint = format!(
            "{}/relay/host/{host_id}?token={token}",
            relay_url.trim_end_matches('/')
        );
        while !stop.load(Ordering::Acquire) {
            let Ok((mut socket, _)) = connect(endpoint.as_str()) else {
                thread::sleep(Duration::from_secs(2));
                continue;
            };
            set_relay_timeout(socket.get_mut());
            let mut relay_clients = HashMap::<String, RelayClient>::new();
            while !stop.load(Ordering::Acquire) {
                let outbound = relay_clients
                    .iter()
                    .flat_map(|(client_id, client)| {
                        client
                            .incoming
                            .try_iter()
                            .map(move |data| (client_id.clone(), data))
                    })
                    .collect::<Vec<_>>();
                let mut failed = false;
                for (client_id, data) in outbound {
                    if socket.send(relay_envelope(&client_id, data)).is_err() {
                        failed = true;
                        break;
                    }
                }
                if failed {
                    break;
                }
                match socket.read() {
                    Ok(Message::Text(text)) => {
                        let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                            continue;
                        };
                        let Some(client_id) = frame.get("clientId").and_then(Value::as_str) else {
                            continue;
                        };
                        match frame.get("relay").and_then(Value::as_str) {
                            Some("connect") => {
                                if let Some(hello) = add_relay_client(
                                    &app,
                                    client_id,
                                    &host_id,
                                    &clients,
                                    &mut relay_clients,
                                ) {
                                    if socket.send(hello).is_err() {
                                        break;
                                    }
                                }
                            }
                            Some("disconnect") => {
                                if let Some(client) = relay_clients.remove(client_id) {
                                    clients
                                        .lock()
                                        .ok()
                                        .map(|mut connected| connected.remove(&client.local_id));
                                }
                            }
                            Some("frame") => {
                                if !relay_clients.contains_key(client_id) {
                                    if let Some(hello) = add_relay_client(
                                        &app,
                                        client_id,
                                        &host_id,
                                        &clients,
                                        &mut relay_clients,
                                    ) {
                                        if socket.send(hello).is_err() {
                                            break;
                                        }
                                    }
                                }
                                let Some(data) = frame.get("data").and_then(Value::as_str) else {
                                    continue;
                                };
                                let Some(client) = relay_clients.get(client_id) else {
                                    continue;
                                };
                                let response = handle_request(&app, data, &client.attached);
                                if socket.send(relay_envelope(client_id, response)).is_err() {
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        if socket.send(Message::Pong(payload)).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(error))
                        if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                    Err(_) => break,
                }
            }
            clear_relay_clients(&clients, &mut relay_clients);
            thread::sleep(Duration::from_secs(1));
        }
    }

    pub(super) fn start(
        app: AppHandle,
        bind_address: Option<String>,
        address_mode: Option<String>,
        port: Option<u16>,
        relay_url: Option<String>,
        state: State<'_, RemoteHost>,
    ) -> Result<RemoteHostInfo, String> {
        if let Some(info) = state.info() {
            return Ok(info);
        }
        if relay_url.is_some() {
            return Err("公网 Relay 尚未开放，请使用局域网或 Tailscale".into());
        }
        let detected_addresses = addresses();
        let explicit_mode = address_mode.is_some();
        if explicit_mode
            && address_mode.as_deref() == Some("lan")
            && detected_addresses.lan == "127.0.0.1"
        {
            return Err("未检测到可供手机连接的局域网地址".into());
        }
        let advertised_address = if explicit_mode {
            selected_address(address_mode.as_deref(), &detected_addresses)?
        } else if let Some(bound) = bind_address.as_deref() {
            let bound = bound
                .parse::<IpAddr>()
                .map_err(|_| "Host 绑定地址无效".to_string())?;
            advertised_address(bound)
        } else {
            detected_addresses.lan
        };
        let bind_address = bind_address.unwrap_or_else(|| {
            if explicit_mode {
                advertised_address.clone()
            } else {
                "0.0.0.0".into()
            }
        });
        let address = bind_address
            .parse::<IpAddr>()
            .map_err(|_| "Host 绑定地址无效".to_string())?;
        if explicit_mode && address.to_string() != advertised_address {
            return Err("Host 绑定地址必须与所选连接方式一致".into());
        }
        let listener = TcpListener::bind(SocketAddr::new(address, port.unwrap_or(0)))
            .map_err(|error| format!("启动 Orbit Host 失败：{error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let local = listener.local_addr().map_err(|error| error.to_string())?;
        let token = Uuid::new_v4().simple().to_string();
        let host_id = Uuid::new_v4().to_string();
        let relay_url = relay_url
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| value.starts_with("wss://") || value.starts_with("ws://"));
        let lan_pairing_uri = pairing_uri(&advertised_address, local.port(), &token);
        let relay_pairing_uri = relay_url
            .as_ref()
            .map(|url| relay_pairing_uri(url, &host_id, &token));
        let info = RemoteHostInfo {
            running: true,
            protocol: PROTOCOL,
            host_id: host_id.clone(),
            bind_address,
            advertised_address: advertised_address.clone(),
            port: local.port(),
            pairing_uri: relay_pairing_uri
                .clone()
                .unwrap_or_else(|| lan_pairing_uri.clone()),
            lan_pairing_uri,
            relay_pairing_uri,
            relay_url: relay_url.clone(),
            token: token.clone(),
            machine_name: machine_name(),
            connected_clients: 0,
        };
        let stop = Arc::new(AtomicBool::new(false));
        let clients = Arc::new(Mutex::new(HashMap::new()));
        let (events, event_receiver) = mpsc::sync_channel(EVENT_QUEUE_CAPACITY);
        let broadcast_clients = clients.clone();
        let broadcast_stop = stop.clone();
        thread::spawn(move || broadcast_loop(event_receiver, broadcast_clients, broadcast_stop));
        let accept_clients = clients.clone();
        let accept_stop = stop.clone();
        let accept_app = app.clone();
        let accept_token = token.clone();
        let accept_host_id = host_id.clone();
        let relay_args = relay_url.map(|relay_url| {
            (
                app.clone(),
                relay_url,
                info.host_id.clone(),
                info.token.clone(),
                clients.clone(),
                stop.clone(),
            )
        });
        let mut slot = state.running.lock().map_err(|error| error.to_string())?;
        *slot = Some(RunningHost {
            info: info.clone(),
            stop,
            clients,
            events,
        });
        drop(slot);
        thread::spawn(move || {
            while !accept_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let app = accept_app.clone();
                        let token = accept_token.clone();
                        let clients = accept_clients.clone();
                        let stop = accept_stop.clone();
                        let host_id = accept_host_id.clone();
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
        if let Some((relay_app, relay_url, relay_host_id, relay_token, relay_clients, relay_stop)) =
            relay_args
        {
            thread::spawn(move || {
                relay_loop(
                    relay_app,
                    relay_url,
                    relay_host_id,
                    relay_token,
                    relay_clients,
                    relay_stop,
                )
            });
        }
        Ok(info)
    }

    pub(super) fn addresses_command() -> RemoteHostAddresses {
        addresses()
    }

    pub(super) fn status(state: State<'_, RemoteHost>) -> Option<RemoteHostInfo> {
        state.info()
    }

    pub(super) fn stop(state: State<'_, RemoteHost>) {
        state.stop();
    }

    pub(super) fn set_theme(theme: RemoteTheme, state: State<'_, RemoteHost>) {
        state.set_theme(theme);
    }

    pub(super) fn publish(app: &AppHandle, project: &str, payload: &Value) {
        app.state::<RemoteHost>().publish(project, payload);
    }

    pub(super) fn publish_connection_closed(app: &AppHandle, project: &str) {
        app.state::<RemoteHost>().publish_connection_closed(project);
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

        #[test]
        fn recognizes_only_the_tailscale_cgnat_range() {
            assert!(is_tailscale_address("100.64.0.1"));
            assert!(is_tailscale_address("100.127.255.254"));
            assert!(!is_tailscale_address("100.128.0.1"));
            assert!(!is_tailscale_address("192.168.1.20"));
            assert_eq!(
                tailscale_address_from_text("100.82.7.9\n"),
                Some("100.82.7.9".into())
            );
        }

        #[test]
        fn selected_address_accepts_only_known_connection_modes() {
            let detected = RemoteHostAddresses {
                lan: "192.168.1.20".into(),
                tailscale: Some("100.82.7.9".into()),
            };
            assert_eq!(selected_address(None, &detected).unwrap(), "192.168.1.20");
            assert_eq!(
                selected_address(Some("lan"), &detected).unwrap(),
                "192.168.1.20"
            );
            assert_eq!(
                selected_address(Some("tailscale"), &detected).unwrap(),
                "100.82.7.9"
            );
            assert!(selected_address(Some("relay"), &detected).is_err());
            let without_tailscale = RemoteHostAddresses {
                lan: detected.lan,
                tailscale: None,
            };
            assert!(selected_address(Some("tailscale"), &without_tailscale).is_err());
        }

        #[test]
        fn theme_is_retained_before_the_host_starts() {
            let host = RemoteHost::default();
            assert_eq!(host.theme(), RemoteTheme::Light);
            host.set_theme(RemoteTheme::Dark);
            assert_eq!(host.theme(), RemoteTheme::Dark);
            host.stop();
            assert_eq!(host.theme(), RemoteTheme::Dark);
        }

        #[test]
        fn theme_broadcast_reaches_clients_before_project_attachment() {
            let (sender, receiver) = mpsc::sync_channel(1);
            let clients = Arc::new(Mutex::new(HashMap::from([(
                Uuid::new_v4(),
                Client {
                    sender,
                    projects: Arc::new(Mutex::new(HashSet::new())),
                },
            )])));
            broadcast_all(
                &clients,
                json!({"type":"host.theme","theme":"dark"}).to_string(),
            );
            let frame = receiver.try_recv().expect("theme frame");
            assert_eq!(
                serde_json::from_str::<Value>(&frame).unwrap()["theme"],
                "dark"
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
    address_mode: Option<String>,
    port: Option<u16>,
    relay_url: Option<String>,
    state: tauri::State<'_, RemoteHost>,
) -> Result<RemoteHostInfo, String> {
    #[cfg(desktop)]
    {
        desktop::start(app, bind_address, address_mode, port, relay_url, state)
    }
    #[cfg(mobile)]
    {
        let _ = (app, bind_address, address_mode, port, relay_url, state);
        Err("移动端不能启动 Orbit Host，请连接一台桌面设备".into())
    }
}

#[tauri::command]
pub fn remote_host_addresses() -> RemoteHostAddresses {
    #[cfg(desktop)]
    {
        desktop::addresses_command()
    }
    #[cfg(mobile)]
    {
        RemoteHostAddresses {
            lan: "127.0.0.1".into(),
            tailscale: None,
        }
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

#[tauri::command]
pub fn remote_host_set_theme(theme: RemoteTheme, state: tauri::State<'_, RemoteHost>) {
    #[cfg(desktop)]
    desktop::set_theme(theme, state);
    #[cfg(mobile)]
    let _ = (theme, state);
}

pub fn publish_pi_event(app: &tauri::AppHandle, project: &str, payload: &Value) {
    #[cfg(desktop)]
    desktop::publish(app, project, payload);
    #[cfg(mobile)]
    let _ = (app, project, payload);
}

pub fn publish_connection_closed(app: &tauri::AppHandle, project: &str) {
    #[cfg(desktop)]
    desktop::publish_connection_closed(app, project);
    #[cfg(mobile)]
    let _ = (app, project);
}
