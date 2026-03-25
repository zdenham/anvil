//! System tray (menu bar) icon and menu implementation.

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::panels;

const MAIN_WINDOW_LABEL: &str = "main";

/// Initializes the system tray icon with menu.
pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Build the tray menu
    let menu = build_tray_menu(app)?;

    // Load custom tray icon (embedded at compile time)
    // Use @2x (48x48) for Retina displays - macOS will scale down for 1x displays
    let icon_bytes = include_bytes!("../icons/tray-icon@2x.png");
    let icon = Image::from_bytes(icon_bytes)?;

    // Create the tray icon
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true) // macOS: render as template (adapts to light/dark mode)
        .tooltip("Anvil")
        .menu(&menu)
        .show_menu_on_left_click(false) // Left click opens spotlight, not menu
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)?;

    tracing::info!("[Tray] System tray icon initialized");
    Ok(())
}

/// Builds the tray icon right-click menu.
fn build_tray_menu(
    app: &AppHandle,
) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("open_spotlight", "Open Spotlight").build(app)?)
        .item(&MenuItemBuilder::with_id("open_clipboard", "Clipboard History").build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("open_main", "Open Anvil").build(app)?)
        .item(&MenuItemBuilder::with_id("settings", "Settings...").build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Quit Anvil").build(app)?)
        .build()?;

    Ok(menu)
}

/// Handles tray menu item clicks.
fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    tracing::debug!("[Tray] Menu event: {}", id);

    match id {
        "open_spotlight" => {
            let _ = panels::show_spotlight(app);
        }
        "open_clipboard" => {
            let _ = panels::show_clipboard(app);
        }
        "open_main" => {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "settings" => {
            // Open main window and navigate to settings
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
                // Emit navigate event to all windows
                use tauri::Emitter;
                if let Err(e) = app.emit("navigate", serde_json::json!({
                    "targetWindow": MAIN_WINDOW_LABEL,
                    "tab": "settings"
                })) {
                    tracing::error!(error = %e, "Failed to emit navigate event");
                }
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {
            tracing::warn!("[Tray] Unknown menu item: {}", id);
        }
    }
}

/// Handles tray icon click events.
fn handle_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } => {
            // Left click: toggle spotlight
            tracing::debug!("[Tray] Left click - toggling spotlight");
            panels::toggle_spotlight(tray.app_handle());
        }
        TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => {
            // Double-click: open main window
            tracing::debug!("[Tray] Double-click - opening main window");
            if let Some(window) = tray.app_handle().get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {
            // Right-click shows menu automatically (handled by Tauri)
        }
    }
}
