mod metrics;
mod preferences;
mod providers;

use metrics::{metric_manifest, MetricDefinition};
use preferences::{load_preferences, save_preferences_to_disk, UserPreferences, WindowPreferences};
use providers::{start_hardware_monitor_helper, HardwareMonitorProvider, TelemetryCollector};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{
    menu::MenuBuilder, tray::TrayIconBuilder, App, AppHandle, Emitter, LogicalPosition,
    LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
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

#[tauri::command]
fn request_sensor_permissions() -> String {
    "Stats Panel can enable an integrated sensor driver to read CPU temperature and power on hardware that requires low-level access. If sensors stay unavailable after enabling it, the hardware, firmware, or current sensor library may not expose those readings.".to_string()
}

#[tauri::command]
fn install_integrated_sensor_driver(
    app: AppHandle,
    hardware_monitor: State<'_, HardwareMonitorProvider>,
) -> Result<String, String> {
    let result = install_integrated_sensor_driver_impl(&app)?;
    hardware_monitor.restart(&app);

    match result {
        SensorDriverInstallResult::AlreadyInstalled => Ok("Integrated sensor driver is already installed. Stats Panel is reconnecting to the bundled sensor helper.".to_string()),
        SensorDriverInstallResult::Installed => Ok("Integrated sensor driver installer finished. Stats Panel is reconnecting to the bundled sensor helper.".to_string()),
        SensorDriverInstallResult::DriverRegistrationRemains => Ok("PawnIO was uninstalled, but its driver registration still remains. Restart Windows or remove the residual PawnIO driver registration before installing it again.".to_string()),
    }
}

enum SensorDriverInstallResult {
    AlreadyInstalled,
    Installed,
    DriverRegistrationRemains,
}

#[cfg(windows)]
fn install_integrated_sensor_driver_impl(
    app: &AppHandle,
) -> Result<SensorDriverInstallResult, String> {
    let install_state = pawnio_install_state();
    match install_state {
        PawnIoInstallState::Registered => {
            return Ok(SensorDriverInstallResult::DriverRegistrationRemains);
        }
        PawnIoInstallState::Installed | PawnIoInstallState::Missing => {}
    }

    run_elevated_sensor_driver_setup(app, install_state)?;

    Ok(match install_state {
        PawnIoInstallState::Installed => SensorDriverInstallResult::AlreadyInstalled,
        PawnIoInstallState::Missing => SensorDriverInstallResult::Installed,
        PawnIoInstallState::Registered => SensorDriverInstallResult::DriverRegistrationRemains,
    })
}

#[cfg(windows)]
fn run_elevated_sensor_driver_setup(
    app: &AppHandle,
    install_state: PawnIoInstallState,
) -> Result<(), String> {
    let installer = match install_state {
        PawnIoInstallState::Missing => Some(resolve_pawnio_installer(app)?),
        PawnIoInstallState::Installed | PawnIoInstallState::Registered => None,
    };
    let script_path = std::env::temp_dir().join("stats-panel-sensor-driver-setup.ps1");
    fs::write(&script_path, SENSOR_DRIVER_SETUP_SCRIPT)
        .map_err(|error| format!("Could not prepare sensor driver setup script: {error}"))?;

    let script = "$ErrorActionPreference = 'Stop'; $process = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$env:STATS_SENSOR_SETUP_SCRIPT) -Verb RunAs -Wait -PassThru; exit $process.ExitCode";
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("STATS_SENSOR_SETUP_SCRIPT", &script_path)
        .env(
            "STATS_PAWNIO_INSTALLER",
            installer.as_deref().unwrap_or_else(|| Path::new("")),
        )
        .env("STATS_PAWNIO_INSTALL_STATE", install_state.as_str())
        .status()
        .map_err(|error| format!("Could not start the integrated sensor driver setup: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Integrated sensor driver setup exited with code {:?}.",
            status.code()
        ))
    }
}

#[cfg(windows)]
const SENSOR_DRIVER_SETUP_SCRIPT: &str = r#"
$ErrorActionPreference = "Stop"

if ($env:STATS_PAWNIO_INSTALL_STATE -eq "missing") {
    $installer = $env:STATS_PAWNIO_INSTALLER
    if (-not $installer -or -not (Test-Path -LiteralPath $installer)) {
        Write-Error "PawnIO installer is missing."
        exit 2
    }

    $process = Start-Process -FilePath $installer -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        exit $process.ExitCode
    }
}

$devicePath = "HKLM:\SYSTEM\CurrentControlSet\Enum\ROOT\PAWNIO\0000"
if (Test-Path -LiteralPath $devicePath) {
    $sddl = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;BU)"
    $sd = [System.Security.AccessControl.RawSecurityDescriptor]::new($sddl)
    $bytes = New-Object byte[] $sd.BinaryLength
    $sd.GetBinaryForm($bytes, 0)
    Set-ItemProperty -Path $devicePath -Name Security -Value $bytes

    & pnputil.exe /restart-device "ROOT\PAWNIO\0000" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & sc.exe stop PawnIO | Out-Null
        Start-Sleep -Seconds 1
        & sc.exe start PawnIO | Out-Null
    }
}

exit 0
"#;

#[cfg(not(windows))]
fn install_integrated_sensor_driver_impl(
    _app: &AppHandle,
) -> Result<SensorDriverInstallResult, String> {
    Err("The integrated sensor driver is only available on Windows.".to_string())
}

#[cfg(windows)]
#[derive(Clone, Copy)]
enum PawnIoInstallState {
    Installed,
    Registered,
    Missing,
}

#[cfg(windows)]
impl PawnIoInstallState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Registered => "registered",
            Self::Missing => "missing",
        }
    }
}

#[cfg(windows)]
fn pawnio_install_state() -> PawnIoInstallState {
    if [
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO",
    ]
    .iter()
    .any(|key| {
        Command::new("reg")
            .args(["query", key])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }) {
        return PawnIoInstallState::Installed;
    }

    if registry_key_exists(r"HKLM\SYSTEM\CurrentControlSet\Services\PawnIO") {
        return PawnIoInstallState::Registered;
    }

    PawnIoInstallState::Missing
}

#[cfg(windows)]
fn registry_key_exists(key: &str) -> bool {
    Command::new("reg")
        .args(["query", key])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn resolve_pawnio_installer(app: &AppHandle) -> Result<PathBuf, String> {
    const INSTALLER_NAME: &str = "PawnIO_setup.exe";
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(INSTALLER_NAME));
        candidates.push(resource_dir.join("binaries").join(INSTALLER_NAME));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(INSTALLER_NAME));
            candidates.push(exe_dir.join("resources").join(INSTALLER_NAME));
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("binaries")
                    .join(INSTALLER_NAME),
            );
        }
    }

    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(INSTALLER_NAME),
    );

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "Integrated sensor driver installer is missing. Rebuild Stats Panel to include PawnIO_setup.exe.".to_string()
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
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
            let _ = apply_startup_preference(&app_handle, preferences.launch_at_startup);
            setup_window_events(app);
            setup_tray(app)?;
            let hardware_monitor = start_hardware_monitor_helper(&app_handle);
            app.manage(hardware_monitor.clone());
            start_telemetry_loop(app_handle, hardware_monitor);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_metrics_manifest,
            get_preferences,
            save_preferences,
            set_window_preferences,
            request_sensor_permissions,
            install_integrated_sensor_driver
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
