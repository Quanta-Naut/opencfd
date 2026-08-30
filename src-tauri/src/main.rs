#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Handle to the bundled FastAPI backend so we can stop it when the app exits.
struct Backend(Mutex<Option<CommandChild>>);

fn spawn_backend(app: &tauri::AppHandle) -> Option<CommandChild> {
    let sidecar = match app.shell().sidecar("opencfd-backend") {
        Ok(cmd) => cmd,
        Err(err) => {
            eprintln!("[opencfd] no backend sidecar ({err}); expecting a dev backend on :8000");
            return None;
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
                        CommandEvent::Error(err) => eprintln!("[opencfd] backend error: {err}"),
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[opencfd] backend exited: code {:?}", payload.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });
            Some(child)
        }
        Err(err) => {
            eprintln!("[opencfd] failed to start backend sidecar: {err}");
            None
        }
    }
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let pid = child.pid();
            let _ = child.kill();
            eprintln!("[opencfd] backend sidecar stopped (pid {pid})");
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let child = spawn_backend(&app.handle());
            app.manage(Backend(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenCFD");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_backend(app);
        }
    });
}
