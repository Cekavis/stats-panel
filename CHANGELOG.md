# Changelog

All notable changes to Stats Panel are tracked here.

## Unreleased

- Stopped prompting to install PawnIO again when the integrated sensor driver is already installed but CPU sensors remain unavailable.
- Bumped the app version to 0.2.12.
- Removed the Windows startup administrator requirement; only integrated sensor driver installation requests elevation.
- Bumped the app version to 0.2.11.
- Added a dashboard-level prompt to enable the integrated sensor driver when CPU temperature or power is unavailable.
- Bumped the app version to 0.2.10.
- Integrated a bundled sensor-driver setup path for CPU temperature and power readings on hardware that requires low-level access.
- Upgraded the bundled sensor helper to LibreHardwareMonitorLib 0.9.7-pre700.
- Bumped the app version to 0.2.9.
- Ignored disk sensor threshold readings such as critical or warning temperature when choosing the current disk temperature.
- Bumped the app version to 0.2.8.
- Added disk temperature monitoring through the bundled sensor helper, including default dashboard visibility and charting.
- Bumped the app version to 0.2.7.
- Bumped the app version to 0.2.1.
- Hid the extra Windows console window for debug and release app launches.
- Bumped the app version to 0.2.0.
- Split the pure display panel from the settings experience, with settings available from the tray menu.
- Reworked the display panel into CPU/memory, GPU/VRAM, and network/disk groups with adjacent 30-second charts and visible axes.
- Initialized the Windows-only Tauri v2 desktop app.
- Added Rust telemetry providers for CPU, memory, network, disk, NVIDIA NVML GPU metrics, and LibreHardwareMonitor/OpenHardwareMonitor WMI CPU sensors.
- Added configurable visible metrics, chart metrics, sampling interval, compact mode, and always-on-top behavior.
- Added a compact modern dashboard with grouped real-time metrics, adjacent mini line charts, and a separate settings window.
- Added local preference persistence, window geometry persistence, and tray restore/quit actions.
