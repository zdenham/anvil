# Simple Task Panel Size/Position Reset on Close

## Problem Statement

The simple task panel is draggable and resizable. When the user drags or resizes it, those changes persist across invocations. The next time the simple task panel is opened, it appears at the previous position and size instead of resetting to defaults (centered on screen, 650×750).

## Root Cause Analysis

### Current Flow

1. User opens spotlight → creates a task → simple task panel opens (centered, default size)
2. User drags or resizes the simple task panel
3. Simple task panel loses focus → `window_did_resign_key` fires → panel hides
4. Panel is hidden but **retains its position and size** as macOS window state
5. User invokes spotlight again → creates another task → simple task panel opens
6. `show_simple_task` repositions to center using `setFrameTopLeftPoint` but **does not reset the size**
7. Simple task panel appears centered but at the **wrong (user-modified) size**

Additionally, if the user drags the panel and closes it:
- The next `show_simple_task` call repositions the *top-left corner* to center
- But if the panel was resized to be larger, it may extend off-screen

### The Bug Location

In `src-tauri/src/panels.rs`, the `show_simple_task` function (lines 1040-1095):

```rust
pub fn show_simple_task(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    prompt: Option<&str>,
) -> Result<(), String> {
    // ...
    match app.get_webview_panel(SIMPLE_TASK_LABEL) {
        Ok(panel) => {
            // Reposition panel to center of the screen where the cursor is
            let (x, y) = calculate_centered_panel_position_cocoa(app, SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));
            // ❌ Missing: panel.set_content_size(SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT);

            panel.show_and_make_key();
            // ...
        }
    }
}
```

The function calculates the centered position using the **default dimensions** (`SIMPLE_TASK_WIDTH`, `SIMPLE_TASK_HEIGHT`), but doesn't actually reset the panel size to those dimensions before showing.

## Proposed Fix

Reset the panel size to defaults before showing it:

```rust
pub fn show_simple_task(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    prompt: Option<&str>,
) -> Result<(), String> {
    // ...
    match app.get_webview_panel(SIMPLE_TASK_LABEL) {
        Ok(panel) => {
            // Reset panel size to defaults (user may have resized it)
            panel.set_content_size(SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT);

            // Reposition panel to center of the screen where the cursor is
            let (x, y) = calculate_centered_panel_position_cocoa(app, SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT);
            panel
                .as_panel()
                .setFrameTopLeftPoint(tauri_nspanel::NSPoint::new(x, y));

            // ... rest of function
        }
    }
}
```

**Why reset on show (not on hide):**
1. The panel is hidden when it loses focus - resizing a hidden panel is wasteful
2. Resetting on show guarantees correct size regardless of how the panel was closed
3. Single location change, no frontend modifications needed
4. Consistent with the existing pattern of repositioning on show

## Files to Modify

1. `src-tauri/src/panels.rs` - Add `panel.set_content_size(SIMPLE_TASK_WIDTH, SIMPLE_TASK_HEIGHT)` in `show_simple_task` before setting the frame position

## Testing Plan

1. Open spotlight, type a query, select "Create task"
2. Simple task panel opens centered at default size (650×750)
3. Drag the panel to a corner of the screen
4. Resize the panel (make it larger or smaller)
5. Click outside to close the panel (or press Escape)
6. Open spotlight again, create another task
7. **Expected:** Simple task panel opens centered at default size (650×750)
8. **Previously:** Simple task panel opened at whatever size/position it was previously
