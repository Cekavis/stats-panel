use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    #[serde(default)]
    pub metric_schema_version: u32,
    #[serde(default)]
    pub appearance: AppearancePreference,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub colors: ThemeColors,
    pub visible_metric_ids: Vec<String>,
    pub chart_metric_ids: Vec<String>,
    pub sample_interval_ms: u64,
    #[serde(default = "default_chart_history_seconds")]
    pub chart_history_seconds: u64,
    pub window: WindowPreferences,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppearancePreference {
    Light,
    Dark,
    #[default]
    System,
}

pub const DEFAULT_CPU_COLOR: &str = "#ed1c24";
pub const DEFAULT_MEMORY_COLOR: &str = "#f59e0b";
pub const DEFAULT_GPU_COLOR: &str = "#76b900";
pub const DEFAULT_NETWORK_COLOR: &str = "#0ea5e9";
pub const DEFAULT_DISK_COLOR: &str = "#8b5cf6";
pub const DEFAULT_LIGHT_CARD_BACKGROUND: &str = "#ffffff";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
    #[serde(default = "default_cpu_color")]
    pub cpu: String,
    #[serde(default = "default_memory_color")]
    pub memory: String,
    #[serde(default = "default_gpu_color")]
    pub gpu: String,
    #[serde(default = "default_network_color")]
    pub network: String,
    #[serde(default = "default_disk_color")]
    pub disk: String,
    #[serde(default = "default_light_card_background")]
    pub light_card_background: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub always_on_top: bool,
    pub compact: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            metric_schema_version: 3,
            appearance: AppearancePreference::System,
            launch_at_startup: false,
            colors: ThemeColors::default(),
            visible_metric_ids: vec![
                "cpu.usage",
                "cpu.frequency",
                "cpu.temperature",
                "cpu.power",
                "cpu.fan_speed",
                "memory.usage",
                "memory.used",
                "gpu.usage",
                "gpu.core_clock",
                "gpu.memory_clock",
                "gpu.temperature",
                "gpu.power",
                "gpu.fan_speed",
                "gpu.memory_usage",
                "gpu.memory_used",
                "network.download",
                "network.upload",
                "disk.read",
                "disk.write",
                "disk.temperature",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            chart_metric_ids: vec![
                "cpu.usage",
                "memory.usage",
                "gpu.usage",
                "gpu.memory_usage",
                "network.download",
                "network.upload",
                "disk.read",
                "disk.write",
                "disk.temperature",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            sample_interval_ms: 1_000,
            chart_history_seconds: default_chart_history_seconds(),
            window: WindowPreferences::default(),
        }
    }
}

fn default_chart_history_seconds() -> u64 {
    60
}

fn default_cpu_color() -> String {
    DEFAULT_CPU_COLOR.to_string()
}

fn default_memory_color() -> String {
    DEFAULT_MEMORY_COLOR.to_string()
}

fn default_gpu_color() -> String {
    DEFAULT_GPU_COLOR.to_string()
}

fn default_network_color() -> String {
    DEFAULT_NETWORK_COLOR.to_string()
}

fn default_disk_color() -> String {
    DEFAULT_DISK_COLOR.to_string()
}

fn default_light_card_background() -> String {
    DEFAULT_LIGHT_CARD_BACKGROUND.to_string()
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            cpu: default_cpu_color(),
            memory: default_memory_color(),
            gpu: default_gpu_color(),
            network: default_network_color(),
            disk: default_disk_color(),
            light_card_background: default_light_card_background(),
        }
    }
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 2160.0,
            x: None,
            y: None,
            always_on_top: false,
            compact: false,
        }
    }
}

pub fn load_preferences(app: &AppHandle) -> UserPreferences {
    let path = preferences_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_preferences_to_disk(
    app: &AppHandle,
    preferences: &UserPreferences,
) -> Result<(), String> {
    let path = preferences_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn preferences_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("preferences.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_include_core_dashboard_metrics() {
        let preferences = UserPreferences::default();

        assert!(preferences
            .visible_metric_ids
            .contains(&"cpu.usage".to_string()));
        assert!(preferences
            .visible_metric_ids
            .contains(&"gpu.usage".to_string()));
        assert!(preferences
            .visible_metric_ids
            .contains(&"disk.temperature".to_string()));
        assert_eq!(preferences.sample_interval_ms, 1_000);
        assert_eq!(preferences.chart_history_seconds, 60);
        assert_eq!(preferences.appearance, AppearancePreference::System);
        assert!(!preferences.launch_at_startup);
        assert_eq!(preferences.colors.cpu, DEFAULT_CPU_COLOR);
        assert_eq!(preferences.colors.gpu, DEFAULT_GPU_COLOR);
        assert_eq!(
            preferences.colors.light_card_background,
            DEFAULT_LIGHT_CARD_BACKGROUND
        );
        assert_eq!(preferences.window.width, 1280.0);
    }

    #[test]
    fn preferences_round_trip_as_camel_case_json() {
        let preferences = UserPreferences::default();
        let json = serde_json::to_string(&preferences).expect("preferences should serialize");
        let parsed: UserPreferences =
            serde_json::from_str(&json).expect("preferences should deserialize");

        assert!(json.contains("visibleMetricIds"));
        assert!(json.contains("metricSchemaVersion"));
        assert!(json.contains(r#""appearance":"system""#));
        assert!(json.contains("launchAtStartup"));
        assert!(json.contains("chartHistorySeconds"));
        assert!(json.contains("lightCardBackground"));
        assert_eq!(parsed.chart_metric_ids, preferences.chart_metric_ids);
        assert_eq!(parsed.appearance, AppearancePreference::System);
        assert_eq!(
            parsed.chart_history_seconds,
            preferences.chart_history_seconds
        );
        assert_eq!(parsed.launch_at_startup, preferences.launch_at_startup);
    }

    #[test]
    fn missing_optional_preferences_use_defaults() {
        let json = r#"{
            "metricSchemaVersion": 3,
            "launchAtStartup": false,
            "visibleMetricIds": ["cpu.usage"],
            "chartMetricIds": ["cpu.usage"],
            "sampleIntervalMs": 1000,
            "window": {
                "width": 1280.0,
                "height": 2160.0,
                "x": null,
                "y": null,
                "alwaysOnTop": false,
                "compact": false
            }
        }"#;
        let parsed: UserPreferences =
            serde_json::from_str(json).expect("old preferences should deserialize");

        assert_eq!(parsed.chart_history_seconds, 60);
        assert_eq!(parsed.appearance, AppearancePreference::System);
        assert_eq!(parsed.colors, ThemeColors::default());
    }

    #[test]
    fn partial_color_preferences_use_defaults() {
        let json = r##"{
            "metricSchemaVersion": 3,
            "appearance": "light",
            "launchAtStartup": false,
            "colors": {
                "cpu": "#123456"
            },
            "visibleMetricIds": ["cpu.usage"],
            "chartMetricIds": ["cpu.usage"],
            "sampleIntervalMs": 1000,
            "chartHistorySeconds": 60,
            "window": {
                "width": 1280.0,
                "height": 2160.0,
                "x": null,
                "y": null,
                "alwaysOnTop": false,
                "compact": false
            }
        }"##;
        let parsed: UserPreferences =
            serde_json::from_str(json).expect("partial color preferences should deserialize");

        assert_eq!(parsed.colors.cpu, "#123456");
        assert_eq!(parsed.colors.memory, DEFAULT_MEMORY_COLOR);
        assert_eq!(parsed.colors.gpu, DEFAULT_GPU_COLOR);
    }
}
