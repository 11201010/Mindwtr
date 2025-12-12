use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// App name used for config directories and files
const APP_NAME: &str = "mindwtr";
const CONFIG_FILE_NAME: &str = "config.toml";
const DATA_FILE_NAME: &str = "data.json";

#[derive(Debug, Serialize, Deserialize, Default)]
struct LegacyAppConfigJson {
    data_file_path: Option<String>,
    sync_path: Option<String>,
}

#[derive(Debug, Default)]
struct AppConfigToml {
    sync_path: Option<String>,
    sync_backend: Option<String>,
    webdav_url: Option<String>,
    webdav_username: Option<String>,
    webdav_password: Option<String>,
    cloud_url: Option<String>,
    cloud_token: Option<String>,
}

struct QuickAddPending(AtomicBool);

#[tauri::command]
fn consume_quick_add_pending(state: tauri::State<'_, QuickAddPending>) -> bool {
    state.0.swap(false, Ordering::SeqCst)
}

fn get_app_root_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resolve(APP_NAME, BaseDirectory::Config)
        .expect("failed to resolve app config root dir")
}

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    get_app_root_dir(app).join(CONFIG_FILE_NAME)
}

fn get_data_path(app: &tauri::AppHandle) -> PathBuf {
    get_app_root_dir(app).join(DATA_FILE_NAME)
}

fn get_legacy_config_json_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("failed to get legacy app config dir")
        .join("config.json")
}

fn get_legacy_data_json_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to get legacy app data dir")
        .join(DATA_FILE_NAME)
}

fn parse_toml_string_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(stripped) = trimmed.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
        return Some(stripped.replace("\\\"", "\"").replace("\\\\", "\\"));
    }
    if let Some(stripped) = trimmed.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
        return Some(stripped.to_string());
    }
    None
}

fn serialize_toml_string_value(value: &str) -> String {
    // Use TOML basic strings with minimal escaping.
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

fn read_config_toml(path: &Path) -> AppConfigToml {
    let Ok(content) = fs::read_to_string(path) else {
        return AppConfigToml::default();
    };

    let mut config = AppConfigToml::default();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key == "sync_path" {
            config.sync_path = parse_toml_string_value(value);
        } else if key == "sync_backend" {
            config.sync_backend = parse_toml_string_value(value);
        } else if key == "webdav_url" {
            config.webdav_url = parse_toml_string_value(value);
        } else if key == "webdav_username" {
            config.webdav_username = parse_toml_string_value(value);
        } else if key == "webdav_password" {
            config.webdav_password = parse_toml_string_value(value);
        } else if key == "cloud_url" {
            config.cloud_url = parse_toml_string_value(value);
        } else if key == "cloud_token" {
            config.cloud_token = parse_toml_string_value(value);
        }
    }
    config
}

fn write_config_toml(path: &Path, config: &AppConfigToml) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("# Mindwtr desktop config".to_string());
    if let Some(sync_path) = &config.sync_path {
        lines.push(format!("sync_path = {}", serialize_toml_string_value(sync_path)));
    }
    if let Some(sync_backend) = &config.sync_backend {
        lines.push(format!("sync_backend = {}", serialize_toml_string_value(sync_backend)));
    }
    if let Some(webdav_url) = &config.webdav_url {
        lines.push(format!("webdav_url = {}", serialize_toml_string_value(webdav_url)));
    }
    if let Some(webdav_username) = &config.webdav_username {
        lines.push(format!("webdav_username = {}", serialize_toml_string_value(webdav_username)));
    }
    if let Some(webdav_password) = &config.webdav_password {
        lines.push(format!("webdav_password = {}", serialize_toml_string_value(webdav_password)));
    }
    if let Some(cloud_url) = &config.cloud_url {
        lines.push(format!("cloud_url = {}", serialize_toml_string_value(cloud_url)));
    }
    if let Some(cloud_token) = &config.cloud_token {
        lines.push(format!("cloud_token = {}", serialize_toml_string_value(cloud_token)));
    }
    let content = format!("{}\n", lines.join("\n"));
    fs::write(path, content).map_err(|e| e.to_string())
}

fn bootstrap_storage_layout(app: &tauri::AppHandle) -> Result<(), String> {
    let root_dir = get_app_root_dir(app);
    fs::create_dir_all(&root_dir).map_err(|e| e.to_string())?;

    let legacy_config_path = get_legacy_config_json_path(app);
    let legacy_config: LegacyAppConfigJson = if let Ok(content) = fs::read_to_string(&legacy_config_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        LegacyAppConfigJson::default()
    };

    let config_path = get_config_path(app);
    if !config_path.exists() {
        let config = AppConfigToml {
            sync_path: legacy_config.sync_path.clone(),
            ..AppConfigToml::default()
        };
        write_config_toml(&config_path, &config)?;
    }

    let data_path = get_data_path(app);
    if !data_path.exists() {
        if let Some(custom_path) = legacy_config.data_file_path.as_ref() {
            let custom_path = PathBuf::from(custom_path);
            if custom_path.exists() {
                fs::copy(&custom_path, &data_path).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }

        let legacy_data_path = get_legacy_data_json_path(app);
        if legacy_data_path.exists() {
            fs::copy(&legacy_data_path, &data_path).map_err(|e| e.to_string())?;
            return Ok(());
        }

        let initial_data = serde_json::json!({
            "tasks": [],
            "projects": [],
            "settings": {}
        });
        fs::write(&data_path, serde_json::to_string_pretty(&initial_data).unwrap())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn ensure_data_file(app: &tauri::AppHandle) -> Result<(), String> {
    bootstrap_storage_layout(app)
}

#[tauri::command]
fn get_data(app: tauri::AppHandle) -> Result<Value, String> {
    let data_path = get_data_path(&app);
    let content = fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_data(app: tauri::AppHandle, data: Value) -> Result<bool, String> {
    let data_path = get_data_path(&app);
    fs::write(&data_path, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_data_path_cmd(app: tauri::AppHandle) -> String {
    get_data_path(&app).to_string_lossy().to_string()
}

#[tauri::command]
fn get_sync_path(app: tauri::AppHandle) -> Result<String, String> {
    let config = read_config_toml(&get_config_path(&app));
    if let Some(path) = config.sync_path {
        return Ok(path);
    }
    // Default sync path: ~/Sync/{APP_NAME}
    // We try to use a safe home dir, falling back to error if not found
    let home = app.path().home_dir().map_err(|_| "Could not determine home directory for default sync path".to_string())?;
    
    Ok(home.join("Sync")
        .join(APP_NAME)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn set_sync_path(app: tauri::AppHandle, sync_path: String) -> Result<serde_json::Value, String> {
    let config_path = get_config_path(&app);
    
    let mut config = read_config_toml(&config_path);
    config.sync_path = Some(sync_path.clone());
    write_config_toml(&config_path, &config)?;
    
    Ok(serde_json::json!({
        "success": true,
        "path": sync_path
    }))
}

fn normalize_backend(value: &str) -> Option<&str> {
    match value {
        "file" | "webdav" | "cloud" => Some(value),
        _ => None,
    }
}

#[tauri::command]
fn get_sync_backend(app: tauri::AppHandle) -> Result<String, String> {
    let config = read_config_toml(&get_config_path(&app));
    let raw = config.sync_backend.unwrap_or_else(|| "file".to_string());
    Ok(normalize_backend(raw.trim()).unwrap_or("file").to_string())
}

#[tauri::command]
fn set_sync_backend(app: tauri::AppHandle, backend: String) -> Result<bool, String> {
    let Some(normalized) = normalize_backend(backend.trim()) else {
        return Err("Invalid sync backend".to_string());
    };
    let config_path = get_config_path(&app);
    let mut config = read_config_toml(&config_path);
    config.sync_backend = Some(normalized.to_string());
    write_config_toml(&config_path, &config)?;
    Ok(true)
}

#[tauri::command]
fn get_webdav_config(app: tauri::AppHandle) -> Result<Value, String> {
    let config = read_config_toml(&get_config_path(&app));
    Ok(serde_json::json!({
        "url": config.webdav_url.unwrap_or_default(),
        "username": config.webdav_username.unwrap_or_default(),
        "password": config.webdav_password.unwrap_or_default()
    }))
}

#[tauri::command]
fn set_webdav_config(app: tauri::AppHandle, url: String, username: String, password: String) -> Result<bool, String> {
    let url = url.trim().to_string();
    let config_path = get_config_path(&app);
    let mut config = read_config_toml(&config_path);

    if url.is_empty() {
        config.webdav_url = None;
        config.webdav_username = None;
        config.webdav_password = None;
    } else {
        config.webdav_url = Some(url);
        config.webdav_username = Some(username);
        config.webdav_password = Some(password);
    }

    write_config_toml(&config_path, &config)?;
    Ok(true)
}

#[tauri::command]
fn get_cloud_config(app: tauri::AppHandle) -> Result<Value, String> {
    let config = read_config_toml(&get_config_path(&app));
    Ok(serde_json::json!({
        "url": config.cloud_url.unwrap_or_default(),
        "token": config.cloud_token.unwrap_or_default()
    }))
}

#[tauri::command]
fn set_cloud_config(app: tauri::AppHandle, url: String, token: String) -> Result<bool, String> {
    let url = url.trim().to_string();
    let config_path = get_config_path(&app);
    let mut config = read_config_toml(&config_path);

    if url.is_empty() {
        config.cloud_url = None;
        config.cloud_token = None;
    } else {
        config.cloud_url = Some(url);
        config.cloud_token = Some(token);
    }

    write_config_toml(&config_path, &config)?;
    Ok(true)
}


#[tauri::command]
fn read_sync_file(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let sync_path_str = get_sync_path(app)?;
    let sync_file = PathBuf::from(&sync_path_str).join(DATA_FILE_NAME);
    
    if !sync_file.exists() {
        let legacy_sync_file = PathBuf::from(&sync_path_str).join(format!("{}-sync.json", APP_NAME));
        if legacy_sync_file.exists() {
            let content = fs::read_to_string(&legacy_sync_file).map_err(|e| e.to_string())?;
            return serde_json::from_str(&content).map_err(|e| e.to_string());
        }
        // Return empty app data structure if file doesn't exist
        return Ok(serde_json::json!({
            "tasks": [],
            "projects": [],
            "settings": {}
        }));
    }

    let content = fs::read_to_string(&sync_file).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}


#[tauri::command]
fn write_sync_file(app: tauri::AppHandle, data: Value) -> Result<bool, String> {
    let sync_path_str = get_sync_path(app)?;
    let sync_file = PathBuf::from(&sync_path_str).join(DATA_FILE_NAME);

    if let Some(parent) = sync_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&sync_file, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(QuickAddPending(AtomicBool::new(false)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Ensure data file exists on startup
            ensure_data_file(&app.handle()).ok();

            // Build system tray with Quick Add entry.
            let handle = app.handle();
            let quick_add_item = MenuItem::with_id(handle, "quick_add", "Quick Add", true, None::<&str>)?;
            let show_item = MenuItem::with_id(handle, "show", "Show Mindwtr", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(handle, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(handle, &[&quick_add_item, &show_item, &quit_item])?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray.png"))
                .unwrap_or_else(|_| handle.default_window_icon().unwrap().clone());

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "quick_add" => {
                            show_main_and_emit(app);
                        }
                        "show" => {
                            show_main(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(handle)?;

            // Global hotkey for Quick Add.
            handle
                .global_shortcut()
                .on_shortcut("CmdOrCtrl+Shift+Space", move |app, _shortcut, _event| {
                    show_main_and_emit(app);
                })?;
            
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data,
            save_data,
            get_data_path_cmd,
            get_sync_path,
            set_sync_path,
            get_sync_backend,
            set_sync_backend,
            get_webdav_config,
            set_webdav_config,
            get_cloud_config,
            set_cloud_config,
            read_sync_file,
            write_sync_file,
            consume_quick_add_pending
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_main_and_emit(app: &tauri::AppHandle) {
    show_main(app);
    app.state::<QuickAddPending>().0.store(true, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("quick-add", ());
    } else {
        let _ = app.emit("quick-add", ());
    }
}
