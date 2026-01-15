# Fix: Main Window Doesn't Reopen After Close

## Problem Summary

When the main window is closed (Cmd+W or red button), it's **destroyed** rather than hidden. Later attempts to reopen it via spotlight fail because:
1. `get_webview_window()` returns `None` - the window no longer exists
2. A headless Tauri process remains running (terminal exec icon in dock)
3. Quitting that process exits with code 0

## Root Cause

**Missing window close event handler** in `src-tauri/src/lib.rs`. Tauri destroys windows by default when closed. There's no code to intercept `closeRequested` and hide the window instead.

The current `show_main_window` command (lib.rs:191-211) assumes the window still exists:
```rust
if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    window.show()...
} else {
    tracing::warn!("Main window not found!");  // <- Logs but doesn't recreate
}
```

## Fix

### Step 1: Add Window Close Event Handler

In `src-tauri/src/lib.rs`, add an `on_window_event` handler to the builder that intercepts close requests for the main window and hides it instead of destroying it:

```rust
.on_window_event(|window, event| {
    if window.label() == MAIN_WINDOW_LABEL {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            let _ = window.hide();
        }
    }
})
```

This should be added to the Tauri builder chain in `run()` function (around line 274), before `.setup()`.

### Step 2: (Optional) Add Window Recreation Fallback

As a fallback in case the window is somehow destroyed, modify `show_main_window` to recreate the window if it doesn't exist:

```rust
#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        // Window was destroyed - recreate it
        tracing::info!("Main window not found, recreating...");
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            MAIN_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html".into())
        )
        .title("Mort")
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }
}
```

## Files to Modify

1. **`src-tauri/src/lib.rs`**
   - Add `.on_window_event()` handler before `.setup()`
   - Optionally update `show_main_window` to recreate window if missing

## Expected Behavior After Fix

1. User closes main window -> Window is hidden, not destroyed
2. User triggers spotlight -> Opens spotlight panel
3. User searches "Mort" and selects it -> `show_main_window()` is called
4. Main window reappears (it was just hidden)
5. No terminal exec icon in dock
