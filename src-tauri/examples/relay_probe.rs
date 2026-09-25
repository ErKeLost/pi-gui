//! Reproduces the desktop relay connection outside the app using the same
//! OpenSSL-based transport as relay_loop, to surface handshake errors.
use std::time::Duration;

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    for attempt in 0..3 {
        probe(attempt);
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn probe(attempt: usize) {
    use base64::Engine as _;
    use openssl::ssl::{SslConnector, SslMethod};
    use std::io::{Read, Write};
    use tungstenite::Message;

    let host_id = format!("probe-{}", uuid::Uuid::new_v4().simple());
    let host = "orbit-pi.duckdns.org";
    let port = 8443;
    let path = format!("/relay/host/{host_id}?token=probetoken1234567890");
    println!("[try {attempt}] connecting to wss://{host}:{port}{path}");
    let tcp = match std::net::TcpStream::connect((host, port)) {
        Ok(tcp) => tcp,
        Err(error) => {
            println!("[try {attempt}] connect FAILED: {error}");
            return;
        }
    };
    let mut builder = match SslConnector::builder(SslMethod::tls()) {
        Ok(builder) => builder,
        Err(error) => {
            println!("[try {attempt}] ssl builder FAILED: {error}");
            return;
        }
    };
    if let Some(cert_file) = openssl_probe::probe().cert_file {
        if let Ok(pem) = std::fs::read(cert_file) {
            for cert in openssl::x509::X509::stack_from_pem(&pem)
                .into_iter()
                .flatten()
            {
                let _ = builder.cert_store_mut().add_cert(cert);
            }
        }
    }
    let connector = builder.build();
    let mut tls = match connector.connect(host, tcp) {
        Ok(tls) => tls,
        Err(error) => {
            println!("[try {attempt}] tls FAILED: {error}");
            return;
        }
    };
    println!("[try {attempt}] tls established ({})", tls.ssl().version());
    let nonce = *uuid::Uuid::new_v4().as_bytes();
    let key = base64::engine::general_purpose::STANDARD.encode(nonce);
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: Orbit\r\n\r\n"
    );
    if let Err(error) = tls.write_all(request.as_bytes()) {
        println!("[try {attempt}] upgrade write FAILED: {error}");
        return;
    }
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        match tls.read(&mut chunk) {
            Ok(0) => {
                println!("[try {attempt}] relay closed connection");
                return;
            }
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(error) => {
                println!("[try {attempt}] upgrade read FAILED: {error}");
                return;
            }
        }
        if buffer.windows(4).rposition(|w| w == b"\r\n\r\n").is_some() {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buffer);
    println!(
        "[try {attempt}] relay responded: {}",
        head.lines().next().unwrap_or("")
    );
    if !head.starts_with("HTTP/1.1 101") {
        return;
    }
    let mut socket =
        tungstenite::WebSocket::from_raw_socket(tls, tungstenite::protocol::Role::Client, None);
    let register = serde_json::json!({
        "relay": "register",
        "hostKey": "probe-invalid-key-on-purpose-0000000000000000000000",
        "clientToken": "probetoken1234567890",
    })
    .to_string();
    if socket.send(Message::text(register)).is_err() {
        println!("[try {attempt}] register send FAILED");
        return;
    }
    socket
        .get_mut()
        .get_mut()
        .set_read_timeout(Some(Duration::from_secs(5)))
        .ok();
    match socket.read() {
        Ok(Message::Text(text)) => println!("[try {attempt}] relay replied: {text}"),
        Ok(other) => println!("[try {attempt}] unexpected frame: {other:?}"),
        Err(error) => println!("[try {attempt}] read failed: {error}"),
    }
}
