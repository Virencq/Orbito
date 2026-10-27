mod agent_profiles;
mod commands;
mod dictation;
mod credential_store;
mod jcode_acp;
mod jcode_model_settings;
mod jcode_instructions;
mod jcode_config_inspector;
mod mcp_manager;
mod skill_installer;
mod skills_cli;
mod voice;

use crate::jcode_acp::JCodeState;
use crate::mcp_manager::MCPManager;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

struct AppLifecycleState { exiting: AtomicBool }

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(true) { let _ = window.hide(); }
        else { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "tray_show", "Show Orbito", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray_hide", "Hide to tray", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or("missing default window icon")?;

    TrayIconBuilder::with_id("orbito-tray")
        .icon(icon)
        .tooltip("Orbito")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main_window(&tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => show_main_window(app),
            "tray_hide" => hide_main_window(app),
            "tray_quit" => {
                if let Some(state) = app.try_state::<JCodeState>() {
                    jcode_acp::shutdown_all(&state);
                }
                if let Some(state) = app.try_state::<AppLifecycleState>() {
                    state.exiting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let jcode_state = JCodeState(Arc::new(Mutex::new(std::collections::HashMap::new())));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { show_main_window(app); }))
        .manage(jcode_state)
        .manage(AppLifecycleState { exiting: AtomicBool::new(false) })
        .manage(MCPManager::new())
        .invoke_handler(tauri::generate_handler![
            jcode_acp::jcode_start_session,
            jcode_acp::jcode_prompt,
            jcode_acp::jcode_permission_response,
            jcode_acp::jcode_cancel,
            jcode_acp::jcode_close_session,
            jcode_acp::jcode_status,
            jcode_acp::jcode_runtime_info,
            jcode_acp::jcode_update_runtime_settings,
            jcode_acp::jcode_doctor,
            jcode_acp::jcode_sync_mcp_config,
            jcode_acp::jcode_read_mcp_config,
            jcode_model_settings::jcode_model_catalog,
            jcode_model_settings::jcode_set_active_model,
            jcode_model_settings::jcode_set_model_effort,
            jcode_instructions::jcode_read_global_instructions,
            jcode_instructions::jcode_save_global_instructions,
            jcode_config_inspector::jcode_inspect_config,
            agent_profiles::save_agent_profile_files,
            commands::list_directory,
            commands::read_text_file,
            commands::write_text_file,
            commands::read_file_base64,
            commands::scan_skill_files,
            commands::search_remote_skills,
            credential_store::mcp_secret_get,
            credential_store::mcp_secret_merge,
            credential_store::mcp_secret_delete,
            skills_cli::skills_cli_search,
            skills_cli::clawhub_install_skill,
            skills_cli::skills_cli_update,
            skills_cli::skills_cli_remove,
            skills_cli::delete_skill_files,
            skills_cli::create_skill_file,
            skill_installer::extract_skill_zip,
            mcp_connect,
            mcp_disconnect,
            mcp_refresh_tools,
            mcp_list_servers,
            mcp_get_status,
            dictation::get_dictation_status,
            dictation::start_dictation,
            dictation::stop_dictation,
            dictation::cancel_dictation,
            dictation::dictation_level,
            dictation::download_dictation_model,
            dictation::cancel_dictation_model_download,
            dictation::verify_dictation_model,
            dictation::mark_dictation_test_passed,
            dictation::delete_dictation_model,
            voice::get_voice_runtime_status,
            voice::download_voice_asset,
            voice::cancel_voice_asset_download,
            voice::delete_voice_asset,
            voice::speak_text,
            voice::stop_speaking,
            voice::start_realtime_voice,
            voice::stop_realtime_voice,
            voice::cancel_realtime_voice,
        ])
        .setup(|app| {
            setup_tray(app).map_err(|e| std::io::Error::other(e.to_string()))?;
            dictation::initialize(app).map_err(std::io::Error::other)?;
            voice::initialize(app).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppLifecycleState>() {
                    if !state.exiting.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[tauri::command]
async fn mcp_connect(state: tauri::State<'_, MCPManager>, name: String, command: String, args: Vec<String>, env: std::collections::HashMap<String, String>) -> Result<mcp_manager::MCPServerStatus, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.connect(&name, &command, &args, &env))
        .await
        .map_err(|e| format!("MCP connect task failed: {e}"))?
}

#[tauri::command]
async fn mcp_disconnect(state: tauri::State<'_, MCPManager>, name: String) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.disconnect(&name))
        .await
        .map_err(|e| format!("MCP disconnect task failed: {e}"))?
}

#[tauri::command]
async fn mcp_refresh_tools(state: tauri::State<'_, MCPManager>, name: String) -> Result<Vec<mcp_manager::MCPTool>, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.refresh_tools(&name))
        .await
        .map_err(|e| format!("MCP refresh task failed: {e}"))?
}

#[tauri::command]
async fn mcp_list_servers(state: tauri::State<'_, MCPManager>) -> Result<Vec<mcp_manager::MCPServerStatus>, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.list_servers())
        .await
        .map_err(|e| format!("MCP list-servers task failed: {e}"))?
}

#[tauri::command]
async fn mcp_get_status(state: tauri::State<'_, MCPManager>, name: String) -> Result<mcp_manager::MCPServerStatus, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.get_status(&name))
        .await
        .map_err(|e| format!("MCP status task failed: {e}"))?
}
