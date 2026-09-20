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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    normalize_path();
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
            remote::remote_host_start,
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
