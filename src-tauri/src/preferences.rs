use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    #[serde(default)]
    pub metric_schema_version: u32,
    pub visible_metric_ids: Vec<String>,
    pub chart_metric_ids: Vec<String>,
    pub sample_interval_ms: u64,
    pub window: WindowPreferences,
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
            window: WindowPreferences::default(),
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
        assert_eq!(parsed.chart_metric_ids, preferences.chart_metric_ids);
    }
}
