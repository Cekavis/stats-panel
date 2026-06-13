# Repository Guidelines

## Project Structure & Module Organization

Stats Panel is a Windows-focused Tauri v2 desktop app. The React/TypeScript UI lives in `src/`, with `src/App.tsx` as the main dashboard, `src/App.css` for styling, `src/types.ts` for shared frontend types, and `src/tauri.ts` for command wrappers. Rust backend code lives in `src-tauri/src/`: `lib.rs` wires Tauri commands, tray behavior, and the telemetry loop; `metrics.rs` defines metric contracts; `preferences.rs` handles persisted settings; `providers.rs` collects system, NVML, and hardware-monitor data. Static assets are in `public/`, Tauri icons are in `src-tauri/icons/`, and release notes/planning live in `CHANGELOG.md` and `ROADMAP.md`.

## Build, Test, and Development Commands

Use `rtk` before shell commands in this repo.

- `rtk npm install`: install frontend and Tauri CLI dependencies.
- `rtk npm run dev`: start the Vite frontend only.
- `rtk npm run tauri dev`: run the desktop app locally.
- `rtk npm run build`: type-check and build the frontend.
- `rtk cargo test` from `src-tauri/`: run Rust unit tests.
- `rtk cargo clippy --all-targets -- -D warnings` from `src-tauri/`: enforce Rust lint cleanliness.
- `rtk npm run tauri build -- --debug`: build a debug desktop executable and installer bundles.
- `rtk powershell -NoProfile -ExecutionPolicy Bypass -File .codex-local\finish-task-install.ps1`: at the end of each task, build the latest release installer and install it locally without deleting existing app data. This script is local-only and must not be committed.

## Coding Style & Naming Conventions

Use TypeScript `strict` mode and React function components. Prefer small, typed helpers over broad utility modules. Use camelCase for TypeScript values and props, PascalCase for components and types. Rust uses `cargo fmt`, snake_case modules/functions, and explicit serde `camelCase` boundaries for frontend-facing JSON.

Every code change must increment the application version number in all project version files.

## Testing Guidelines

Current automated tests are Rust unit tests in `src-tauri/src/*.rs`. Add tests beside the module they validate, using behavior-focused names such as `preferences_round_trip_as_camel_case_json`. For UI changes, run `rtk npm run build`; add frontend tests only once a test runner is introduced.

## Commit & Pull Request Guidelines

Git history uses Conventional Commits, for example `feat: build stats panel desktop monitor`. Use `feat:`, `fix:`, `docs:`, `test:`, or `chore:` with an imperative summary. Pull requests should include a short description, validation commands run, screenshots or screen recordings for UI changes, and notes about sensor/provider limitations.

After completing requested changes, Codex should create a Conventional Commit for the work unless the user explicitly asks not to commit.

## Security & Configuration Tips

Do not commit local config, generated bundles, or credentials. CPU temperature and power depend on LibreHardwareMonitor/OpenHardwareMonitor WMI and may require administrator setup; unavailable sensors should be reported as unavailable, never replaced with placeholder data.
