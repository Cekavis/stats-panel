# Stats Panel

Stats Panel is a compact Windows performance monitor built for a fixed region on a secondary display. It uses Tauri v2, React, TypeScript, and Rust.

## Current Features

- Real-time CPU, memory, network, and disk telemetry through `sysinfo`.
- NVIDIA GPU telemetry through NVML when an NVIDIA driver is available.
- CPU temperature, CPU power, and disk temperature sensor bridge via LibreHardwareMonitor/OpenHardwareMonitor WMI when available.
- Custom visible metrics and chart metrics.
- Compact, borderless, resizable widget window with always-on-top support.
- Preferences stored locally in the Tauri app config directory.
- Tray menu with show and quit actions.

## Development

Install dependencies:

```powershell
rtk npm install
```

Run the desktop app:

```powershell
rtk npm run tauri dev
```

Build and validate:

```powershell
rtk npm run build
rtk cargo fmt --all --check
rtk cargo test
rtk git diff --check
```

Run Cargo commands from `src-tauri` when invoking Cargo directly:

```powershell
rtk cargo test
```

## Sensor Notes

Windows exposes CPU usage, memory, network, and disk activity without special setup. CPU temperature, CPU power, and disk temperature usually require a hardware monitor provider. For those readings, run LibreHardwareMonitor or OpenHardwareMonitor with WMI enabled; administrator privileges may be required on some systems.

NVIDIA GPU metrics use NVML through the installed NVIDIA driver. Systems without NVML show GPU metrics as unavailable instead of using placeholder values.
