# Changelog

All notable changes to Stats Panel are tracked here.

## Unreleased

- Replaced the default app icon with a flat Stats Panel hardware telemetry icon.
- Bumped the app version to 0.2.21.
- Added a settings toggle for launching Stats Panel automatically when Windows starts.
- Bumped the app version to 0.2.20.
- Added a Steam overlay-style per-core CPU usage bar row inside the CPU dashboard tile.
- Bumped the app version to 0.2.19.
- Restored drag support for the frameless main dashboard window by allowing Tauri window drag regions.
- Bumped the app version to 0.2.18.
- Fixed CPU frequency readings so effective/idle core clocks no longer drag the displayed CPU clock far below the current hardware clock.
- Bumped the app version to 0.2.17.
- Added a direct NVMe SMART composite temperature fallback so drives can report current disk temperature even when LibreHardwareMonitor only exposes threshold sensors to the bundled helper.
- Bumped the app version to 0.2.16.
- Added CPU and GPU fan speed metrics from the bundled sensor helper.
- Preferred disk Composite Temperature readings while continuing to ignore disk warning and critical threshold sensors.
- Bumped the app version to 0.2.15.
- Applied PawnIO device permissions and restarted its device instance after integrated sensor driver setup so normal app launches can read CPU sensors.
- Bumped the app version to 0.2.14.
- Distinguished leftover PawnIO driver registration after uninstall from a fully installed PawnIO setup.
- Bumped the app version to 0.2.13.
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
