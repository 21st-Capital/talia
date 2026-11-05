//! A TLS front for a plain Electrum server (tier C, BDK upgrade, decided 2026-10-15).
//!
//!   talia-tierc-tls-proxy <listen port> <certificate pem> <signing key pem> <upstream host:port>
//!
//! Presents the certificate and signs every handshake with the given key, which is the
//! certificate's own key or, for the handshake-signature case, an unrelated one (as someone in
//! the middle without the server's key would have to). TLS 1.2 and 1.3. After the handshake the
//! bytes are copied both ways to the upstream server. Test certificates and keys only.
use rustls::crypto::ring::default_provider;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug)]
struct FixedCert(Arc<CertifiedKey>);

impl ResolvesServerCert for FixedCert {
    fn resolve(&self, _: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        Some(Arc::clone(&self.0))
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: talia-tierc-tls-proxy <port> <cert.pem> <key.pem> <upstream>");
        std::process::exit(64);
    }
    let cert_pem = std::fs::read(&args[2]).expect("certificate");
    let key_pem = std::fs::read(&args[3]).expect("key");
    let provider = Arc::new(default_provider());
    let cert = CertificateDer::from_pem_slice(&cert_pem).expect("certificate pem");
    let key = provider
        .key_provider
        .load_private_key(PrivateKeyDer::from_pem_slice(&key_pem).expect("key pem"))
        .expect("key");
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("versions")
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(FixedCert(Arc::new(CertifiedKey::new(vec![cert], key)))));
    let config = Arc::new(config);
    let upstream = args[4].clone();
    let listener = TcpListener::bind(format!("127.0.0.1:{}", args[1])).expect("bind");
    eprintln!("listening on 127.0.0.1:{}", args[1]);
    for tcp in listener.incoming().flatten() {
        let config = Arc::clone(&config);
        let upstream = upstream.clone();
        thread::spawn(move || {
            let _ = serve(config, tcp, &upstream);
        });
    }
}

fn serve(config: Arc<ServerConfig>, tcp: TcpStream, upstream: &str) -> io::Result<()> {
    let conn = ServerConnection::new(config).map_err(io::Error::other)?;
    let mut tls = StreamOwned::new(conn, tcp);
    // Finish the handshake before anything else; a refused one ends here.
    while tls.conn.is_handshaking() {
        tls.conn.complete_io(&mut tls.sock)?;
    }
    let up = TcpStream::connect(upstream)?;
    let up_read = up.try_clone()?;
    let tls = Arc::new(Mutex::new(tls));
    tls.lock().unwrap().sock.set_read_timeout(Some(Duration::from_millis(20)))?;
    // upstream -> client
    let t2 = Arc::clone(&tls);
    let pump = thread::spawn(move || {
        let mut up_read = up_read;
        let mut buf = [0u8; 16384];
        loop {
            match up_read.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut t = t2.lock().unwrap();
                    if t.write_all(&buf[..n]).and_then(|_| t.flush()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    // client -> upstream
    let mut up = up;
    let mut buf = [0u8; 16384];
    loop {
        let r = { tls.lock().unwrap().read(&mut buf) };
        match r {
            Ok(0) => break,
            Ok(n) => up.write_all(&buf[..n])?,
            // Nothing from the client yet: let the other direction have the stream (a
            // mutex is not fair, and a tight loop here starved the answers on their way back).
            Err(e) if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut => {
                thread::sleep(Duration::from_millis(2));
                continue;
            }
            Err(_) => break,
        }
    }
    let _ = up.shutdown(Shutdown::Both);
    let _ = pump.join();
    Ok(())
}
