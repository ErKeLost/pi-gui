mod bridge;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![bridge::discover, bridge::list_provider_models, bridge::list_provider_profiles, bridge::probe_provider_models, bridge::save_provider, bridge::sync_provider_models, bridge::get_project_trust_mode, bridge::set_project_trust_mode, bridge::pi_connect, bridge::pi_send, bridge::pi_disconnect, bridge::list_sessions, bridge::list_project_files, bridge::delete_session, bridge::open_pi_terminal])
        .on_window_event(|window,event| { if let tauri::WindowEvent::Destroyed = event { window.state::<bridge::Bridge>().stop(); } })
        .run(tauri::generate_context!())
        .expect("error while running Pi GUI");
}
