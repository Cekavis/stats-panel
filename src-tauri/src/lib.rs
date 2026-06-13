mod metrics;
mod preferences;
mod providers;

use metrics::{metric_manifest, MetricDefinition};
use preferences::{load_preferences, save_preferences_to_disk, UserPreferences, WindowPreferences};
use providers::{start_hardware_monitor_helper, HardwareMonitorProvider, TelemetryCollector};
use std::{sync::Mutex, thread, time::Duration};
use tauri::{
    menu::MenuBuilder, tray::TrayIconBuilder, App, AppHandle, Emitter, LogicalPosition,
    LogicalSize, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

struct AppState {
    preferences: Mutex<UserPreferences>,
}

#[tauri::command]
fn get_metrics_manifest() -> Vec<MetricDefinition> {
    metric_manifest()
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<UserPreferences, String> {
    state
        .preferences
        .lock()
        .map(|preferences| preferences.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: UserPreferences,
) -> Result<UserPreferences, String> {
    let preferences = sanitize_preferences(preferences);
    apply_window_preferences(&app, &preferences.window)?;
    save_preferences_to_disk(&app, &preferences)?;

    *state
        .preferences
        .lock()
        .map_err(|error| error.to_string())? = preferences.clone();
    Ok(preferences)
}

#[tauri::command]
fn set_window_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WindowPreferences,
) -> Result<WindowPreferences, String> {
    let mut preferences = state
        .preferences
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    preferences.window = sanitize_window_preferences(window);
    apply_window_preferences(&app, &preferences.window)?;
    save_preferences_to_disk(&app, &preferences)?;

    *state
        .preferences
        .lock()
        .map_err(|error| error.to_string())? = preferences.clone();
    Ok(preferences.window)
}

#[tauri::command]
fn request_sensor_permissions() -> String {
    "CPU temperature and power are collected by the bundled sensor helper. If sensors stay unavailable after approving administrator access, the hardware, driver, or firmware may not expose those readings.".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let preferences = sanitize_preferences(load_preferences(&app_handle));

            app.manage(AppState {
                preferences: Mutex::new(preferences.clone()),
            });

            apply_window_preferences(&app_handle, &preferences.window)?;
            setup_window_events(app);
            setup_tray(app)?;
            let hardware_monitor = start_hardware_monitor_helper(&app_handle);
            start_telemetry_loop(app_handle, hardware_monitor);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_metrics_manifest,
            get_preferences,
            save_preferences,
            set_window_preferences,
            request_sensor_permissions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_window_events(app: &mut App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app_handle = app.handle().clone();

    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            save_window_geometry(&app_handle);
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            save_window_geometry(&app_handle);
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        _ => {}
    });
}

fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "Show Stats Panel")
        .text("settings", "Settings")
        .text("quit", "Quit")
        .build()?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Stats Panel")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                let _ = show_settings_window(app);
            }
            "quit" => {
                save_window_geometry(app);
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn show_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "settings");

    if let Some(config) = config {
        WebviewWindowBuilder::from_config(app, config)?.build()?;
    } else {
        WebviewWindowBuilder::new(
            app,
            "settings",
            WebviewUrl::App("index.html?view=settings".into()),
        )
        .title("Stats Panel Settings")
        .inner_size(520.0, 720.0)
        .min_inner_size(420.0, 480.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()?;
    }

    Ok(())
}

fn start_telemetry_loop(app: AppHandle, hardware_monitor: HardwareMonitorProvider) {
    thread::spawn(move || {
        let mut collector = TelemetryCollector::new(hardware_monitor);

        loop {
            let snapshot = collector.collect();
            let _ = app.emit("telemetry-sample", snapshot);

            let interval = app
                .try_state::<AppState>()
                .and_then(|state| {
                    state
                        .preferences
                        .lock()
                        .ok()
                        .map(|preferences| preferences.sample_interval_ms)
                })
                .unwrap_or(1_000)
                .clamp(500, 5_000);
            thread::sleep(Duration::from_millis(interval));
        }
    });
}

fn apply_window_preferences(
    app: &AppHandle,
    preferences: &WindowPreferences,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    window
        .set_size(LogicalSize::new(preferences.width, preferences.height))
        .map_err(|error| error.to_string())?;

    if let (Some(x), Some(y)) = (preferences.x, preferences.y) {
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
    }

    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn save_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let size = window.inner_size().ok();
    let position = window.outer_position().ok();

    let Ok(mut preferences) = state.preferences.lock() else {
        return;
    };

    if let Some(size) = size {
        preferences.window.width = (size.width as f64 / scale_factor).max(320.0);
        preferences.window.height = (size.height as f64 / scale_factor).max(420.0);
    }
    if let Some(position) = position {
        preferences.window.x = Some(position.x as f64 / scale_factor);
        preferences.window.y = Some(position.y as f64 / scale_factor);
    }

    let _ = save_preferences_to_disk(app, &preferences);
}

fn sanitize_preferences(mut preferences: UserPreferences) -> UserPreferences {
    preferences.sample_interval_ms = preferences.sample_interval_ms.clamp(500, 5_000);
    preferences.window = sanitize_window_preferences(preferences.window);
    preferences
}

fn sanitize_window_preferences(mut window: WindowPreferences) -> WindowPreferences {
    window.width = window.width.clamp(320.0, 1_200.0);
    window.height = window.height.clamp(420.0, 1_600.0);
    window
}
