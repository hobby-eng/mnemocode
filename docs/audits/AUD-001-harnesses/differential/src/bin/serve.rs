//! A static file server for AUD-001's browser smoke, on 127.0.0.1 only.
//!
//! Usage: serve <folder> <port>

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;

/// The media type of `path`: a browser refuses a module or a streamed WebAssembly file without it.
fn media_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ending| ending.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let listener = TcpListener::bind(("127.0.0.1", args[1].parse().expect("a port"))).expect("the port");
    for stream in listener.incoming().flatten() {
        let mut stream = stream;
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            continue;
        }
        let path = line.split(' ').nth(1).unwrap_or("/").split('?').next().unwrap_or("/");
        let name = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
        let file = Path::new(&args[0]).join(name);
        let answer = if name.contains("..") { None } else { fs::read(&file).ok() };
        let (status, body) = answer.map_or(("404 Not Found", Vec::new()), |body| ("200 OK", body));
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            media_type(&file),
            body.len()
        );
        let _ = stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(&body));
    }
}
