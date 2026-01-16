//! NSPanel definitions and creation helpers for spotlight-style windows.
//!
//! Uses tauri-nspanel to create true macOS NSPanels that can appear
//! above fullscreen applications and behave like utility panels.

use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::NSWindowAnimationBehavior;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask,
};
use crate::task_navigation;


// ═══════════════════════════════════════════════════════════════════════════
// Pending Task State (Pull Model for HMR resilience)
// ═══════════════════════════════════════════════════════════════════════════

/// Information about a pending task to be displayed in the task panel.
/// This is stored before showing the panel and retrieved by the React app on mount.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingTask {
    pub thread_id: String,
    pub task_id: String,
    pub prompt: Option<String>,
    pub repo_name: Option<String>,
}

/// Global storage for pending task - survives HMR/page reloads
static PENDING_TASK: OnceLock<Mutex<Option<PendingTask>>> = OnceLock::new();

fn get_pending_task_mutex() -> &'static Mutex<Option<PendingTask>> {
    PENDING_TASK.get_or_init(|| Mutex::new(None))
}

/// Store a pending task (called before showing panel)
pub fn set_pending_task(task: PendingTask) {
    if let Ok(mut guard) = get_pending_task_mutex().lock() {
        tracing::info!("Storing pending task: {:?}", task);
        *guard = Some(task);
    }
}

/// Retrieve the pending task (does NOT clear - survives HMR reloads)
/// The pending task is only cleared when a new task is set or panel is hidden
pub fn get_pending_task() -> Option<PendingTask> {
    if let Ok(guard) = get_pending_task_mutex().lock() {
        let task = guard.clone();
        tracing::info!("Retrieved pending task (not clearing): {:?}", task);
        task
    } else {
        None
    }
}

/// Clear the pending task (called when panel is hidden)
pub fn clear_pending_task() {
    if let Ok(mut guard) = get_pending_task_mutex().lock() {
        tracing::info!("Clearing pending task");
        *guard = None;
    }
}

/// Peek at the pending task without clearing it (same as get_pending_task now)
pub fn peek_pending_task() -> Option<PendingTask> {
    get_pending_task()
}

// Panel labels
pub const SPOTLIGHT_LABEL: &str = "spotlight";
pub const CLIPBOARD_LABEL: &str = "clipboard";
pub const TASK_LABEL: &str = "task";
pub const ERROR_LABEL: &str = "error";
pub const TASKS_LIST_LABEL: &str = "tasks-list";

// Window dimensions
pub const SPOTLIGHT_WIDTH: f64 = 570.0;
pub const SPOTLIGHT_HEIGHT: f64 = 84.0;
pub const SPOTLIGHT_HEIGHT_EXPANDED: f64 = 210.0;
pub const CLIPBOARD_WIDTH: f64 = 570.0;
pub const CLIPBOARD_HEIGHT: f64 = 400.0;
pub const TASK_WIDTH: f64 = 1200.0;
pub const TASK_HEIGHT: f64 = 800.0;
pub const ERROR_WIDTH: f64 = 500.0;
pub const ERROR_HEIGHT: f64 = 300.0;
pub const SIMPLE_TASK_WIDTH: f64 = 650.0;
pub const SIMPLE_TASK_HEIGHT: f64 = 750.0;
pub const TASKS_LIST_WIDTH: f64 = 600.0;
pub const TASKS_LIST_HEIGHT: f64 = 500.0;
pub const RESULT_ITEM_HEIGHT: f64 = 56.0;
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

    // Task panel for displaying task workspace
    panel!(TaskPanel {
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

    // Simple task panel for lightweight task display
    panel!(SimpleTaskPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    // Tasks list panel for displaying all tasks
    panel!(TasksListPanel {
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

    // Event handler for task panel - hides on blur (resign key)
    panel_event!(TaskEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for error panel - hides on blur (resign key)
    panel_event!(ErrorEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for simple task panel - hides on blur (resign key)
    panel_event!(SimpleTaskEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })

    // Event handler for tasks list panel - hides on blur (resign key)
    panel_event!(TasksListEventHandler {
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
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        // Reposition panel to the screen where the cursor is
        let (x, y) = calculate_panel_position_cocoa(app, SPOTLIGHT_WIDTH);
        panel
            .as_panel()
            .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
        panel.show_and_make_key();
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
            panel.hide();
        } else {
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, SPOTLIGHT_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();
        }
    }
}

/// Resizes the spotlight panel based on result count and input expansion state
pub fn resize_spotlight(
    app: &AppHandle,
    result_count: usize,
    input_expanded: bool,
) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        let base_height = if input_expanded {
            SPOTLIGHT_HEIGHT_EXPANDED
        } else {
            SPOTLIGHT_HEIGHT
        };
        let visible_results = result_count.min(MAX_VISIBLE_RESULTS);
        let results_height = visible_results as f64 * RESULT_ITEM_HEIGHT;
        let new_height = base_height + results_height;

        panel.set_content_size(SPOTLIGHT_WIDTH, new_height);
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

/// Creates the task panel (hidden by default)
pub fn create_task_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("====== CREATING TASK PANEL ======");

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let screen_width = monitor_size.width as f64 / scale_factor;
    let screen_height = monitor_size.height as f64 / scale_factor;

    // Calculate centered position (both horizontally and vertically)
    let x = (screen_width - TASK_WIDTH) / 2.0;
    let y = (screen_height - TASK_HEIGHT) / 2.0;

    let panel = PanelBuilder::<_, TaskPanel>::new(app, TASK_LABEL)
        .url(WebviewUrl::App("task.html".into()))
        .size(Size::Logical(LogicalSize::new(
            TASK_WIDTH,
            TASK_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(true)
        .hides_on_deactivate(false)
        .transparent(false)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(true)
                .visible(false)
                .transparent(false)
                .title("task")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = TaskEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(TASK_LABEL) {
                panel.hide();
            }
            // Emit event so frontend can reset state
            let _ = app.emit_to(TASK_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    tracing::info!("====== TASK PANEL CREATED (hidden) ======");
    Ok(())
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

/// Shows the task panel and emits an event to open a specific task
/// If prompt is provided, includes it for optimistic UI display
/// task_id is required - all threads must be associated with a task
pub fn show_task(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    prompt: Option<&str>,
    repo_name: Option<&str>,
) -> Result<(), String> {
    match app.get_webview_panel(TASK_LABEL) {
        Ok(panel) => {
            tracing::info!(thread_id = %thread_id, task_id = %task_id, prompt = ?prompt, "====== SHOW_TASK CALLED ======");

            // Store pending task BEFORE showing panel (Pull Model for HMR resilience)
            // React will retrieve this on mount, even after HMR reloads
            set_pending_task(PendingTask {
                thread_id: thread_id.to_string(),
                task_id: task_id.to_string(),
                prompt: prompt.map(|s| s.to_string()),
                repo_name: repo_name.map(|s| s.to_string()),
            });

            // Reposition panel to center of the screen where the cursor is
            let (x, y) =
                calculate_centered_panel_position_cocoa(app, TASK_WIDTH, TASK_HEIGHT);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));

            // Build event payload
            let mut payload = serde_json::json!({
                "threadId": thread_id,
                "taskId": task_id
            });
            if let Some(p) = prompt {
                payload["prompt"] = serde_json::json!(p);
            }
            if let Some(r) = repo_name {
                payload["repoName"] = serde_json::json!(r);
            }

            // Show panel first, then emit event
            tracing::info!("About to call panel.show_and_make_key()");
            panel.show_and_make_key();
            tracing::info!("panel.show_and_make_key() completed, panel is now visible");

            // Also emit event for backwards compatibility (React may receive either)
            tracing::info!("About to emit 'open-task' event with payload: {:?}", payload);
            match app.emit("open-task", &payload) {
                Ok(_) => tracing::info!("====== open-task EVENT EMITTED SUCCESSFULLY ======"),
                Err(e) => tracing::error!("Failed to emit open-task: {:?}", e),
            }

            Ok(())
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to get task panel - panel may not be created");
            Err(format!("Task panel not available: {:?}", e))
        }
    }
}

/// Hides the task panel
pub fn hide_task(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(TASK_LABEL) {
        panel.hide();
    }
    Ok(())
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
// Pending Simple Task State (Pull Model for HMR resilience)
// ═══════════════════════════════════════════════════════════════════════════

/// Information about a pending simple task to be displayed in the simple task panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingSimpleTask {
    pub thread_id: String,
    pub task_id: String,
    pub prompt: Option<String>,
}

/// Global storage for pending simple task
static PENDING_SIMPLE_TASK: OnceLock<Mutex<Option<PendingSimpleTask>>> = OnceLock::new();

fn get_pending_simple_task_mutex() -> &'static Mutex<Option<PendingSimpleTask>> {
    PENDING_SIMPLE_TASK.get_or_init(|| Mutex::new(None))
}

/// Store a pending simple task (called before showing panel)
pub fn set_pending_simple_task(task: PendingSimpleTask) {
    if let Ok(mut guard) = get_pending_simple_task_mutex().lock() {
        tracing::info!("[SimpleTaskPanel] Storing pending simple task: {:?}", task);
        *guard = Some(task);
    }
}

/// Retrieve the pending simple task
pub fn get_pending_simple_task() -> Option<PendingSimpleTask> {
    if let Ok(guard) = get_pending_simple_task_mutex().lock() {
        guard.clone()
    } else {
        None
    }
}

/// Clear the pending simple task
pub fn clear_pending_simple_task() {
    if let Ok(mut guard) = get_pending_simple_task_mutex().lock() {
        tracing::info!("[SimpleTaskPanel] Clearing pending simple task");
        *guard = None;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple Task Panel
// ═══════════════════════════════════════════════════════════════════════════

pub const SIMPLE_TASK_LABEL: &str = "simple-task";

/// Creates the simple task panel (hidden by default) - called once at startup
pub fn create_simple_task_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("[SimpleTaskPanel] Creating simple task panel at startup");

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
    let x = (screen_width - SIMPLE_TASK_WIDTH) / 2.0;
    let y = (screen_height - SIMPLE_TASK_HEIGHT) / 2.0;

    let panel = PanelBuilder::<_, SimpleTaskPanel>::new(app, SIMPLE_TASK_LABEL)
        .url(WebviewUrl::App("simple-task.html".into()))
        .size(Size::Logical(LogicalSize::new(
            SIMPLE_TASK_WIDTH,
            SIMPLE_TASK_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(true)
        .hides_on_deactivate(false)
        .transparent(false)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(true)
                .visible(false)
                .transparent(false)
                .title("simple-task")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = SimpleTaskEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
                panel.hide();
            }
            // Clear pending simple task when panel is hidden
            clear_pending_simple_task();
            // Emit event so frontend can reset state
            let _ = app.emit_to(SIMPLE_TASK_LABEL, "panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    tracing::info!("[SimpleTaskPanel] Simple task panel created (hidden)");
    Ok(())
}

/// Shows the simple task panel with the given task info
pub fn show_simple_task(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    prompt: Option<&str>,
) -> Result<(), String> {
    tracing::info!("[SimpleTaskPanel] show_simple_task called: thread_id={}, task_id={}", thread_id, task_id);

    // Store pending simple task BEFORE showing panel (Pull Model for HMR resilience)
    tracing::info!("[SimpleTaskPanel] Storing pending simple task...");
    set_pending_simple_task(PendingSimpleTask {
        thread_id: thread_id.to_string(),
        task_id: task_id.to_string(),
        prompt: prompt.map(|s| s.to_string()),
    });
    tracing::info!("[SimpleTaskPanel] Pending simple task stored");

    tracing::info!("[SimpleTaskPanel] Getting panel with label: {}", SIMPLE_TASK_LABEL);
    match app.get_webview_panel(SIMPLE_TASK_LABEL) {
        Ok(panel) => {
            tracing::info!("[SimpleTaskPanel] Got panel, calculating position...");
            // Reposition panel to center of the screen where the cursor is
            let (x, y) = calculate_centered_panel_position_cocoa(app, SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT);
            tracing::info!("[SimpleTaskPanel] Position: ({}, {}), setting frame...", x, y);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            tracing::info!("[SimpleTaskPanel] Frame set");

            // Emit event to frontend with task info
            let payload = serde_json::json!({
                "threadId": thread_id,
                "taskId": task_id,
                "prompt": prompt
            });
            tracing::info!("[SimpleTaskPanel] Emitting open-simple-task event...");
            let _ = app.emit("open-simple-task", &payload);
            tracing::info!("[SimpleTaskPanel] Event emitted");

            // Show the panel and ensure it's focused
            tracing::info!("[SimpleTaskPanel] Calling show_and_make_key...");
            panel.show_and_make_key();

            // Force focus even if panel was already visible
            // This is crucial for navigation between tasks where the same panel instance is reused
            tracing::info!("[SimpleTaskPanel] Ensuring panel is key window...");
            panel.as_panel().makeKeyAndOrderFront(None);
            tracing::info!("[SimpleTaskPanel] Panel focused successfully");

            Ok(())
        }
        Err(e) => {
            tracing::error!("[SimpleTaskPanel] Failed to get panel: {:?}", e);
            Err(format!("Simple task panel not available: {:?}", e))
        }
    }
}

/// Hides the simple task panel
pub fn hide_simple_task(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
        panel.hide();
        // Clear pending simple task when panel is hidden
        clear_pending_simple_task();
        // Emit event so frontend can reset state
        let _ = app.emit_to(SIMPLE_TASK_LABEL, "panel-hidden", ());
    }
    Ok(())
}

/// Forces focus on the simple task panel if it's visible (hack for focus restoration)
pub fn focus_simple_task_panel(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
        if panel.is_visible() {
            tracing::debug!("[SimpleTaskPanel] Force focusing panel via makeKeyAndOrderFront");
            panel.as_panel().makeKeyAndOrderFront(None);
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Tasks List Panel
// ═══════════════════════════════════════════════════════════════════════════

/// Creates the tasks list panel (hidden by default) - called once at startup
pub fn create_tasks_list_panel(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("[TasksListPanel] Creating tasks list panel at startup");

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .ok_or("No primary monitor found")?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // Calculate center position (horizontally centered, ~20% from top)
    let x = ((monitor_size.width as f64 / scale_factor) - TASKS_LIST_WIDTH) / 2.0;
    let y = (monitor_size.height as f64 / scale_factor) * 0.2;

    let panel = PanelBuilder::<_, TasksListPanel>::new(app, TASKS_LIST_LABEL)
        .url(WebviewUrl::App("tasks-panel.html".into()))
        .size(Size::Logical(LogicalSize::new(
            TASKS_LIST_WIDTH,
            TASKS_LIST_HEIGHT,
        )))
        .position(Position::Logical(LogicalPosition::new(x, y)))
        .level(PanelLevel::ScreenSaver)
        .collection_behavior(
            CollectionBehavior::new()
                .move_to_active_space()
                .full_screen_auxiliary(),
        )
        .style_mask(StyleMask::empty().borderless().nonactivating_panel())
        .has_shadow(true)
        .hides_on_deactivate(false)
        .transparent(true)
        .no_activate(true)
        .with_window(|w| {
            w.decorations(false)
                .resizable(true)
                .visible(false)
                .transparent(true)
                .title("tasks-list")
        })
        .build()?;

    // Disable macOS Tahoe window animations for snappy appearance
    panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None);

    // Set up event handler to hide panel when it loses focus (blur)
    let event_handler = TasksListEventHandler::new();
    event_handler.window_did_resign_key(|_notification| {
        if let Some(app) = APP_HANDLE.get() {
            if let Ok(panel) = app.get_webview_panel(TASKS_LIST_LABEL) {
                panel.hide();
            }
            // If navigation mode is active, emit task selection before ending navigation
            if task_navigation::is_navigation_mode_active() {
                let _ = app.emit("task-selection", &());
            }
            // Reset navigation mode when panel loses focus
            task_navigation::end_navigation_mode(app);
            // Emit event so frontend can reset state
            let _ = app.emit("panel-hidden", ());
        }
    });
    panel.set_event_handler(Some(event_handler.as_ref()));

    // Ensure panel starts hidden
    panel.hide();

    tracing::info!("[TasksListPanel] Tasks list panel created (hidden)");
    Ok(())
}

/// Shows the tasks list panel
pub fn show_tasks_list(app: &AppHandle) -> Result<(), String> {
    tracing::info!("[TasksListPanel] show_tasks_list called");

    match app.get_webview_panel(TASKS_LIST_LABEL) {
        Ok(panel) => {
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, TASKS_LIST_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();
            tracing::info!("[TasksListPanel] Panel shown");

            // Emit panel-shown event so frontend can refresh data
            let _ = app.emit_to(TASKS_LIST_LABEL, "panel-shown", ());

            Ok(())
        }
        Err(e) => {
            tracing::error!("[TasksListPanel] Failed to get panel: {:?}", e);
            Err(format!("Tasks list panel not available: {:?}", e))
        }
    }
}

/// Hides the tasks list panel
pub fn hide_tasks_list(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(TASKS_LIST_LABEL) {
        panel.hide();
    }
    Ok(())
}

/// Toggles the tasks list panel visibility
/// Returns: (was_visible, is_now_visible)
/// NOTE: This function may become dead code after the navigation mode change.
/// The hotkey handler will call show_tasks_list() directly instead of toggling.
/// Consider deprecating if no other callers exist.
pub fn toggle_tasks_list(app: &AppHandle) -> (bool, bool) {
    if let Ok(panel) = app.get_webview_panel(TASKS_LIST_LABEL) {
        let was_visible = panel.is_visible();
        if was_visible {
            // If navigation mode is active, emit task selection before ending navigation
            if task_navigation::is_navigation_mode_active() {
                let _ = app.emit("task-selection", &());
            }
            panel.hide();
            task_navigation::end_navigation_mode(app);
            (true, false)
        } else {
            // Reposition panel to the screen where the cursor is
            let (x, y) = calculate_panel_position_cocoa(app, TASKS_LIST_WIDTH);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            panel.show_and_make_key();

            // Emit panel-shown event so frontend can refresh data
            let _ = app.emit_to(TASKS_LIST_LABEL, "panel-shown", ());

            (false, true)
        }
    } else {
        (false, false)
    }
}

/// Checks if any nspanel is currently visible
/// Returns true if at least one of the panels (spotlight, clipboard, task, error, simple-task, tasks-list) is visible
pub fn is_any_panel_visible(app: &AppHandle) -> bool {
    let panel_labels = [
        SPOTLIGHT_LABEL,
        CLIPBOARD_LABEL,
        TASK_LABEL,
        ERROR_LABEL,
        SIMPLE_TASK_LABEL,
        TASKS_LIST_LABEL,
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
