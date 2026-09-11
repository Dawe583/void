#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod downloads;
mod keychain;
use base64::Engine;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Runtime(Mutex<Child>);

impl Runtime {
    fn stop(&self) {
        if let Ok(mut child) = self.0.lock() {
            // Closing the ownership pipe asks Node to cancel sessions and close its server.
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(serde::Deserialize)]
struct Ready {
    port: u16,
}

fn launch_runtime(
    resources: PathBuf,
    data: PathBuf,
    smoke: bool,
) -> Result<(Runtime, u16), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700))?;
    }
    let workspace_key = if smoke {
        keychain::ephemeral()?
    } else {
        #[cfg(target_os = "macos")]
        {
            keychain::load_or_create(
                &data,
                &keychain::MacKeychain {
                    account: data.to_string_lossy().into_owned(),
                },
            )?
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("Native workspace key storage is currently supported on macOS only".into());
        }
    };
    let node = resources
        .join("bin")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.join("desktop-runtime.log"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        log.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    let mut search_path = vec![resources.join("bin")];
    search_path.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let mut child = Command::new(node)
        .arg(resources.join("runtime/runtime.mjs"))
        .current_dir(&data)
        .env("VOID_DATA_DIR", &data)
        .env(
            "VOID_WORKSPACE_KEY",
            base64::engine::general_purpose::STANDARD.encode(&workspace_key.bytes),
        )
        .env("PATH", std::env::join_paths(search_path)?)
        .env("VOID_DESKTOP_WEB_ROOT", resources.join("web"))
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("VOID_CONTROL_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()?;
    let stdout = child.stdout.take().ok_or("Runtime stdout missing")?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut lines = BufReader::new(stdout).lines();
        let ready = lines
            .next()
            .ok_or("Runtime exited before readiness".to_owned())
            .and_then(|line| line.map_err(|error| error.to_string()));
        let _ = sender.send(ready);
        // Keep stdout drained; the first line is the only startup protocol message.
        for _ in lines {}
    });
    let runtime = Runtime(Mutex::new(child));
    let line = receiver.recv_timeout(Duration::from_secs(30))??;
    let ready: Ready = serde_json::from_str(&line)?;
    if ready.port == 0 {
        return Err("Runtime returned an invalid port".into());
    }
    workspace_key.finish_migration()?;
    Ok((runtime, ready.port))
}

fn main() {
    let smoke = std::env::args().any(|argument| argument == "--smoke-test");
    let smoke_data =
        std::env::temp_dir().join(format!("void-desktop-native-smoke-{}", std::process::id()));
    let cleanup_data = smoke_data.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let resources = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?.join("resources")
            };
            let data = if smoke {
                smoke_data.clone()
            } else {
                app.path().app_data_dir()?
            };
            let (runtime, port) = launch_runtime(resources, data.clone(), smoke)?;
            app.manage(runtime);
            let origin = format!("http://127.0.0.1:{port}");
            if smoke {
                let mut socket = std::net::TcpStream::connect(("127.0.0.1", port))?;
                socket.set_read_timeout(Some(Duration::from_secs(10)))?;
                write!(
                    socket,
                    "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                )?;
                let mut response = String::new();
                socket.take(1_048_576).read_to_string(&mut response)?;
                if !response.starts_with("HTTP/1.1 200") || !response.contains("VOID") {
                    return Err("Packaged desktop runtime did not serve the workbench".into());
                }
                let timeout_app = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(20));
                    eprintln!("VOID native desktop smoke timed out waiting for the webview download.");
                    timeout_app.exit(1);
                });
            }
            let allowed = origin.clone();
            let download_origin = origin.clone();
            let download_root = if smoke { data.clone() } else { app.path().download_dir()? };
            std::fs::create_dir_all(&download_root)?;
            let smoke_file = data.join("void-desktop-download-smoke.txt");
            let finish_file = smoke_file.clone();
            let download_app = app.handle().clone();
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("{origin}/").parse()?),
            )
            .title("VOID")
            .visible(!smoke)
            .inner_size(1200.0, 820.0)
            .min_inner_size(360.0, 520.0)
            .on_navigation(move |url| url.origin().ascii_serialization() == allowed)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(move |_, event| {
                match event {
                    tauri::webview::DownloadEvent::Requested { url, destination } => {
                        if !downloads::allowed(&url, &download_origin) { return false; }
                        if smoke { *destination = smoke_file.clone(); }
                        // Wry picks a collision-free filename in Downloads. Keep it
                        // confined there rather than accepting arbitrary paths.
                        destination.parent() == Some(download_root.as_path())
                    }
                    tauri::webview::DownloadEvent::Finished { success, .. } => {
                        if smoke {
                            let correct = success && std::fs::read(&finish_file).ok().as_deref() == Some(b"VOID desktop download smoke");
                            if correct { println!("VOID native desktop smoke passed: bundled runtime, rendered WKWebView and Blob download verified."); }
                            else { eprintln!("VOID native desktop smoke failed: Blob export was not saved correctly."); }
                            download_app.exit(if correct { 0 } else { 1 });
                        }
                        true
                    }
                    _ => false,
                }
            })
            .on_page_load(move |window, payload| {
                if smoke && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    // Exercise the same browser Blob + anchor.download mechanism
                    // as the production document and conversation export buttons.
                    let _ = window.eval("(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['VOID desktop download smoke'], {type: 'text/plain'})); a.download = 'void-desktop-download-smoke.txt'; document.body.appendChild(a); a.click(); a.remove(); })()");
                }
            })
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect(
            "Could not start VOID. Inspect desktop-runtime.log in the application data directory.",
        );
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            app.state::<Runtime>().stop();
        }
    });
    if smoke {
        let _ = std::fs::remove_dir_all(cleanup_data);
    }
}
