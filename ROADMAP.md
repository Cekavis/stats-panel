# Roadmap

## Phase 0 - Project Foundation

Status: complete

- Tauri v2 + React + TypeScript scaffold.
- Windows-oriented borderless widget window defaults.
- Basic project documentation and validation scripts.

## Phase 1 - Core Telemetry Loop

Status: complete

- Rust telemetry loop emits `telemetry-sample` events.
- `sysinfo` provider covers CPU usage/frequency, memory, network, and disk speeds.
- Preferences persist visible metrics, chart metrics, sampling interval, and window behavior.
- React dashboard renders real-time cards, mini line charts, provider status, and settings.
- Frontend UI uses a local Notion-inspired design contract with Radix primitive controls.

## Phase 2 - Hardware Sensors

Status: complete

- NVML provider covers NVIDIA GPU usage, clocks, power, temperature, and VRAM.
- LibreHardwareMonitor/OpenHardwareMonitor WMI bridge reports CPU temperature, CPU power, CPU/GPU fan speed, and disk temperature when available.
- Missing providers surface unavailable status with actionable messages.

## Phase 3 - Secondary Display Component UX

Status: complete

- Borderless compact display panel with drag-region support.
- Always-on-top toggle.
- Light, dark, and system appearance modes.
- Window geometry persistence.
- Tray menu for restoring or quitting the app.

## Phase 4 - Packaging And Release Hygiene

Status: in progress

- Production build validation.
- Tauri bundle validation.
- Release notes and known sensor limitations.
