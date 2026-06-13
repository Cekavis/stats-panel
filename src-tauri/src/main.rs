// Prevents an additional console window on Windows.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    stats_panel_lib::run()
}
