use serde::{Deserialize, Serialize};

pub type MetricId = String;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    pub id: MetricId,
    pub label: String,
    pub category: MetricCategory,
    pub unit: String,
    pub provider: String,
    pub precision: u8,
    pub supports_chart: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetricCategory {
    Cpu,
    Memory,
    Gpu,
    Network,
    Disk,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSample {
    pub id: MetricId,
    pub value: Option<f64>,
    pub unit: String,
    pub status: SampleStatus,
    pub provider: String,
    pub timestamp: u64,
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SampleStatus {
    Ok,
    Unavailable,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySnapshot {
    pub timestamp: u64,
    pub samples: Vec<MetricSample>,
    pub providers: Vec<ProviderStatus>,
}

pub fn metric_manifest() -> Vec<MetricDefinition> {
    vec![
        metric("cpu.usage", "CPU", MetricCategory::Cpu, "%", "sysinfo", 1),
        metric(
            "cpu.frequency",
            "CPU Frequency",
            MetricCategory::Cpu,
            "MHz",
            "sysinfo",
            0,
        ),
        metric(
            "cpu.temperature",
            "CPU Temperature",
            MetricCategory::Cpu,
            "℃",
            "Bundled Sensor Helper",
            1,
        ),
        metric(
            "cpu.power",
            "CPU Power",
            MetricCategory::Cpu,
            "W",
            "Bundled Sensor Helper",
            1,
        ),
        metric(
            "cpu.fan_speed",
            "CPU Fan",
            MetricCategory::Cpu,
            "RPM",
            "Bundled Sensor Helper",
            0,
        ),
        metric(
            "memory.usage",
            "Memory",
            MetricCategory::Memory,
            "%",
            "sysinfo",
            1,
        ),
        metric(
            "memory.used",
            "Memory Used",
            MetricCategory::Memory,
            "GB",
            "sysinfo",
            1,
        ),
        metric("gpu.usage", "GPU", MetricCategory::Gpu, "%", "NVML", 1),
        metric(
            "gpu.core_clock",
            "GPU Core Clock",
            MetricCategory::Gpu,
            "MHz",
            "NVML",
            0,
        ),
        metric(
            "gpu.memory_clock",
            "GPU Memory Clock",
            MetricCategory::Gpu,
            "MHz",
            "NVML",
            0,
        ),
        metric(
            "gpu.power",
            "GPU Power",
            MetricCategory::Gpu,
            "W",
            "NVML",
            1,
        ),
        metric(
            "gpu.fan_speed",
            "GPU Fan",
            MetricCategory::Gpu,
            "RPM",
            "Bundled Sensor Helper",
            0,
        ),
        metric(
            "gpu.temperature",
            "GPU Temperature",
            MetricCategory::Gpu,
            "℃",
            "NVML",
            0,
        ),
        metric(
            "gpu.memory_used",
            "VRAM Used",
            MetricCategory::Gpu,
            "GB",
            "NVML",
            1,
        ),
        metric(
            "gpu.memory_usage",
            "VRAM",
            MetricCategory::Gpu,
            "%",
            "NVML",
            1,
        ),
        metric(
            "network.download",
            "Download",
            MetricCategory::Network,
            "B/s",
            "sysinfo",
            1,
        ),
        metric(
            "network.upload",
            "Upload",
            MetricCategory::Network,
            "B/s",
            "sysinfo",
            1,
        ),
        metric(
            "disk.read",
            "Disk Read",
            MetricCategory::Disk,
            "B/s",
            "sysinfo",
            1,
        ),
        metric(
            "disk.write",
            "Disk Write",
            MetricCategory::Disk,
            "B/s",
            "sysinfo",
            1,
        ),
        metric(
            "disk.temperature",
            "Disk Temperature",
            MetricCategory::Disk,
            "℃",
            "Bundled Sensor Helper",
            1,
        ),
    ]
}

pub fn unavailable_sample(
    id: &str,
    unit: &str,
    provider: &str,
    timestamp: u64,
    message: impl Into<String>,
) -> MetricSample {
    MetricSample {
        id: id.to_string(),
        value: None,
        unit: unit.to_string(),
        status: SampleStatus::Unavailable,
        provider: provider.to_string(),
        timestamp,
        message: Some(message.into()),
    }
}

pub fn ok_sample(id: &str, value: f64, unit: &str, provider: &str, timestamp: u64) -> MetricSample {
    MetricSample {
        id: id.to_string(),
        value: Some(value),
        unit: unit.to_string(),
        status: SampleStatus::Ok,
        provider: provider.to_string(),
        timestamp,
        message: None,
    }
}

fn metric(
    id: &str,
    label: &str,
    category: MetricCategory,
    unit: &str,
    provider: &str,
    precision: u8,
) -> MetricDefinition {
    MetricDefinition {
        id: id.to_string(),
        label: label.to_string(),
        category,
        unit: unit.to_string(),
        provider: provider.to_string(),
        precision,
        supports_chart: true,
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
