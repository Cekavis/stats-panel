import { invoke } from "@tauri-apps/api/core";
import type { MetricDefinition, UserPreferences, WindowPreferences } from "./types";

export function getMetricsManifest() {
  return invoke<MetricDefinition[]>("get_metrics_manifest");
}

export function getPreferences() {
  return invoke<UserPreferences>("get_preferences");
}

export function savePreferences(preferences: UserPreferences) {
  return invoke<UserPreferences>("save_preferences", { preferences });
}

export function setWindowPreferences(window: WindowPreferences) {
  return invoke<WindowPreferences>("set_window_preferences", { window });
}

export function requestSensorPermissions() {
  return invoke<string>("request_sensor_permissions");
}

export function installIntegratedSensorDriver() {
  return invoke<string>("install_integrated_sensor_driver");
}
