# Plan: Inbox List Panel Improvements

## Overview

Two enhancements for the inbox list panel (the unified list of threads and plans shown during Alt+Down/Up navigation):

1. **Close on unfocus**: Panel should hide when it loses focus (blur), like other panels
2. **Add drag helpers**: Enable dragging the panel like the control panel

## Current State

### Issue 1: Panel does not close on unfocus

The inbox list panel is **intentionally missing** a blur event handler on the Rust side. Looking at `src-tauri/src/panels.rs:1118-1121`:

```rust
// NOTE: Unlike other panels, we intentionally do NOT set up a blur handler here.
// The inbox-list panel's hide is managed explicitly via hide_inbox_list_panel().
// This avoids race conditions from multiple hide paths (blur + explicit hide).
```

The frontend (`InboxListWindow.tsx:181-191`) does call `navigation_panel_blur` on window blur, which goes through the navigation mode state machine. However, this only works **during active navigation mode** (when Alt is held). If the user clicks on the panel directly without using Alt+navigation, the panel stays open.

**Root cause**: The panel lacks a native `window_did_resign_key` event handler like other panels have.

### Issue 2: No drag helpers

The control panel uses `useWindowDrag` hook which provides:
- Drag from anywhere when unfocused (quick repositioning)
- Drag only from header when focused (enables text selection)
- Pin panel on drag (so it stays visible after blur)
- Double-click to close

The inbox list panel currently has no drag functionality at all.

## Implementation Steps

### Step 1: Add Blur Event Handler for Inbox List Panel (Rust)

**File**: `src-tauri/src/panels.rs`

Add an event handler type and wire it up, similar to the control panel but simpler (no pinned state needed for navigation panel):

1. Add `InboxListPanelEventHandler` to the `tauri_panel!` block (around line 164):

```rust
// Event handler for inbox list panel - hides on blur (resign key)
panel_event!(InboxListPanelEventHandler {
    window_did_resign_key(notification: &NSNotification) -> ()
})
```

2. In `create_inbox_list_panel()` (around line 1118), set up the event handler:

```rust
// Set up event handler to hide panel when it loses focus (blur)
let event_handler = InboxListPanelEventHandler::new();
event_handler.window_did_resign_key(|_notification| {
    if let Some(app) = APP_HANDLE.get() {
        if let Ok(panel) = app.get_webview_panel(INBOX_LIST_PANEL_LABEL) {
            tracing::info!("[InboxListPanel] Hiding panel on blur");
            panel.hide();
        }
        // Also cancel navigation mode if active
        crate::navigation_mode::get_navigation_mode().on_panel_blur();
        // Emit event so frontend can reset state
        let _ = app.emit("inbox-list-panel-hidden", ());
    }
});
panel.set_event_handler(Some(event_handler.as_ref()));
```

### Step 2: Add Pinned State for Inbox List Panel (Rust)

**File**: `src-tauri/src/panels.rs`

Add pinned state management (similar to control panel) to support dragging without closing:

```rust
// Global storage for inbox list panel pinned state
static INBOX_LIST_PANEL_PINNED: OnceLock<Mutex<bool>> = OnceLock::new();

fn get_inbox_list_panel_pinned_mutex() -> &'static Mutex<bool> {
    INBOX_LIST_PANEL_PINNED.get_or_init(|| Mutex::new(false))
}

/// Pin the inbox list panel (prevents hide on blur)
pub fn pin_inbox_list_panel() {
    if let Ok(mut guard) = get_inbox_list_panel_pinned_mutex().lock() {
        tracing::info!("[InboxListPanel] Pinning panel");
        *guard = true;
    }
}

/// Unpin the inbox list panel (allows hide on blur)
pub fn unpin_inbox_list_panel() {
    if let Ok(mut guard) = get_inbox_list_panel_pinned_mutex().lock() {
        tracing::info!("[InboxListPanel] Unpinning panel");
        *guard = false;
    }
}

/// Check if inbox list panel is pinned
pub fn is_inbox_list_panel_pinned() -> bool {
    if let Ok(guard) = get_inbox_list_panel_pinned_mutex().lock() {
        *guard
    } else {
        false
    }
}
```

Update the blur handler to check pinned state:

```rust
event_handler.window_did_resign_key(|_notification| {
    // Check if panel is pinned (during drag)
    if is_inbox_list_panel_pinned() {
        tracing::info!("[InboxListPanel] Blur ignored - panel is pinned");
        return;
    }
    // ... existing hide logic
});
```

Update `hide_inbox_list_panel()` to clear pinned state.

### Step 3: Add Tauri Commands (Rust)

**File**: `src-tauri/src/lib.rs`

Add Tauri commands for the new functions:

```rust
#[tauri::command]
fn pin_inbox_list_panel() {
    panels::pin_inbox_list_panel();
}

#[tauri::command]
fn unpin_inbox_list_panel() {
    panels::unpin_inbox_list_panel();
}
```

Register them in the builder's `invoke_handler`.

### Step 4: Make Panel Resizable (Rust)

**File**: `src-tauri/src/panels.rs`

Update the panel builder to allow resizing (needed for drag behavior consistency):

```rust
// In create_inbox_list_panel(), change:
.style_mask(StyleMask::empty().borderless().nonactivating_panel())
// To:
.style_mask(StyleMask::empty().borderless().resizable().nonactivating_panel())

// And:
.resizable(false)
// To:
.resizable(true)
```

Also add `accept_first_mouse(true)` to enable drag on first click.

### Step 5: Integrate useWindowDrag Hook (Frontend)

**File**: `src/components/inbox-list/InboxListWindow.tsx`

1. Import the hook:
```typescript
import { useWindowDrag } from "@/hooks/use-window-drag";
```

2. Initialize with inbox-list-specific commands:
```typescript
const { dragProps } = useWindowDrag({
  pinCommand: "pin_inbox_list_panel",
  hideCommand: "hide_inbox_list_panel",
  enableDoubleClickClose: true,
});
```

3. Apply drag props to the container:
```typescript
<div
  className={`flex flex-col h-screen bg-surface-900 rounded-lg overflow-hidden ${dragProps.className}`}
  onMouseDown={dragProps.onMouseDown}
  onDoubleClick={dragProps.onDoubleClick}
>
```

4. Mark the header as the drag region:
```typescript
<div
  data-drag-region="header"
  className="px-4 py-3 border-b border-surface-700 flex items-center justify-between"
>
```

### Step 6: Update Blur Handler Logic (Frontend)

**File**: `src/components/inbox-list/InboxListWindow.tsx`

The existing blur handler (lines 181-191) calls `navigation_panel_blur` which is specific to navigation mode. Since we now have native blur handling via the event handler, we can simplify:

The native handler will hide the panel on blur. The frontend blur handler should still notify navigation mode to cancel if active, but the panel hiding is now handled natively.

No changes needed here - the existing code will still work, and the native handler provides backup for non-navigation scenarios.

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/panels.rs` | Add event handler, pinned state, update panel config |
| `src-tauri/src/lib.rs` | Add Tauri commands for pin/unpin |
| `src/components/inbox-list/InboxListWindow.tsx` | Integrate `useWindowDrag` hook, mark header |

## Testing

1. **Blur to close (no navigation mode)**:
   - Open inbox panel via any method
   - Click outside the panel
   - Panel should close

2. **Blur to close (during navigation)**:
   - Hold Alt, press Down to start navigation
   - Click outside the panel
   - Panel should close and navigation should cancel

3. **Drag when unfocused**:
   - Open inbox panel
   - Click away to unfocus it (keeping it visible via pin)
   - Click and drag anywhere on the panel
   - Panel should drag

4. **Drag when focused (header only)**:
   - Open inbox panel and focus it
   - Try to drag from content area - should not work (enables text selection)
   - Drag from header - should work

5. **Pin during drag**:
   - Open inbox panel
   - Start dragging
   - Panel should remain visible even though it lost focus during drag

6. **Double-click to close**:
   - Open inbox panel
   - Double-click on non-interactive area
   - Panel should close

## Success Criteria

- [ ] Panel closes when clicking outside (unfocus)
- [ ] Panel can be dragged from anywhere when unfocused
- [ ] Panel can only be dragged from header when focused
- [ ] Panel stays visible during drag operations
- [ ] Double-click closes the panel
- [ ] Navigation mode still works correctly (Alt+Down/Up)
- [ ] Escape key still cancels and closes
