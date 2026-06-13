use crate::metrics::{
    now_ms, ok_sample, unavailable_sample, MetricSample, ProviderStatus, TelemetrySnapshot,
};
use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::Nvml;
use std::process::Command;
use sysinfo::{Disks, Networks, System};

const CPU_SENSOR_MESSAGE: &str =
    "Install or run LibreHardwareMonitor with WMI enabled, then restart Stats Panel.";

pub struct TelemetryCollector {
    system: System,
    networks: Networks,
    disks: Disks,
    nvml: Option<Nvml>,
    nvml_error: Option<String>,
    hardware_monitor: HardwareMonitorProvider,
}

impl TelemetryCollector {
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();

        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(false);

        let mut disks = Disks::new_with_refreshed_list();
        disks.refresh(false);

        let (nvml, nvml_error) = match Nvml::init() {
            Ok(nvml) => (Some(nvml), None),
            Err(error) => (None, Some(error.to_string())),
        };

        Self {
            system,
            networks,
            disks,
            nvml,
            nvml_error,
            hardware_monitor: HardwareMonitorProvider,
        }
    }

    pub fn collect(&mut self) -> TelemetrySnapshot {
        let timestamp = now_ms();
        let mut samples = Vec::new();
        let mut statuses = Vec::new();

        self.collect_sysinfo(timestamp, &mut samples);
        self.collect_nvml(timestamp, &mut samples, &mut statuses);
        self.collect_hardware_monitor(timestamp, &mut samples, &mut statuses);

        TelemetrySnapshot {
            timestamp,
            samples,
            providers: statuses,
        }
    }

    fn collect_sysinfo(&mut self, timestamp: u64, samples: &mut Vec<MetricSample>) {
        self.system.refresh_cpu_usage();
        self.system.refresh_cpu_frequency();
        self.system.refresh_memory();
        self.networks.refresh(false);
        self.disks.refresh(false);

        samples.push(ok_sample(
            "cpu.usage",
            self.system.global_cpu_usage() as f64,
            "%",
            "sysinfo",
            timestamp,
        ));

        let average_frequency = average_cpu_frequency(&self.system);
        samples.push(ok_sample(
            "cpu.frequency",
            average_frequency,
            "MHz",
            "sysinfo",
            timestamp,
        ));

        let total_memory = self.system.total_memory() as f64;
        let used_memory = self.system.used_memory() as f64;
        samples.push(ok_sample(
            "memory.usage",
            percent(used_memory, total_memory),
            "%",
            "sysinfo",
            timestamp,
        ));
        samples.push(ok_sample(
            "memory.used",
            bytes_to_gib(used_memory),
            "GB",
            "sysinfo",
            timestamp,
        ));

        let (download, upload) =
            self.networks
                .values()
                .fold((0_u64, 0_u64), |(received, transmitted), data| {
                    (received + data.received(), transmitted + data.transmitted())
                });
        samples.push(ok_sample(
            "network.download",
            download as f64,
            "B/s",
            "sysinfo",
            timestamp,
        ));
        samples.push(ok_sample(
            "network.upload",
            upload as f64,
            "B/s",
            "sysinfo",
            timestamp,
        ));

        let (read, write) = self
            .disks
            .iter()
            .fold((0_u64, 0_u64), |(read, write), disk| {
                let usage = disk.usage();
                (read + usage.read_bytes, write + usage.written_bytes)
            });
        samples.push(ok_sample(
            "disk.read",
            read as f64,
            "B/s",
            "sysinfo",
            timestamp,
        ));
        samples.push(ok_sample(
            "disk.write",
            write as f64,
            "B/s",
            "sysinfo",
            timestamp,
        ));
    }

    fn collect_nvml(
        &self,
        timestamp: u64,
        samples: &mut Vec<MetricSample>,
        statuses: &mut Vec<ProviderStatus>,
    ) {
        let Some(nvml) = &self.nvml else {
            let message = self
                .nvml_error
                .clone()
                .unwrap_or_else(|| "NVML is not available on this machine.".to_string());
            statuses.push(provider_status("nvml", "NVIDIA NVML", false, &message));
            push_unavailable_gpu(samples, timestamp, message);
            return;
        };

        let device = match nvml.device_by_index(0) {
            Ok(device) => device,
            Err(error) => {
                let message = error.to_string();
                statuses.push(provider_status("nvml", "NVIDIA NVML", false, &message));
                push_unavailable_gpu(samples, timestamp, message);
                return;
            }
        };

        statuses.push(provider_status(
            "nvml",
            "NVIDIA NVML",
            true,
            "GPU metrics online.",
        ));

        match device.utilization_rates() {
            Ok(utilization) => samples.push(ok_sample(
                "gpu.usage",
                utilization.gpu as f64,
                "%",
                "NVML",
                timestamp,
            )),
            Err(error) => samples.push(unavailable_sample(
                "gpu.usage",
                "%",
                "NVML",
                timestamp,
                error.to_string(),
            )),
        }

        push_nvml_metric(
            samples,
            "gpu.core_clock",
            "MHz",
            timestamp,
            device.clock_info(Clock::Graphics).map(|value| value as f64),
        );
        push_nvml_metric(
            samples,
            "gpu.memory_clock",
            "MHz",
            timestamp,
            device.clock_info(Clock::Memory).map(|value| value as f64),
        );
        push_nvml_metric(
            samples,
            "gpu.power",
            "W",
            timestamp,
            device.power_usage().map(|value| value as f64 / 1_000.0),
        );
        push_nvml_metric(
            samples,
            "gpu.temperature",
            "C",
            timestamp,
            device
                .temperature(TemperatureSensor::Gpu)
                .map(|value| value as f64),
        );

        match device.memory_info() {
            Ok(memory) => {
                samples.push(ok_sample(
                    "gpu.memory_used",
                    bytes_to_gib(memory.used as f64),
                    "GB",
                    "NVML",
                    timestamp,
                ));
                samples.push(ok_sample(
                    "gpu.memory_usage",
                    percent(memory.used as f64, memory.total as f64),
                    "%",
                    "NVML",
                    timestamp,
                ));
            }
            Err(error) => {
                let message = error.to_string();
                samples.push(unavailable_sample(
                    "gpu.memory_used",
                    "GB",
                    "NVML",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "gpu.memory_usage",
                    "%",
                    "NVML",
                    timestamp,
                    message,
                ));
            }
        }
    }

    fn collect_hardware_monitor(
        &self,
        timestamp: u64,
        samples: &mut Vec<MetricSample>,
        statuses: &mut Vec<ProviderStatus>,
    ) {
        match self.hardware_monitor.read() {
            Ok(reading) => {
                statuses.push(provider_status(
                    "libre-hardware-monitor",
                    "LibreHardwareMonitor",
                    true,
                    "CPU sensor bridge online.",
                ));
                push_optional_sensor(
                    samples,
                    "cpu.temperature",
                    "C",
                    timestamp,
                    reading.cpu_temperature,
                    "CPU temperature sensor not found.",
                );
                push_optional_sensor(
                    samples,
                    "cpu.power",
                    "W",
                    timestamp,
                    reading.cpu_power,
                    "CPU power sensor not found.",
                );
            }
            Err(message) => {
                statuses.push(provider_status(
                    "libre-hardware-monitor",
                    "LibreHardwareMonitor",
                    false,
                    &message,
                ));
                samples.push(unavailable_sample(
                    "cpu.temperature",
                    "C",
                    "LibreHardwareMonitor",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "cpu.power",
                    "W",
                    "LibreHardwareMonitor",
                    timestamp,
                    message,
                ));
            }
        }
    }
}

#[derive(Default)]
struct HardwareMonitorProvider;

#[derive(Default)]
struct HardwareReading {
    cpu_temperature: Option<f64>,
    cpu_power: Option<f64>,
}

impl HardwareMonitorProvider {
    fn read(&self) -> Result<HardwareReading, String> {
        #[cfg(not(windows))]
        {
            return Err(CPU_SENSOR_MESSAGE.to_string());
        }

        #[cfg(windows)]
        {
            let script = r#"
$namespace = if (Get-CimClass -Namespace root\LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue) {
  'root\LibreHardwareMonitor'
} elseif (Get-CimClass -Namespace root\OpenHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue) {
  'root\OpenHardwareMonitor'
} else {
  $null
}
if ($null -eq $namespace) { exit 2 }
$sensors = Get-CimInstance -Namespace $namespace -ClassName Sensor
$cpuTemp = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and ($_.Name -match 'CPU|Package|Tctl|Tdie') } | Sort-Object Value -Descending | Select-Object -First 1
$cpuPower = $sensors | Where-Object { $_.SensorType -eq 'Power' -and ($_.Name -match 'CPU|Package') } | Sort-Object Value -Descending | Select-Object -First 1
[PSCustomObject]@{ cpuTemperature = $cpuTemp.Value; cpuPower = $cpuPower.Value } | ConvertTo-Json -Compress
"#;

            let output = Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ])
                .output()
                .map_err(|_| CPU_SENSOR_MESSAGE.to_string())?;

            if !output.status.success() {
                return Err(CPU_SENSOR_MESSAGE.to_string());
            }

            let text = String::from_utf8_lossy(&output.stdout);
            let value: serde_json::Value =
                serde_json::from_str(text.trim()).map_err(|_| CPU_SENSOR_MESSAGE.to_string())?;

            Ok(HardwareReading {
                cpu_temperature: value.get("cpuTemperature").and_then(|value| value.as_f64()),
                cpu_power: value.get("cpuPower").and_then(|value| value.as_f64()),
            })
        }
    }
}

fn push_nvml_metric(
    samples: &mut Vec<MetricSample>,
    id: &str,
    unit: &str,
    timestamp: u64,
    result: Result<f64, nvml_wrapper::error::NvmlError>,
) {
    match result {
        Ok(value) => samples.push(ok_sample(id, value, unit, "NVML", timestamp)),
        Err(error) => samples.push(unavailable_sample(
            id,
            unit,
            "NVML",
            timestamp,
            error.to_string(),
        )),
    }
}

fn push_optional_sensor(
    samples: &mut Vec<MetricSample>,
    id: &str,
    unit: &str,
    timestamp: u64,
    value: Option<f64>,
    fallback_message: &str,
) {
    match value {
        Some(value) => samples.push(ok_sample(
            id,
            value,
            unit,
            "LibreHardwareMonitor",
            timestamp,
        )),
        None => samples.push(unavailable_sample(
            id,
            unit,
            "LibreHardwareMonitor",
            timestamp,
            fallback_message,
        )),
    }
}

fn push_unavailable_gpu(samples: &mut Vec<MetricSample>, timestamp: u64, message: String) {
    for (id, unit) in [
        ("gpu.usage", "%"),
        ("gpu.core_clock", "MHz"),
        ("gpu.memory_clock", "MHz"),
        ("gpu.power", "W"),
        ("gpu.temperature", "C"),
        ("gpu.memory_used", "GB"),
        ("gpu.memory_usage", "%"),
    ] {
        samples.push(unavailable_sample(
            id,
            unit,
            "NVML",
            timestamp,
            message.clone(),
        ));
    }
}

fn provider_status(id: &str, label: &str, available: bool, message: &str) -> ProviderStatus {
    ProviderStatus {
        id: id.to_string(),
        label: label.to_string(),
        available,
        message: message.to_string(),
    }
}

fn average_cpu_frequency(system: &System) -> f64 {
    let cpus = system.cpus();
    if cpus.is_empty() {
        return 0.0;
    }
    let total: u64 = cpus.iter().map(|cpu| cpu.frequency()).sum();
    total as f64 / cpus.len() as f64
}

fn percent(value: f64, total: f64) -> f64 {
    if total <= 0.0 {
        0.0
    } else {
        (value / total) * 100.0
    }
}

fn bytes_to_gib(bytes: f64) -> f64 {
    bytes / 1024.0 / 1024.0 / 1024.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::SampleStatus;

    #[test]
    fn percent_handles_empty_total() {
        assert_eq!(percent(10.0, 0.0), 0.0);
        assert_eq!(percent(25.0, 100.0), 25.0);
    }

    #[test]
    fn bytes_to_gib_converts_binary_units() {
        assert_eq!(bytes_to_gib(1_073_741_824.0), 1.0);
    }

    #[test]
    fn unavailable_gpu_pushes_all_gpu_metrics() {
        let mut samples = Vec::new();
        push_unavailable_gpu(&mut samples, 1, "missing".to_string());

        assert_eq!(samples.len(), 7);
        assert!(samples
            .iter()
            .all(|sample| sample.status == SampleStatus::Unavailable));
    }
}
