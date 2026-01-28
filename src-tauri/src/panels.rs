//! NSPanel definitions and creation helpers for spotlight-style windows.
//!
//! Uses tauri-nspanel to create true macOS NSPanels that can appear
//! above fullscreen applications and behave like utility panels.

use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::NSWindowAnimationBehavior;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{
    webview::Color, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, Url,
    WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask,
};


/// Checks if a navigation URL should be allowed in the webview.
/// Blocks external http/https URLs and opens them in the system browser instead.
fn is_allowed_navigation(url: &Url, app: &AppHandle) -> bool {
    // Allow tauri:// protocol (internal app URLs in production)
    if url.scheme() == "tauri" {
        return true;
    }

    // Allow localhost (dev server)
    if url.scheme() == "http" && url.host_str() == Some("localhost") {
        return true;
    }

    // Block external http/https - open in system browser instead
    if url.scheme() == "http" || url.scheme() == "https" {
        tracing::info!("[Navigation] Opening external URL in system browser: {}", url);
        let url_string = url.to_string();
        if let Err(e) = app.opener().open_url(&url_string, None::<&str>) {
            tracing::error!("[Navigation] Failed to open URL in browser: {}", e);
        }
        return false;
    }

    // Allow other schemes (file://, etc.) - they're typically safe
    true
}

// Panel labels
pub const SPOTLIGHT_LABEL: &str = "spotlight";
pub const CLIPBOARD_LABEL: &str = "clipboard";
pub const ERROR_LABEL: &str = "error";

// Window dimensions
pub const SPOTLIGHT_WIDTH: f64 = 570.0;
pub const SPOTLIGHT_HEIGHT: f64 = 84.0;
pub const SPOTLIGHT_HEIGHT_EXPANDED: f64 = 210.0;
pub const CLIPBOARD_WIDTH: f64 = 570.0;
pub const CLIPBOARD_HEIGHT: f64 = 400.0;
pub const ERROR_WIDTH: f64 = 500.0;
pub const ERROR_HEIGHT: f64 = 300.0;
pub const CONTROL_PANEL_WIDTH: f64 = 650.0;
pub const CONTROL_PANEL_HEIGHT: f64 = 750.0;
pub const RESULT_ITEM_HEIGHT: f64 = 56.0;
pub const RESULT_ITEM_HEIGHT_COMPACT: f64 = 32.0;
pub const MAX_VISIBLE_RESULTS: usize = 8;

// Store app handle globally to access from event callbacks
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Gets mouse location in CGEvent coordinates (origin at top-left of primary display).
fn get_mouse_location() -> (f64, f64) {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .expect("Failed to create event source");
    let event = CGEvent::new(source).expect("Failed to create event");
    let loc = event.location();
    (loc.x, loc.y)
}

/// Gets the total height of the primary screen (needed for coordinate conversion).
fn get_primary_screen_height(app: &AppHandle) -> f64 {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.size().height as f64 / m.scale_factor())
        .unwrap_or(1080.0)
}

/// Calculates panel position on the screen containing the mouse cursor.
/// Returns (x, y) in Cocoa screen coordinates (origin at bottom-left of primary display).
fn calculate_panel_position_cocoa(app: &AppHandle, panel_width: f64) -> (f64, f64) {
    let (mouse_x, mouse_y) = get_mouse_location();
    let primary_height = get_primary_screen_height(app);

    // Find the monitor containing the mouse cursor
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor();

            // CGEvent returns logical coordinates, so scale monitor position too
            let bounds_x = pos.x as f64 / scale;
            let bounds_y = pos.y as f64 / scale;
            let bounds_w = size.width as f64 / scale;
            let bounds_h = size.height as f64 / scale;

            if mouse_x >= bounds_x
                && mouse_x < bounds_x + bounds_w
                && mouse_y >= bounds_y
                && mouse_y < bounds_y + bounds_h
            {
                // Calculate position: centered horizontally, 20% from top
                let tauri_x = bounds_x + (bounds_w - panel_width) / 2.0;
                let tauri_y = bounds_y + bounds_h * 0.2;

                // Convert to Cocoa coordinates (flip Y axis)
                // Cocoa Y = primary_height - tauri_Y
                let cocoa_x = tauri_x;
                let cocoa_y = primary_height - tauri_y;

                return (cocoa_x, cocoa_y);
            }
        }
    }

    // Fallback to primary monitor center
    let x = (primary_height * 16.0 / 9.0 - panel_width) / 2.0; // Assume 16:9 aspect ratio
    let y = primary_height * 0.8; // 20% from top = 80% in Cocoa coords
    (x, y)
}

// Define all panel classes and event handlers in a single tauri_panel! block
tauri_panel! {
    // Spotlight-style panel that can become key window and floats above other windows
    panel!(SpotlightPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    // Clipboard manager panel with same floating behavior
    panel!(ClipboardPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    // Error panel for displaying errors from other panels
    panel!(ErrorPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    // Control panel for lightweight task display
    panel!(ControlPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    // Event handler for spotlight panel - hides on blur (resign key)
    panel_event!(SpotlightEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for clipboard panel - hides on blur (resign key)
    panel_event!(ClipboardEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for error panel - hides on blur (resign key)
    panel_event!(ErrorEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for control panel - hides on blur (resign key)
    panel_event!(ControlPanelEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

}

/// Stores the app handle for use in event callbacks
pub fn initialize(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
}


/// Creates the spotlight panel (hidden by default)
pub fn create_spotlight_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // Calculate center position (horizontally centered, ~20% from top)
    let x = ((monitor_size.width as f64 / scale_factor) - SPOTLIGHT_WIDTH) / 2.0;
    let y = (monitor_size.height as f64 / scale_factor) * 0.2;

    let panel = PanelBuilder::<_, SpotlightPanel>::new(app, SPOTLIGHT_LABEL)
        .url(WebviewUrl::App("spotlight.html".into()))
        .size(Size::Logical(LogicalSize::new(
            SPOTLIGHT_WIDTH,
            SPOTLIGHT_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(false)
        .hides_on_deactivate(false)
        .transparent(true)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(false)
                .visible(false)
                .transparent(true)
                .title("spotlight")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = SpotlightEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
                panel.hide();
            }


            // Emit event so frontend can reset state
            let _ = app.emit_to(SPOTLIGHT_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    Ok(())
}

/// Creates the clipboard manager panel (hidden by default)
pub fn create_clipboard_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // Calculate center position
    let x = ((monitor_size.width as f64 / scale_factor) - CLIPBOARD_WIDTH) / 2.0;
    let y = (monitor_size.height as f64 / scale_factor) * 0.2;

    let panel = PanelBuilder::<_, ClipboardPanel>::new(app, CLIPBOARD_LABEL)
        .url(WebviewUrl::App("clipboard.html".into()))
        .size(Size::Logical(LogicalSize::new(
            CLIPBOARD_WIDTH,
            CLIPBOARD_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(false)
        .hides_on_deactivate(false)
        .transparent(true)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(false)
                .visible(false)
                .transparent(true)
                .title("clipboard")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = ClipboardEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(CLIPBOARD_LABEL) {
                panel.hide();
            }


            // Emit event so frontend can reset state
            let _ = app.emit_to(CLIPBOARD_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    Ok(())
}

/// Shows the spotlight panel on the screen containing the mouse cursor
pub fn show_spotlight(app: &AppHandle) -> Result<(), String> {
    tracing::info!("[PanelFocus] show_spotlight: SHOWING spotlight panel");
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        // Reposition panel to the screen where the cursor is
        let (x, y) = calculate_panel_position_cocoa(app, SPOTLIGHT_WIDTH);
        panel
            .as_panel()
            .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
        panel.show_and_make_key();
        tracing::info!("[PanelFocus] show_spotlight: spotlight panel now KEY");

        // Emit spotlight-shown event globally (emit_to doesn't work for NSPanels)
        tracing::debug!("[Spotlight] show_spotlight: emitting spotlight-shown event");
        let _ = app.emit("spotlight-shown", ());
    }
    Ok(())
}

/// Hides the spotlight panel
pub fn hide_spotlight(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        panel.hide();
    }
    Ok(())
}

/// Toggles the spotlight panel visibility
pub fn toggle_spotlight(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        if panel.is_visible() {
            tracing::debug!("[Spotlight] toggle_spotlight: hiding panel");
            panel.hide();
        } else {
            tracing::debug!("[Spotlight] toggle_spotlight: showing panel");
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, SPOTLIGHT_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();

            // Emit spotlight-shown event globally (emit_to doesn't work for NSPanels)
            tracing::debug!("[Spotlight] toggle_spotlight: emitting spotlight-shown event");
            let _ = app.emit("spotlight-shown", ());
        }
    }
}

/// Resizes the spotlight panel based on result count and input expansion state
pub fn resize_spotlight(
    app: &AppHandle,
    result_count: usize,
    input_expanded: bool,
    compact: bool,
) -> Result<(), String> {
    tracing::info!(
        "[SPOTLIGHT-HEIGHT] resize_spotlight called: result_count={}, input_expanded={}, compact={}",
        result_count,
        input_expanded,
        compact
    );
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        let base_height = if input_expanded {
            SPOTLIGHT_HEIGHT_EXPANDED
        } else {
            SPOTLIGHT_HEIGHT
        };
        let visible_results = result_count.min(MAX_VISIBLE_RESULTS);
        let item_height = if compact {
            RESULT_ITEM_HEIGHT_COMPACT
        } else {
            RESULT_ITEM_HEIGHT
        };
        let results_height = visible_results as f64 * item_height;
        let new_height = base_height + results_height;

        tracing::info!(
            "[SPOTLIGHT-HEIGHT] calculating: base_height={}, visible_results={}, item_height={}, results_height={}, new_height={}",
            base_height,
            visible_results,
            item_height,
            results_height,
            new_height
        );

        panel.set_content_size(SPOTLIGHT_WIDTH, new_height);
        tracing::info!("[SPOTLIGHT-HEIGHT] set_content_size called with width={}, height={}", SPOTLIGHT_WIDTH, new_height);
    } else {
        tracing::warn!("[SPOTLIGHT-HEIGHT] Failed to get spotlight panel");
    }
    Ok(())
}

/// Shows the clipboard panel on the screen containing the mouse cursor
pub fn show_clipboard(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(CLIPBOARD_LABEL) {
        // Reposition panel to the screen where the cursor is
        let (x, y) = calculate_panel_position_cocoa(app, CLIPBOARD_WIDTH);
        panel
            .as_panel()
            .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
        panel.show_and_make_key();
    }
    Ok(())
}

/// Hides the clipboard panel
pub fn hide_clipboard(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(CLIPBOARD_LABEL) {
        panel.hide();
    }
    Ok(())
}

/// Toggles the clipboard panel visibility, returns true if now visible
pub fn toggle_clipboard(app: &AppHandle) -> bool {
    if let Ok(panel) = app.get_webview_panel(CLIPBOARD_LABEL) {
        if panel.is_visible() {
            panel.hide();
            false
        } else {
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, CLIPBOARD_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();
            true
        }
    } else {
        false
    }
}

/// Calculates centered panel position on the screen containing the mouse cursor.
/// Returns (x, y) in Cocoa screen coordinates (origin at bottom-left of primary display).
fn calculate_centered_panel_position_cocoa(
    app: &AppHandle,
    panel_width: f64,
    panel_height: f64,
) -> (f64, f64) {
    let (mouse_x, mouse_y) = get_mouse_location();
    let primary_height = get_primary_screen_height(app);

    // Find the monitor containing the mouse cursor
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor();

            // CGEvent returns logical coordinates, so scale monitor position too
            let bounds_x = pos.x as f64 / scale;
            let bounds_y = pos.y as f64 / scale;
            let bounds_w = size.width as f64 / scale;
            let bounds_h = size.height as f64 / scale;

            if mouse_x >= bounds_x
                && mouse_x < bounds_x + bounds_w
                && mouse_y >= bounds_y
                && mouse_y < bounds_y + bounds_h
            {
                // Calculate position: centered both horizontally and vertically
                let tauri_x = bounds_x + (bounds_w - panel_width) / 2.0;
                let tauri_y = bounds_y + (bounds_h - panel_height) / 2.0;

                // Convert to Cocoa coordinates (flip Y axis)
                // For setFrameTopLeftPoint, we need the position of the top-left corner
                let cocoa_x = tauri_x;
                let cocoa_y = primary_height - tauri_y;

                return (cocoa_x, cocoa_y);
            }
        }
    }

    // Fallback to primary monitor center
    let screen_width = primary_height * 16.0 / 9.0; // Assume 16:9 aspect ratio
    let x = (screen_width - panel_width) / 2.0;
    let y = primary_height - (primary_height - panel_height) / 2.0; // Centered in Cocoa coords
    (x, y)
}

// ═══════════════════════════════════════════════════════════════════════════
// Pending Error State (Pull Model for HMR resilience)
// ═══════════════════════════════════════════════════════════════════════════

/// Information about a pending error to be displayed in the error panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingError {
    pub message: String,
    pub stack: Option<String>,
}

/// Global storage for pending error - survives HMR/page reloads
static PENDING_ERROR: OnceLock<Mutex<Option<PendingError>>> = OnceLock::new();

fn get_pending_error_mutex() -> &'static Mutex<Option<PendingError>> {
    PENDING_ERROR.get_or_init(|| Mutex::new(None))
}

/// Store a pending error (called before showing panel)
pub fn set_pending_error(error: PendingError) {
    tracing::info!("[ErrorPanel] set_pending_error called with: {:?}", error);
    match get_pending_error_mutex().lock() {
        Ok(mut guard) => {
            *guard = Some(error);
            tracing::info!("[ErrorPanel] Pending error stored successfully");
        }
        Err(e) => {
            tracing::error!("[ErrorPanel] Failed to lock mutex: {:?}", e);
        }
    }
}

/// Retrieve the pending error (does NOT clear - survives HMR reloads)
pub fn get_pending_error() -> Option<PendingError> {
    tracing::info!("[ErrorPanel] get_pending_error called");
    match get_pending_error_mutex().lock() {
        Ok(guard) => {
            let result = guard.clone();
            tracing::info!("[ErrorPanel] get_pending_error returning: {:?}", result);
            result
        }
        Err(e) => {
            tracing::error!("[ErrorPanel] Failed to lock mutex: {:?}", e);
            None
        }
    }
}

/// Clear the pending error (called when panel is hidden)
pub fn clear_pending_error() {
    tracing::info!("[ErrorPanel] clear_pending_error called");
    match get_pending_error_mutex().lock() {
        Ok(mut guard) => {
            *guard = None;
            tracing::info!("[ErrorPanel] Pending error cleared");
        }
        Err(e) => {
            tracing::error!("[ErrorPanel] Failed to lock mutex: {:?}", e);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Panel
// ═══════════════════════════════════════════════════════════════════════════

/// Creates the error panel (hidden by default)
pub fn create_error_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // Calculate center position
    let x = ((monitor_size.width as f64 / scale_factor) - ERROR_WIDTH) / 2.0;
    let y = (monitor_size.height as f64 / scale_factor) * 0.2;

    let panel = PanelBuilder::<_, ErrorPanel>::new(app, ERROR_LABEL)
        .url(WebviewUrl::App("error.html".into()))
        .size(Size::Logical(LogicalSize::new(ERROR_WIDTH, ERROR_HEIGHT)))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(false)
        .hides_on_deactivate(false)
        .transparent(true)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(false)
                .visible(false)
                .transparent(true)
                .title("error")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = ErrorEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(ERROR_LABEL) {
                panel.hide();
            }


            // Clear pending error when panel is hidden
            clear_pending_error();
            // Emit event so frontend can reset state
            let _ = app.emit_to(ERROR_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    Ok(())
}

/// Shows the error panel with the given message and optional stack trace
pub fn show_error(app: &AppHandle, message: &str, stack: Option<&str>) -> Result<(), String> {
    tracing::info!("[ErrorPanel] show_error called with message: {}", message);

    // Store pending error BEFORE showing panel (Pull Model for HMR resilience)
    set_pending_error(PendingError {
        message: message.to_string(),
        stack: stack.map(|s| s.to_string()),
    });

    match app.get_webview_panel(ERROR_LABEL) {
        Ok(panel) => {
            tracing::info!("[ErrorPanel] Got panel, repositioning and showing");
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, ERROR_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();
            tracing::info!("[ErrorPanel] Panel shown");

            // Emit event globally (emit_to doesn't work reliably with NSPanel)
            let payload = serde_json::json!({
                "message": message,
                "stack": stack
            });
            tracing::info!("[ErrorPanel] Emitting show-error event globally with payload: {:?}", payload);
            match app.emit("show-error", &payload) {
                Ok(_) => tracing::info!("[ErrorPanel] show-error event emitted successfully"),
                Err(e) => tracing::error!("[ErrorPanel] Failed to emit show-error event: {:?}", e),
            }
        }
        Err(e) => {
            tracing::error!("[ErrorPanel] Failed to get panel: {:?}", e);
        }
    }
    Ok(())
}

/// Hides the error panel
pub fn hide_error(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(ERROR_LABEL) {
        panel.hide();
    }
    // Clear pending error when explicitly hidden
    clear_pending_error();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Pending Control Panel State (Pull Model for HMR resilience)
// ═══════════════════════════════════════════════════════════════════════════

/// Information about a pending control panel to be displayed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingControlPanel {
    pub thread_id: String,
    pub task_id: String,
    pub prompt: Option<String>,
}

/// Global storage for pending control panel
static PENDING_CONTROL_PANEL: OnceLock<Mutex<Option<PendingControlPanel>>> = OnceLock::new();

/// Global storage for control panel pinned state
/// When pinned, the panel won't hide on blur (used during drag/resize)
static CONTROL_PANEL_PINNED: OnceLock<Mutex<bool>> = OnceLock::new();

fn get_control_panel_pinned_mutex() -> &'static Mutex<bool> {
    CONTROL_PANEL_PINNED.get_or_init(|| Mutex::new(false))
}

/// Pin the control panel (prevents hide on blur)
pub fn pin_control_panel() {
    if let Ok(mut guard) = get_control_panel_pinned_mutex().lock() {
        tracing::info!("[ControlPanel] Pinning panel (preventing hide on blur)");
        *guard = true;
    }
}

/// Unpin the control panel (allows hide on blur)
pub fn unpin_control_panel() {
    if let Ok(mut guard) = get_control_panel_pinned_mutex().lock() {
        tracing::info!("[ControlPanel] Unpinning panel (allowing hide on blur)");
        *guard = false;
    }
}

/// Check if control panel is pinned
pub fn is_control_panel_pinned() -> bool {
    if let Ok(guard) = get_control_panel_pinned_mutex().lock() {
        *guard
    } else {
        false
    }
}

fn get_pending_control_panel_mutex() -> &'static Mutex<Option<PendingControlPanel>> {
    PENDING_CONTROL_PANEL.get_or_init(|| Mutex::new(None))
}

// ═══════════════════════════════════════════════════════════════════════════
// Inbox List Panel Pinned State (for drag behavior)
// ═══════════════════════════════════════════════════════════════════════════

/// Store a pending control panel (called before showing panel)
pub fn set_pending_control_panel(task: PendingControlPanel) {
    if let Ok(mut guard) = get_pending_control_panel_mutex().lock() {
        tracing::info!("[ControlPanel] Storing pending control panel: {:?}", task);
        *guard = Some(task);
    }
}

/// Retrieve the pending control panel
pub fn get_pending_control_panel() -> Option<PendingControlPanel> {
    if let Ok(guard) = get_pending_control_panel_mutex().lock() {
        guard.clone()
    } else {
        None
    }
}

/// Clear the pending control panel
pub fn clear_pending_control_panel() {
    if let Ok(mut guard) = get_pending_control_panel_mutex().lock() {
        tracing::info!("[ControlPanel] Clearing pending control panel");
        *guard = None;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Control Panel
// ═══════════════════════════════════════════════════════════════════════════

pub const CONTROL_PANEL_LABEL: &str = "control-panel";

/// Creates the control panel (hidden by default) - called once at startup
pub fn create_control_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("[ControlPanel] Creating control panel at startup");

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let screen_width = monitor_size.width as f64 / scale_factor;
    let screen_height = monitor_size.height as f64 / scale_factor;

    // Calculate centered position
    let x = (screen_width - CONTROL_PANEL_WIDTH) / 2.0;
    let y = (screen_height - CONTROL_PANEL_HEIGHT) / 2.0;

    let panel = PanelBuilder::<_, ControlPanel>::new(app, CONTROL_PANEL_LABEL)
        .url(WebviewUrl::App("control-panel.html".into()))
        .size(Size::Logical(LogicalSize::new(
            CONTROL_PANEL_WIDTH,
            CONTROL_PANEL_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        // Note: borderless() resets the mask, so resizable() must come after it
        .style_mask(StyleMask::empty().borderless().resizable().nonactivating_panel())
        .has_shadow(true)
        .corner_radius(12.0)
        .hides_on_deactivate(false)
        .transparent(true)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(true)
                .visible(false)
                .transparent(true)
                .title("control-panel")
                // Allow first click on unfocused panel to pass through to webview
                // This enables dragging without needing to focus the panel first
                .accept_first_mouse(true)
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // NOTE: We intentionally do NOT enable setMovableByWindowBackground(true) here.
    // Dragging is handled in React via startDragging(), which allows us to implement
    // focus-aware behavior: drag from anywhere when unfocused, drag only from header
    // when focused (to allow text selection in content).

    // Set up event handler to hide panel when it loses focus (blur)
    // BUT only if not pinned (pinned state is set during drag/resize operations)
    let event_handler = ControlPanelEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        // Check if panel is pinned (during drag/resize)
        if is_control_panel_pinned() {
            tracing::info!("[ControlPanel] Blur ignored - panel is pinned (drag/resize in progress)");
            return;
        }

        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
                tracing::info!("[ControlPanel] Hiding panel on blur (not pinned)");
                panel.hide();
            }

            // Clear pending control panel when panel is hidden
            clear_pending_control_panel();
            // Emit event so frontend can reset state
            let _ = app.emit_to(CONTROL_PANEL_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    tracing::info!("[ControlPanel] Control panel created (hidden)");
    Ok(())
}

/// Shows the control panel with the given task info
pub fn show_control_panel(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    prompt: Option<&str>,
) -> Result<(), String> {
    tracing::info!("[ControlPanel] show_control_panel called: thread_id={}, task_id={}", thread_id, task_id);

    // Store pending control panel BEFORE showing panel (Pull Model for HMR resilience)
    tracing::info!("[ControlPanel] Storing pending control panel...");
    set_pending_control_panel(PendingControlPanel {
        thread_id: thread_id.to_string(),
        task_id: task_id.to_string(),
        prompt: prompt.map(|s| s.to_string()),
    });
    tracing::info!("[ControlPanel] Pending control panel stored");

    tracing::info!("[ControlPanel] Getting panel with label: {}", CONTROL_PANEL_LABEL);
    match app.get_webview_panel(CONTROL_PANEL_LABEL) {
        Ok(panel) => {
            // Reset panel size to default (may have been resized by user)
            panel.set_content_size(CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT);

            tracing::info!("[ControlPanel] Got panel, calculating position...");
            // Reposition panel to center of the screen where the cursor is
            let (x, y) = calculate_centered_panel_position_cocoa(app, CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT);
            tracing::info!("[ControlPanel] Position: ({}, {}), setting frame...", x, y);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            tracing::info!("[ControlPanel] Frame set");

            // Emit event to frontend with task info
            let payload = serde_json::json!({
                "threadId": thread_id,
                "taskId": task_id,
                "prompt": prompt
            });
            tracing::info!("[ControlPanel] Emitting open-control-panel event...");
            let _ = app.emit("open-control-panel", &payload);
            tracing::info!("[ControlPanel] Event emitted");

            // Show the panel and ensure it's focused
            // Note: show_and_make_key() already calls makeKeyAndOrderFront internally,
            // so we don't need a redundant call. Calling it twice causes focus flickering
            // and can trigger spurious blur events during task navigation.
            tracing::info!("[PanelFocus] show_control_panel: SHOWING control-panel");
            panel.show_and_make_key();
            tracing::info!("[PanelFocus] show_control_panel: control-panel now KEY");

            Ok(())
        }
        Err(e) => {
            tracing::error!("[ControlPanel] Failed to get panel: {:?}", e);
            Err(format!("Control panel not available: {:?}", e))
        }
    }
}

/// Shows the control panel without setting thread context.
/// The view will be set via eventBus from the frontend.
pub fn show_control_panel_simple(app: &AppHandle) -> Result<(), String> {
    tracing::info!("[ControlPanel] show_control_panel_simple called");

    match app.get_webview_panel(CONTROL_PANEL_LABEL) {
        Ok(panel) => {
            if panel.is_visible() {
                // Window exists and is visible - just focus it
                tracing::info!("[ControlPanel] Panel already visible, focusing");
                panel.as_panel().makeKeyAndOrderFront(None);
            } else {
                // Window exists but is hidden - show it
                // Reset panel size to default (may have been resized by user)
                panel.set_content_size(CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT);

                // Reposition panel to center of the screen where the cursor is
                let (x, y) = calculate_centered_panel_position_cocoa(app, CONTROL_PANEL_WIDTH, CONTROL_PANEL_HEIGHT);
                panel
                    .as_panel()
                    .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));

                tracing::info!("[PanelFocus] show_control_panel_simple: SHOWING control-panel");
                panel.show_and_make_key();
                tracing::info!("[PanelFocus] show_control_panel_simple: control-panel now KEY");
            }
            Ok(())
        }
        Err(e) => {
            tracing::error!("[ControlPanel] Failed to get panel: {:?}", e);
            Err(format!("Control panel not available: {:?}", e))
        }
    }
}

/// Hides the control panel
pub fn hide_control_panel(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
        panel.hide();
        // Clear pinned state when panel is explicitly hidden
        unpin_control_panel();
        // Clear pending control panel when panel is hidden
        clear_pending_control_panel();
        // Emit event so frontend can reset state
        let _ = app.emit_to(CONTROL_PANEL_LABEL, "panel-hidden", ());
    }
    Ok(())
}

/// Forces focus on the control panel if it's visible (hack for focus restoration)
pub fn focus_control_panel(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
        if panel.is_visible() {
            tracing::info!("[PanelFocus] focus_control_panel: RE-FOCUSING control-panel");
            panel.as_panel().makeKeyAndOrderFront(None);
            tracing::info!("[PanelFocus] focus_control_panel: control-panel now KEY");
        } else {
            tracing::debug!("[PanelFocus] focus_control_panel: panel not visible, skipping");
        }
    }
    Ok(())
}

/// Snaps the control panel position to integer pixel coordinates.
/// This fixes text blurriness caused by subpixel positioning during drag.
pub fn snap_control_panel_position(app: &AppHandle) -> Result<(), String> {
    tracing::info!("[ControlPanel] snap_control_panel_position called");

    if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
        let frame = panel.as_panel().frame();

        tracing::info!(
            "[ControlPanel] Current frame: origin=({:.6}, {:.6}), size=({:.6}, {:.6})",
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height
        );

        // Round position to nearest integer
        let snapped_x = frame.origin.x.round();
        let snapped_y = frame.origin.y.round();

        let x_diff = (frame.origin.x - snapped_x).abs();
        let y_diff = (frame.origin.y - snapped_y).abs();

        tracing::info!(
            "[ControlPanel] Snap calculation: snapped=({}, {}), diff=({:.6}, {:.6})",
            snapped_x,
            snapped_y,
            x_diff,
            y_diff
        );

        // Only update if position changed (avoid unnecessary redraws)
        if x_diff > 0.001 || y_diff > 0.001 {
            tracing::info!(
                "[ControlPanel] SNAPPING position from ({:.3}, {:.3}) to ({}, {})",
                frame.origin.x,
                frame.origin.y,
                snapped_x,
                snapped_y
            );
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(snapped_x, snapped_y));

            // Verify the snap worked
            let new_frame = panel.as_panel().frame();
            tracing::info!(
                "[ControlPanel] After snap: origin=({:.6}, {:.6})",
                new_frame.origin.x,
                new_frame.origin.y
            );
        } else {
            tracing::info!("[ControlPanel] Position already at integer coordinates, no snap needed");
        }

        Ok(())
    } else {
        tracing::error!("[ControlPanel] Panel not found!");
        Err("Control panel not found".to_string())
    }
}

/// Checks if any nspanel is currently visible
/// Returns true if at least one of the panels (spotlight, clipboard, error, control-panel) is visible
pub fn is_any_panel_visible(app: &AppHandle) -> bool {
    let panel_labels = [
        SPOTLIGHT_LABEL,
        CLIPBOARD_LABEL,
        ERROR_LABEL,
        CONTROL_PANEL_LABEL,
    ];

    for label in &panel_labels {
        if let Ok(panel) = app.get_webview_panel(label) {
            if panel.is_visible() {
                return true;
            }
        }
    }

    false
}

/// Checks if a specific panel is currently visible
/// Returns true if the specified panel is visible, false otherwise
pub fn is_panel_visible(app: &AppHandle, panel_label: &str) -> bool {
    if let Ok(panel) = app.get_webview_panel(panel_label) {
        panel.is_visible()
    } else {
        false
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Control Panel Standalone Windows (Pop-out feature)
// ═══════════════════════════════════════════════════════════════════════════

/// Information about a popped-out control panel window instance.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ControlPanelWindowInstance {
    pub thread_id: String,
    pub task_id: String,
}

/// Registry of all popped-out control panel windows
static CONTROL_PANEL_WINDOWS: OnceLock<Mutex<HashMap<String, ControlPanelWindowInstance>>> =
    OnceLock::new();

fn get_control_panel_windows_mutex() -> &'static Mutex<HashMap<String, ControlPanelWindowInstance>>
{
    CONTROL_PANEL_WINDOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a window instance in the registry
fn register_window_instance(instance_id: &str, data: ControlPanelWindowInstance) {
    if let Ok(mut instances) = get_control_panel_windows_mutex().lock() {
        tracing::info!(
            "[ControlPanelWindow] Registering instance: {} for thread: {}",
            instance_id,
            data.thread_id
        );
        instances.insert(instance_id.to_string(), data);
    }
}

/// Unregister a window instance from the registry
fn unregister_window_instance(instance_id: &str) {
    if let Ok(mut instances) = get_control_panel_windows_mutex().lock() {
        tracing::info!(
            "[ControlPanelWindow] Unregistering instance: {}",
            instance_id
        );
        instances.remove(instance_id);
    }
}

/// Get a window instance from the registry
pub fn get_window_instance(instance_id: &str) -> Option<ControlPanelWindowInstance> {
    get_control_panel_windows_mutex()
        .lock()
        .ok()?
        .get(instance_id)
        .cloned()
}

/// List all open control panel window instances
pub fn list_control_panel_windows() -> Vec<(String, ControlPanelWindowInstance)> {
    get_control_panel_windows_mutex()
        .lock()
        .ok()
        .map(|guard| {
            guard
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default()
}

/// Get the current position and size of the control panel NSPanel
pub fn get_control_panel_position(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let panel = app
        .get_webview_panel(CONTROL_PANEL_LABEL)
        .map_err(|e| format!("Panel not found: {:?}", e))?;

    let frame = panel.as_panel().frame();
    // Convert from Cocoa coordinates (origin at bottom-left) to screen coordinates
    let primary_height = get_primary_screen_height(app);
    // frame.origin.y is the bottom-left Y in Cocoa coords
    // We want top-left Y in screen coords (origin at top-left)
    let screen_y = primary_height - frame.origin.y - frame.size.height;

    Ok((
        frame.origin.x,
        screen_y,
        frame.size.width,
        frame.size.height,
    ))
}

/// View type for standalone control panel windows
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlPanelView {
    Thread {
        #[serde(rename = "threadId")]
        thread_id: String,
    },
    Plan {
        #[serde(rename = "planId")]
        plan_id: String,
    },
}

/// Creates a standalone WebviewWindow for a control panel at the specified position
fn create_standalone_window(
    app: &AppHandle,
    view: &ControlPanelView,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, Box<dyn std::error::Error>> {
    let instance_id = uuid::Uuid::new_v4().to_string();
    let label = format!("control-panel-window-{}", instance_id);

    let url = match view {
        ControlPanelView::Thread { thread_id } => format!(
            "control-panel.html?instanceId={}&view=thread&threadId={}",
            instance_id, thread_id
        ),
        ControlPanelView::Plan { plan_id } => format!(
            "control-panel.html?instanceId={}&view=plan&planId={}",
            instance_id, plan_id
        ),
    };

    tracing::info!(
        "[ControlPanelWindow] Creating window {} at ({}, {}) size ({}, {})",
        label,
        x,
        y,
        width,
        height
    );

    let app_for_nav = app.clone();
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("") // No title - keeps window chrome minimal
        .inner_size(width, height)
        .position(x, y)
        .resizable(true)
        .decorations(true)  // Native window decorations (close, minimize, fullscreen)
        .transparent(false) // Disable transparency for native window
        .visible(true)
        .fullscreen(false)  // Start windowed, but allow fullscreen via green button
        .accept_first_mouse(true)
        .background_color(Color(0x1e, 0x20, 0x1e, 0xff)) // surface-800 to prevent white flash
        .on_navigation(move |url| is_allowed_navigation(&url, &app_for_nav))
        .build()?;

    // Enable fullscreen button (green traffic light) and set native background color
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::HasWindowHandle;
        if let Ok(handle) = window.window_handle() {
            if let raw_window_handle::RawWindowHandle::AppKit(appkit_handle) = handle.as_raw() {
                use objc2::rc::Retained;
                use objc2_app_kit::{NSColor, NSView, NSWindowCollectionBehavior};

                // Safety: the pointer is valid for the lifetime of the window
                let ns_view: Retained<NSView> =
                    unsafe { Retained::retain(appkit_handle.ns_view.as_ptr().cast()) }
                        .expect("view pointer is valid");

                if let Some(ns_window) = ns_view.window() {
                    // Enable fullscreen button
                    let current = ns_window.collectionBehavior();
                    let new_behavior = current | NSWindowCollectionBehavior::FullScreenPrimary;
                    ns_window.setCollectionBehavior(new_behavior);

                    // Set native window background color to match quick actions panel
                    // This prevents white flash before WebView content loads
                    // Color: rgba(30, 32, 30, 1) = #1e201e
                    let bg_color = NSColor::colorWithSRGBRed_green_blue_alpha(
                        30.0 / 255.0,  // red
                        32.0 / 255.0,  // green
                        30.0 / 255.0,  // blue
                        1.0,           // alpha
                    );
                    ns_window.setBackgroundColor(Some(&bg_color));
                }
            }
        }
    }

    // Focus the new window
    window.set_focus()?;

    // Register instance
    let instance = match view {
        ControlPanelView::Thread { thread_id } => ControlPanelWindowInstance {
            thread_id: thread_id.clone(),
            task_id: String::new(),
        },
        ControlPanelView::Plan { plan_id } => ControlPanelWindowInstance {
            thread_id: String::new(),
            task_id: plan_id.clone(), // Store plan_id in task_id field
        },
    };
    register_window_instance(&instance_id, instance);

    // Set up close handler to unregister
    let instance_id_clone = instance_id.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            unregister_window_instance(&instance_id_clone);
        }
    });

    Ok(instance_id)
}

/// Pops out the control panel into a standalone WebviewWindow (unified for both threads and plans)
pub fn pop_out_control_panel(
    app: AppHandle,
    view: ControlPanelView,
) -> Result<String, String> {
    tracing::info!(
        "[ControlPanelWindow] pop_out_control_panel called for view: {:?}",
        view
    );

    // Get current panel position
    let (x, y, width, height) = get_control_panel_position(&app)?;
    tracing::info!(
        "[ControlPanelWindow] Panel position: ({}, {}), size: ({}, {})",
        x,
        y,
        width,
        height
    );

    // Hide the NSPanel
    if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
        panel.hide();
    }
    clear_pending_control_panel();

    // Create new window at same position
    let instance_id =
        create_standalone_window(&app, &view, x, y, width, height)
            .map_err(|e| e.to_string())?;

    tracing::info!(
        "[ControlPanelWindow] Created standalone window with instance_id: {}",
        instance_id
    );

    Ok(instance_id)
}

/// Closes a standalone control panel window by instance ID
pub fn close_control_panel_window(app: AppHandle, instance_id: String) -> Result<(), String> {
    let label = format!("control-panel-window-{}", instance_id);

    tracing::info!(
        "[ControlPanelWindow] close_control_panel_window called for: {}",
        label
    );

    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    // unregister happens in on_window_event handler
    Ok(())
}

/// Gets the data for a control panel window instance
pub fn get_control_panel_window_data(
    instance_id: String,
) -> Result<ControlPanelWindowInstance, String> {
    get_window_instance(&instance_id)
        .ok_or_else(|| format!("Window instance {} not found", instance_id))
}

/// Lists all open standalone control panel windows
pub fn list_control_panel_window_instances() -> Vec<(String, ControlPanelWindowInstance)> {
    list_control_panel_windows()
}

