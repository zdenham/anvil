use arboard::Clipboard;
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::clipboard_db::{self, ClipboardEntryPreview};
use crate::panels;

/// Global app handle for emitting events from background thread
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const POLL_INTERVAL_MS: u64 = 500;
const DEFAULT_RESULT_LIMIT: usize = 100;

/// Simulate Cmd+V to paste into the currently active app using native CGEvent API.
/// Since NSPanel doesn't steal focus, the previous app is still frontmost.
fn paste_to_active_app() -> Result<(), String> {
    tracing::info!("paste_to_active_app: starting");

    // Check accessibility permission first
    let has_accessibility = crate::accessibility::is_accessibility_trusted();
    tracing::info!(has_accessibility, "paste_to_active_app: accessibility check");
    if !has_accessibility {
        let err = "Accessibility permission not granted - cannot simulate keyboard events";
        tracing::error!(err);
        return Err(err.to_string());
    }

    // Small delay to ensure panel is fully hidden
    thread::sleep(Duration::from_millis(50));

    // kVK_ANSI_V = 9 (macOS virtual keycode for 'V')
    const KEY_V: CGKeyCode = 9;

    tracing::debug!("paste_to_active_app: creating CGEventSource");
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| {
        let err = "Failed to create CGEventSource (HIDSystemState)";
        tracing::error!(err);
        err.to_string()
    })?;

    // Create key down event with Command modifier
    tracing::debug!("paste_to_active_app: creating key_down event");
    let key_down = CGEvent::new_keyboard_event(source.clone(), KEY_V, true).map_err(|_| {
        let err = "Failed to create key_down CGEvent";
        tracing::error!(err);
        err.to_string()
    })?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);

    // Create key up event with Command modifier
    tracing::debug!("paste_to_active_app: creating key_up event");
    let key_up = CGEvent::new_keyboard_event(source, KEY_V, false).map_err(|_| {
        let err = "Failed to create key_up CGEvent";
        tracing::error!(err);
        err.to_string()
    })?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Post events to the HID event tap (goes to frontmost app)
    tracing::info!("paste_to_active_app: posting key events to HID");
    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);

    tracing::info!("paste_to_active_app: completed successfully");
    Ok(())
}

/// Initialize clipboard monitoring
pub fn initialize(app: &AppHandle) {
    // Store app handle for emitting events
    let _ = APP_HANDLE.set(app.clone());

    // Initialize the database
    clipboard_db::initialize();

    // Log entry count
    if let Ok(count) = clipboard_db::get_entry_count() {
        tracing::info!(entries = count, "Clipboard database initialized");
    }

    // Start monitoring thread
    thread::spawn(|| {
        tracing::info!("Monitoring thread started");
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "Failed to initialize clipboard");
                return;
            }
        };

        let mut last_content: Option<String> = None;

        loop {
            match clipboard.get_text() {
                Ok(content) => {
                    let should_add = match &last_content {
                        Some(last) => last != &content,
                        None => true,
                    };

                    if should_add && !content.trim().is_empty() {
                        // Check if this content already exists as the latest entry
                        let is_duplicate = clipboard_db::get_latest_content()
                            .ok()
                            .flatten()
                            .map(|latest| latest == content)
                            .unwrap_or(false);

                        if !is_duplicate {
                            let preview: String = content.chars().take(50).collect();
                            tracing::debug!(preview = %preview, "New clipboard entry");
                            last_content = Some(content.clone());

                            // Insert into database
                            if let Err(e) = clipboard_db::insert_entry(content, None) {
                                tracing::error!(error = %e, "Failed to insert clipboard entry");
                            }

                            // Notify frontend of new entry
                            if let Some(app) = APP_HANDLE.get() {
                                let _ = app.emit("clipboard-entry-added", ());
                            }
                        } else {
                            last_content = Some(content);
                        }
                    }
                }
                Err(_) => {
                    // Clipboard empty or contains non-text content - this is expected, don't log
                }
            }

            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// Get clipboard history previews, optionally filtered by query
#[tauri::command]
pub fn get_clipboard_history(
    query: Option<String>,
    limit: Option<usize>,
) -> Vec<ClipboardEntryPreview> {
    let limit = limit.unwrap_or(DEFAULT_RESULT_LIMIT);

    let results = match query {
        Some(q) if !q.trim().is_empty() => {
            clipboard_db::search_entries(&q, limit).unwrap_or_default()
        }
        _ => clipboard_db::get_recent_entries(limit).unwrap_or_default(),
    };

    tracing::debug!(count = results.len(), "Returning clipboard history");

    results
}

/// Get full content for a specific entry (for preview panel)
#[tauri::command]
pub fn get_clipboard_content(id: String) -> Option<String> {
    clipboard_db::get_entry_content(&id).ok().flatten()
}

/// Copy an entry back to the clipboard, hide panel, and paste into active app
#[tauri::command]
pub fn paste_clipboard_entry(app: AppHandle, id: String) -> Result<(), String> {
    tracing::info!(id = %id, "paste_clipboard_entry: starting");

    let content = clipboard_db::get_entry_content(&id)
        .map_err(|e| {
            tracing::error!(error = %e, "paste_clipboard_entry: failed to get entry content");
            e.to_string()
        })?
        .ok_or_else(|| {
            tracing::error!(id = %id, "paste_clipboard_entry: entry not found");
            "Entry not found".to_string()
        })?;

    tracing::debug!(content_len = content.len(), "paste_clipboard_entry: retrieved content");

    // Set clipboard
    let mut clipboard = Clipboard::new().map_err(|e| {
        tracing::error!(error = %e, "paste_clipboard_entry: failed to create clipboard");
        e.to_string()
    })?;
    clipboard.set_text(&content).map_err(|e| {
        tracing::error!(error = %e, "paste_clipboard_entry: failed to set clipboard text");
        e.to_string()
    })?;

    tracing::info!("paste_clipboard_entry: clipboard set successfully");

    // Hide the clipboard panel
    if let Err(e) = panels::hide_clipboard(&app) {
        tracing::warn!(error = %e, "paste_clipboard_entry: failed to hide panel (continuing anyway)");
    }

    // Paste into the active app (NSPanel doesn't steal focus, so it's still frontmost)
    paste_to_active_app()?;

    tracing::info!("paste_clipboard_entry: completed successfully");
    Ok(())
}

/// Hide the clipboard manager panel
#[tauri::command]
pub fn hide_clipboard_manager(app: AppHandle) -> Result<(), String> {
    panels::hide_clipboard(&app)
}

/// Toggle the clipboard manager panel visibility
pub fn toggle_clipboard_manager(app: &AppHandle) {
    panels::toggle_clipboard(app);
}
