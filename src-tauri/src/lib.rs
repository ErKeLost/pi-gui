mod bridge;
mod mobile_update;
mod remote;
mod runtime;
use tauri::Manager;

/// Finder/Dock-launched apps inherit launchd's minimal PATH, so every shell
/// Pi spawns would miss Homebrew tools like rg and ffmpeg. Normalize once at
/// startup; all child processes inherit the corrected environment. Existing
/// entries keep their order, so user overrides always win.
#[cfg(desktop)]
fn normalize_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut entries: Vec<&str> = current.split(':').collect();
    for dir in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
        if !entries.contains(&dir) {
            entries.push(dir);
        }
    }
    std::env::set_var("PATH", entries.join(":"));
}

/// Run the user's login shell once and capture the PATH it produces, so
/// entries from ~/.zshrc & co (nvm, bun, cargo, npm globals…) reach agent
/// spawns. User dirs come first; the app-inherited PATH fills the gaps.
#[cfg(desktop)]
fn probe_login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let shell = std::env::var("SHELL").ok()?;
    if shell.ends_with("/fish") {
        return None;
    }
    const MARKER: &str = "__PIGUI_PATH__";
    let mut child = Command::new(&shell)
        .args(["-l", "-i", "-c", &format!("printf '{MARKER}%s' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        if child.try_wait().map(|status| status.is_some()).unwrap_or(false) {
            break;
        }
        if start.elapsed() > Duration::from_secs(4) {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let mut stdout = Vec::new();
    child.stdout.take()?.read_to_end(&mut stdout).ok()?;
    let text = String::from_utf8_lossy(&stdout);
    let line = text.lines().find(|line| line.starts_with(MARKER))?;
    let path = &line[MARKER.len()..];
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(desktop)]
fn adopt_login_shell_path() {
    let Some(login) = probe_login_shell_path() else {
        return;
    };
    let current = std::env::var("PATH").unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let merged: Vec<&str> = login
        .split(':')
        .chain(current.split(':'))
        .filter(|dir| !dir.is_empty() && seen.insert(dir.to_string()))
        .collect();
    std::env::set_var("PATH", merged.join(":"));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    {
        normalize_path();
        std::thread::spawn(adopt_login_shell_path);
    }
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile_update::init());
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.on_web_content_process_terminate(|webview| {
        let _ = webview.reload();
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_process::init())?;
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .manage(bridge::Bridge::default())
        .manage(remote::RemoteHost::default())
        .invoke_handler(tauri::generate_handler![
            runtime::runtime_environment,
            bridge::discover,
            bridge::list_provider_models,
            bridge::list_provider_profiles,
            bridge::probe_provider_models,
            bridge::save_provider,
            bridge::sync_provider_models,
            bridge::set_default_model,
            bridge::get_project_trust_mode,
            bridge::set_project_trust_mode,
            bridge::computer_use_key_status,
            bridge::save_computer_use_key,
            bridge::clipboard_file_paths,
            bridge::read_file_attachment,
            bridge::pi_connect,
            bridge::pi_send,
            bridge::pi_disconnect,
            bridge::list_sessions,
            bridge::list_project_files,
            bridge::delete_session,
            bridge::session_turn_durations,
            bridge::open_pi_terminal,
            mobile_update::mobile_update_install,
            mobile_update::mobile_update_probe,
            remote::remote_host_start,
            remote::remote_host_addresses,
            remote::remote_host_status,
            remote::remote_host_stop,
            remote::remote_host_set_theme
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<bridge::Bridge>().stop();
                window.state::<remote::RemoteHost>().stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}
