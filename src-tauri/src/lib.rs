mod bridge;
mod remote;
mod runtime;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
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
            bridge::pi_connect,
            bridge::pi_send,
            bridge::pi_disconnect,
            bridge::list_sessions,
            bridge::list_project_files,
            bridge::delete_session,
            bridge::session_turn_durations,
            bridge::open_pi_terminal,
            remote::remote_host_start,
            remote::remote_host_status,
            remote::remote_host_stop
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
