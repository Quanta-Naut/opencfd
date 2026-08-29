#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// Spawn the bundled FastAPI backend (PyInstaller sidecar) and keep it tied to
// the app's lifetime. In `tauri dev` there is no sidecar - run `python run.py`.
fn spawn_backend(app: &tauri::AppHandle) {
    let sidecar = match app.shell().sidecar("opencfd-backend") {
        Ok(cmd) => cmd,
        Err(err) => {
            eprintln!("[opencfd] no backend sidecar ({err}); expecting a dev backend on :8000");
            return;
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            eprintln!("[opencfd] backend sidecar started (pid {})", child.pid());
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[opencfd] backend error: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[opencfd] backend exited: code {:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(err) => eprintln!("[opencfd] failed to start backend sidecar: {err}"),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            spawn_backend(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenCFD");
}
