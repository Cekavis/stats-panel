use crate::metrics::{
    now_ms, ok_sample, unavailable_sample, MetricSample, ProviderStatus, TelemetrySnapshot,
};
use nvml_wrapper::enum_wrappers::device::{Clock, ClockId, TemperatureSensor};
use nvml_wrapper::{Device, Nvml};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::Duration,
};
use sysinfo::{Disks, Networks, System};

const SENSOR_HELPER_MESSAGE: &str =
    "Stats Panel Sensor service is unavailable. CPU, GPU, and disk sensors cannot be read.";
#[cfg(windows)]
const SENSOR_PIPE_PATH: &str = r"\\.\pipe\StatsPanel.Sensor.v1";

pub struct TelemetryCollector {
    system: System,
    networks: Networks,
    disks: Disks,
    nvml: Option<Nvml>,
    nvml_error: Option<String>,
    hardware_monitor: HardwareMonitorProvider,
}

impl TelemetryCollector {
    pub fn new(hardware_monitor: HardwareMonitorProvider) -> Self {
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
            hardware_monitor,
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
        for (index, cpu) in self.system.cpus().iter().enumerate() {
            samples.push(ok_sample(
                &format!("cpu.core.{index}.usage"),
                cpu.cpu_usage() as f64,
                "%",
                "sysinfo",
                timestamp,
            ));
        }

        let average_frequency = self
            .hardware_monitor
            .read()
            .ok()
            .and_then(|reading| reading.cpu_frequency)
            .unwrap_or_else(|| average_cpu_frequency(&self.system));
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
            nvml_clock_value(&device, Clock::Graphics),
        );
        push_nvml_metric(
            samples,
            "gpu.memory_clock",
            "MHz",
            timestamp,
            nvml_clock_value(&device, Clock::Memory),
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
            "℃",
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
                    "bundled-sensor-helper",
                    "Stats Panel Sensor",
                    true,
                    &reading.message,
                ));
                let sensor_health_state = if reading.health_state.is_empty() {
                    &reading.sensor_driver_state
                } else {
                    &reading.health_state
                };
                push_optional_sensor(
                    samples,
                    "cpu.temperature",
                    "℃",
                    timestamp,
                    reading.cpu_temperature,
                    &missing_cpu_sensor_message("CPU temperature", sensor_health_state),
                );
                push_optional_sensor(
                    samples,
                    "cpu.power",
                    "W",
                    timestamp,
                    reading.cpu_power,
                    &missing_cpu_sensor_message("CPU power", sensor_health_state),
                );
                push_optional_sensor(
                    samples,
                    "cpu.fan_speed",
                    "RPM",
                    timestamp,
                    reading.cpu_fan_speed,
                    "CPU fan speed sensor not found.",
                );
                push_helper_sensor_if_available(
                    samples,
                    "gpu.core_clock",
                    "MHz",
                    timestamp,
                    reading.gpu_core_clock,
                );
                push_helper_sensor_if_available(
                    samples,
                    "gpu.memory_clock",
                    "MHz",
                    timestamp,
                    reading.gpu_memory_clock,
                );
                push_helper_sensor_if_available(
                    samples,
                    "gpu.temperature",
                    "℃",
                    timestamp,
                    reading.gpu_temperature,
                );
                push_helper_sensor_if_available(
                    samples,
                    "gpu.power",
                    "W",
                    timestamp,
                    reading.gpu_power,
                );
                push_optional_sensor(
                    samples,
                    "gpu.fan_speed",
                    "RPM",
                    timestamp,
                    reading.gpu_fan_speed,
                    "GPU fan speed sensor not found.",
                );
                push_optional_sensor(
                    samples,
                    "disk.temperature",
                    "℃",
                    timestamp,
                    reading.disk_temperature,
                    "Disk temperature sensor not found.",
                );
            }
            Err(message) => {
                statuses.push(provider_status(
                    "bundled-sensor-helper",
                    "Stats Panel Sensor",
                    false,
                    &message,
                ));
                samples.push(unavailable_sample(
                    "cpu.temperature",
                    "℃",
                    "Stats Panel Sensor",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "cpu.power",
                    "W",
                    "Stats Panel Sensor",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "cpu.fan_speed",
                    "RPM",
                    "Stats Panel Sensor",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "gpu.fan_speed",
                    "RPM",
                    "Stats Panel Sensor",
                    timestamp,
                    message.clone(),
                ));
                samples.push(unavailable_sample(
                    "disk.temperature",
                    "℃",
                    "Stats Panel Sensor",
                    timestamp,
                    message,
                ));
            }
        }
    }
}

#[derive(Clone)]
pub struct HardwareMonitorProvider {
    state: Arc<Mutex<HardwareMonitorState>>,
    #[cfg(windows)]
    worker_generation: Arc<AtomicU64>,
}

#[derive(Clone)]
struct HardwareMonitorState {
    available: bool,
    reading: HardwareReading,
    message: String,
}

#[derive(Clone, Debug, Default)]
struct HardwareReading {
    cpu_frequency: Option<f64>,
    cpu_temperature: Option<f64>,
    cpu_power: Option<f64>,
    cpu_fan_speed: Option<f64>,
    gpu_core_clock: Option<f64>,
    gpu_memory_clock: Option<f64>,
    gpu_temperature: Option<f64>,
    gpu_power: Option<f64>,
    gpu_fan_speed: Option<f64>,
    disk_temperature: Option<f64>,
    sensor_driver_state: String,
    health_state: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperReading {
    available: bool,
    cpu_frequency: Option<f64>,
    cpu_temperature: Option<f64>,
    cpu_power: Option<f64>,
    cpu_fan_speed: Option<f64>,
    gpu_core_clock: Option<f64>,
    gpu_memory_clock: Option<f64>,
    gpu_temperature: Option<f64>,
    gpu_power: Option<f64>,
    gpu_fan_speed: Option<f64>,
    disk_temperature: Option<f64>,
    #[serde(default)]
    sensor_driver_state: String,
    #[serde(default)]
    health_state: String,
    message: String,
}

impl HardwareMonitorProvider {
    pub fn unavailable(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            state: Arc::new(Mutex::new(HardwareMonitorState {
                available: false,
                reading: HardwareReading {
                    message: message.clone(),
                    ..HardwareReading::default()
                },
                message,
            })),
            #[cfg(windows)]
            worker_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn read(&self) -> Result<HardwareReading, String> {
        let state = self
            .state
            .lock()
            .map_err(|error| format!("Stats Panel Sensor state is unavailable: {error}"))?;

        if state.available {
            Ok(state.reading.clone())
        } else {
            Err(state.message.clone())
        }
    }

    fn apply_helper_reading(&self, reading: HelperReading) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };

        state.available = reading.available;
        state.message = reading.message.clone();
        state.reading = HardwareReading {
            cpu_frequency: reading.cpu_frequency,
            cpu_temperature: reading.cpu_temperature,
            cpu_power: reading.cpu_power,
            cpu_fan_speed: reading.cpu_fan_speed,
            gpu_core_clock: reading.gpu_core_clock,
            gpu_memory_clock: reading.gpu_memory_clock,
            gpu_temperature: reading.gpu_temperature,
            gpu_power: reading.gpu_power,
            gpu_fan_speed: reading.gpu_fan_speed,
            disk_temperature: reading.disk_temperature,
            sensor_driver_state: sensor_driver_state(&reading),
            health_state: reading.health_state,
            message: reading.message,
        };
    }

    fn set_unavailable(&self, message: impl Into<String>) {
        let message = message.into();
        let Ok(mut state) = self.state.lock() else {
            return;
        };

        state.available = false;
        state.message = message.clone();
        state.reading = HardwareReading {
            message,
            ..HardwareReading::default()
        };
    }

    pub fn stop(&self) {
        #[cfg(windows)]
        self.worker_generation.fetch_add(1, Ordering::AcqRel);
    }
}

pub fn start_hardware_monitor_helper() -> HardwareMonitorProvider {
    let provider = HardwareMonitorProvider::unavailable(SENSOR_HELPER_MESSAGE);

    launch_hardware_monitor_helper(&provider);

    provider
}

fn launch_hardware_monitor_helper(provider: &HardwareMonitorProvider) {
    #[cfg(not(windows))]
    {
        provider.set_unavailable(SENSOR_HELPER_MESSAGE);
    }

    #[cfg(windows)]
    {
        let generation = provider.worker_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let task_provider = provider.clone();
        thread::spawn(move || {
            while task_provider.worker_generation.load(Ordering::Acquire) == generation {
                match subscribe_to_sensor_service(&task_provider, generation) {
                    Ok(()) => task_provider
                        .set_unavailable("Stats Panel Sensor service disconnected. Reconnecting."),
                    Err(error) => task_provider.set_unavailable(error),
                }

                sleep_while_current(&task_provider, generation);
            }
        });
    }
}

#[cfg(windows)]
fn subscribe_to_sensor_service(
    provider: &HardwareMonitorProvider,
    generation: u64,
) -> Result<(), String> {
    let pipe = OpenOptions::new()
        .read(true)
        .open(SENSOR_PIPE_PATH)
        .map_err(|error| format!("Stats Panel Sensor service is unavailable: {error}"))?;

    let mut reader = BufReader::new(pipe);
    let mut line = String::new();
    while provider.worker_generation.load(Ordering::Acquire) == generation {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Ok(()),
            Ok(_) if line.trim().is_empty() => continue,
            Ok(_) => match parse_helper_reading(line.trim()) {
                Ok(reading) => provider.apply_helper_reading(reading),
                Err(error) => return Err(error),
            },
            Err(error) => {
                return Err(format!(
                    "Could not read from Stats Panel Sensor service: {error}"
                ));
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
fn sleep_while_current(provider: &HardwareMonitorProvider, generation: u64) {
    for _ in 0..20 {
        if provider.worker_generation.load(Ordering::Acquire) != generation {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn parse_helper_reading(line: &str) -> Result<HelperReading, String> {
    serde_json::from_str::<HelperReading>(line)
        .map_err(|error| format!("Stats Panel Sensor returned invalid data: {error}"))
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

fn nvml_clock_value(device: &Device, clock: Clock) -> Result<f64, nvml_wrapper::error::NvmlError> {
    device
        .clock(clock, ClockId::Current)
        .or_else(|_| device.clock_info(clock))
        .or_else(|_| device.max_clock_info(clock))
        .map(|value| value as f64)
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
        Some(value) => samples.push(ok_sample(id, value, unit, "Stats Panel Sensor", timestamp)),
        None => samples.push(unavailable_sample(
            id,
            unit,
            "Stats Panel Sensor",
            timestamp,
            fallback_message,
        )),
    }
}

fn sensor_driver_state(reading: &HelperReading) -> String {
    if !reading.sensor_driver_state.is_empty() {
        return reading.sensor_driver_state.clone();
    }

    "unknown".to_string()
}

fn missing_cpu_sensor_message(label: &str, sensor_driver_state: &str) -> String {
    match sensor_driver_state {
        "ready" | "installed" => format!(
            "{label} sensor not found. Low-level access is ready, but this hardware, firmware, Windows build, or sensor library may not expose that reading."
        ),
        "reboot_required" | "rebootRequired" => format!(
            "{label} sensor is unavailable until Windows is restarted to finish sensor service setup."
        ),
        "access_denied" | "device_denied" => format!(
            "{label} sensor is unavailable because the sensor service cannot open the low-level device."
        ),
        "sensor_value_zero" => format!(
            "{label} sensor library returned no usable value on this Windows build or hardware."
        ),
        "degraded" | "not_found" | "open_failed" => format!(
            "{label} sensor is unavailable; the sensor service reported a low-level access or hardware limitation."
        ),
        _ => format!(
            "{label} sensor not found. Stats Panel Sensor service will repair low-level access during installation or update."
        ),
    }
}

fn push_helper_sensor_if_available(
    samples: &mut Vec<MetricSample>,
    id: &str,
    unit: &str,
    timestamp: u64,
    value: Option<f64>,
) {
    if let Some(value) = value {
        upsert_sample(
            samples,
            ok_sample(id, value, unit, "Stats Panel Sensor", timestamp),
        );
    }
}

fn upsert_sample(samples: &mut Vec<MetricSample>, sample: MetricSample) {
    if let Some(existing) = samples.iter_mut().find(|existing| existing.id == sample.id) {
        *existing = sample;
    } else {
        samples.push(sample);
    }
}

fn push_unavailable_gpu(samples: &mut Vec<MetricSample>, timestamp: u64, message: String) {
    for (id, unit) in [
        ("gpu.usage", "%"),
        ("gpu.core_clock", "MHz"),
        ("gpu.memory_clock", "MHz"),
        ("gpu.power", "W"),
        ("gpu.temperature", "℃"),
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

    #[test]
    fn helper_reading_parses_camel_case_json() {
        let reading = parse_helper_reading(
            r#"{"available":true,"cpuFrequency":4288.5,"cpuTemperature":61.5,"cpuPower":44.25,"cpuFanSpeed":1857.0,"gpuCoreClock":2415.0,"gpuMemoryClock":10501.0,"gpuTemperature":55.0,"gpuPower":128.5,"gpuFanSpeed":1240.0,"healthState":"ready","message":"online","timestamp":1}"#,
        )
        .expect("helper JSON should parse");

        assert!(reading.available);
        assert_eq!(reading.cpu_frequency, Some(4288.5));
        assert_eq!(reading.cpu_temperature, Some(61.5));
        assert_eq!(reading.cpu_power, Some(44.25));
        assert_eq!(reading.cpu_fan_speed, Some(1857.0));
        assert_eq!(reading.gpu_core_clock, Some(2415.0));
        assert_eq!(reading.gpu_memory_clock, Some(10501.0));
        assert_eq!(reading.gpu_temperature, Some(55.0));
        assert_eq!(reading.gpu_power, Some(128.5));
        assert_eq!(reading.gpu_fan_speed, Some(1240.0));
        assert_eq!(reading.disk_temperature, None);
        assert_eq!(reading.health_state, "ready");
        assert_eq!(reading.message, "online");
    }

    #[test]
    fn helper_reading_preserves_zero_gpu_fan_speed() {
        let reading = parse_helper_reading(
            r#"{"available":true,"gpuFanSpeed":0.0,"message":"online","timestamp":1}"#,
        )
        .expect("helper JSON should parse");

        assert_eq!(reading.gpu_fan_speed, Some(0.0));
    }

    #[test]
    fn optional_gpu_fan_zero_is_ok_sample() {
        let mut samples = Vec::new();
        push_optional_sensor(
            &mut samples,
            "gpu.fan_speed",
            "RPM",
            1,
            Some(0.0),
            "GPU fan speed sensor not found.",
        );

        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].id, "gpu.fan_speed");
        assert_eq!(samples[0].value, Some(0.0));
        assert_eq!(samples[0].status, SampleStatus::Ok);
        assert_eq!(samples[0].message, None);
    }

    #[test]
    fn optional_gpu_fan_none_is_unavailable_sample() {
        let mut samples = Vec::new();
        push_optional_sensor(
            &mut samples,
            "gpu.fan_speed",
            "RPM",
            1,
            None,
            "GPU fan speed sensor not found.",
        );

        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].id, "gpu.fan_speed");
        assert_eq!(samples[0].value, None);
        assert_eq!(samples[0].status, SampleStatus::Unavailable);
        assert_eq!(
            samples[0].message.as_deref(),
            Some("GPU fan speed sensor not found.")
        );
    }

    #[test]
    fn hardware_monitor_provider_returns_helper_message_when_unavailable() {
        let provider = HardwareMonitorProvider::unavailable("not ready");

        assert_eq!(provider.read().unwrap_err(), "not ready");
    }
}
