mod metrics;
mod preferences;
mod providers;

use metrics::{metric_manifest, MetricDefinition};
use preferences::{
    load_preferences, save_preferences_to_disk, ThemeColors, UserPreferences, WindowPreferences,
    DEFAULT_CPU_COLOR, DEFAULT_DISK_COLOR, DEFAULT_GPU_COLOR, DEFAULT_LIGHT_CARD_BACKGROUND,
    DEFAULT_MEMORY_COLOR, DEFAULT_NETWORK_COLOR,
};
use providers::{start_hardware_monitor_helper, HardwareMonitorProvider, TelemetryCollector};
use std::{sync::Mutex, thread, time::Duration};
use tauri::{
    menu::MenuBuilder, tray::TrayIconBuilder, App, AppHandle, Emitter, LogicalPosition,
    LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

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
    save_window_geometry(&app);

    let mut preferences = sanitize_preferences(preferences);
    let current_window = state
        .preferences
        .lock()
        .map_err(|error| error.to_string())?
        .window
        .clone();
    preferences.window.width = current_window.width;
    preferences.window.height = current_window.height;
    preferences.window.x = current_window.x;
    preferences.window.y = current_window.y;

    apply_window_options(&app, &preferences.window)?;
    apply_startup_preference(&app, preferences.launch_at_startup)?;
    save_preferences_to_disk(&app, &preferences)?;

    *state
        .preferences
        .lock()
        .map_err(|error| error.to_string())? = preferences.clone();
    let _ = app.emit("preferences-updated", preferences.clone());
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
    let _ = app.emit("preferences-updated", preferences.clone());
    Ok(preferences.window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let preferences = sanitize_preferences(load_preferences(&app_handle));

            app.manage(AppState {
                preferences: Mutex::new(preferences.clone()),
            });

            apply_window_preferences(&app_handle, &preferences.window)?;
            save_window_geometry(&app_handle);
            let _ = apply_startup_preference(&app_handle, preferences.launch_at_startup);
            setup_window_events(app);
            setup_tray(app)?;
            let hardware_monitor = start_hardware_monitor_helper();
            app.manage(hardware_monitor.clone());
            start_telemetry_loop(app_handle, hardware_monitor);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_metrics_manifest,
            get_preferences,
            save_preferences,
            set_window_preferences
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                stop_hardware_monitor_helper(app);
            }
        });
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
                show_main_window(app);
            }
            "settings" => {
                let _ = show_settings_window(app);
            }
            "quit" => {
                save_window_geometry(app);
                stop_hardware_monitor_helper(app);
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn stop_hardware_monitor_helper(app: &AppHandle) {
    if let Some(provider) = app.try_state::<HardwareMonitorProvider>() {
        provider.stop();
    }
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

    if !window_is_visible(&window) {
        window.center().map_err(|error| error.to_string())?;
    }

    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn apply_window_options(app: &AppHandle, preferences: &WindowPreferences) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn apply_startup_preference(app: &AppHandle, launch_at_startup: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if launch_at_startup {
        autolaunch
            .enable()
            .map_err(|error| format!("Could not enable launch at startup: {error}"))?;
    } else {
        autolaunch
            .disable()
            .map_err(|error| format!("Could not disable launch at startup: {error}"))?;
    }

    Ok(())
}

fn save_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let Ok(size) = window.inner_size() else {
        return;
    };
    let width = size.width as f64 / scale_factor;
    let height = size.height as f64 / scale_factor;
    if width < 320.0 || height < 420.0 || !window_is_visible(&window) {
        return;
    }

    let Ok(position) = window.outer_position() else {
        return;
    };

    let Ok(mut preferences) = state.preferences.lock() else {
        return;
    };

    preferences.window.width = width.clamp(320.0, 1_800.0);
    preferences.window.height = height.clamp(420.0, 2_600.0);
    preferences.window.x = Some(position.x as f64 / scale_factor);
    preferences.window.y = Some(position.y as f64 / scale_factor);

    let _ = save_preferences_to_disk(app, &preferences);
}

fn window_is_visible(window: &WebviewWindow) -> bool {
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return false;
    };

    monitors.iter().any(|monitor| {
        let work_area = monitor.work_area();
        rectangles_overlap(
            position.x,
            position.y,
            size.width,
            size.height,
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn rectangles_overlap(
    left_x: i32,
    left_y: i32,
    left_width: u32,
    left_height: u32,
    right_x: i32,
    right_y: i32,
    right_width: u32,
    right_height: u32,
) -> bool {
    let overlap_width = (i64::from(left_x) + i64::from(left_width))
        .min(i64::from(right_x) + i64::from(right_width))
        - i64::from(left_x.max(right_x));
    let overlap_height = (i64::from(left_y) + i64::from(left_height))
        .min(i64::from(right_y) + i64::from(right_height))
        - i64::from(left_y.max(right_y));
    overlap_width >= 64 && overlap_height >= 64
}

fn sanitize_preferences(mut preferences: UserPreferences) -> UserPreferences {
    if preferences.metric_schema_version < 2 {
        ensure_metric(&mut preferences.visible_metric_ids, "disk.temperature");
        ensure_metric(&mut preferences.chart_metric_ids, "disk.temperature");
        preferences.metric_schema_version = 2;
    }
    if preferences.metric_schema_version < 3 {
        ensure_metric(&mut preferences.visible_metric_ids, "cpu.fan_speed");
        ensure_metric(&mut preferences.visible_metric_ids, "gpu.fan_speed");
        preferences.metric_schema_version = 3;
    }
    preferences.sample_interval_ms = preferences.sample_interval_ms.clamp(500, 5_000);
    preferences.chart_history_seconds = preferences.chart_history_seconds.clamp(10, 300);
    preferences.colors = sanitize_theme_colors(preferences.colors);
    preferences.window = sanitize_window_preferences(preferences.window);
    preferences
}

fn ensure_metric(metric_ids: &mut Vec<String>, id: &str) {
    if !metric_ids.iter().any(|metric_id| metric_id == id) {
        metric_ids.push(id.to_string());
    }
}

fn sanitize_window_preferences(mut window: WindowPreferences) -> WindowPreferences {
    window.width = window.width.clamp(320.0, 1_800.0);
    window.height = window.height.clamp(420.0, 2_600.0);
    window
}

fn sanitize_theme_colors(mut colors: ThemeColors) -> ThemeColors {
    colors.cpu = sanitize_hex_color(&colors.cpu, DEFAULT_CPU_COLOR);
    colors.memory = sanitize_hex_color(&colors.memory, DEFAULT_MEMORY_COLOR);
    colors.gpu = sanitize_hex_color(&colors.gpu, DEFAULT_GPU_COLOR);
    colors.network = sanitize_hex_color(&colors.network, DEFAULT_NETWORK_COLOR);
    colors.disk = sanitize_hex_color(&colors.disk, DEFAULT_DISK_COLOR);
    colors.light_card_background =
        sanitize_hex_color(&colors.light_card_background, DEFAULT_LIGHT_CARD_BACKGROUND);
    colors
}

fn sanitize_hex_color(value: &str, default_value: &str) -> String {
    if value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return value.to_ascii_lowercase();
    }

    default_value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_preferences_preserves_valid_theme_colors() {
        let mut preferences = UserPreferences::default();
        preferences.colors.cpu = "#ABCDEF".to_string();
        preferences.colors.memory = "#123456".to_string();
        preferences.colors.gpu = "#000000".to_string();
        preferences.colors.network = "#ffffff".to_string();
        preferences.colors.disk = "#987654".to_string();
        preferences.colors.light_card_background = "#fefefe".to_string();

        let sanitized = sanitize_preferences(preferences);

        assert_eq!(sanitized.colors.cpu, "#abcdef");
        assert_eq!(sanitized.colors.memory, "#123456");
        assert_eq!(sanitized.colors.gpu, "#000000");
        assert_eq!(sanitized.colors.network, "#ffffff");
        assert_eq!(sanitized.colors.disk, "#987654");
        assert_eq!(sanitized.colors.light_card_background, "#fefefe");
    }

    #[test]
    fn sanitize_preferences_resets_invalid_theme_colors() {
        let mut preferences = UserPreferences::default();
        preferences.colors.cpu = "red".to_string();
        preferences.colors.memory = "#12345".to_string();
        preferences.colors.gpu = "#1234567".to_string();
        preferences.colors.network = "#12zzzz".to_string();
        preferences.colors.disk = "rgb(0, 0, 0)".to_string();
        preferences.colors.light_card_background = "#fffffg".to_string();

        let sanitized = sanitize_preferences(preferences);

        assert_eq!(sanitized.colors.cpu, DEFAULT_CPU_COLOR);
        assert_eq!(sanitized.colors.memory, DEFAULT_MEMORY_COLOR);
        assert_eq!(sanitized.colors.gpu, DEFAULT_GPU_COLOR);
        assert_eq!(sanitized.colors.network, DEFAULT_NETWORK_COLOR);
        assert_eq!(sanitized.colors.disk, DEFAULT_DISK_COLOR);
        assert_eq!(
            sanitized.colors.light_card_background,
            DEFAULT_LIGHT_CARD_BACKGROUND
        );
    }

    #[test]
    fn window_visibility_requires_a_draggable_area_on_screen() {
        assert!(rectangles_overlap(100, 100, 800, 600, 0, 0, 1_920, 1_080));
        assert!(!rectangles_overlap(
            1_900, 100, 800, 600, 0, 0, 1_920, 1_080
        ));
    }
}
