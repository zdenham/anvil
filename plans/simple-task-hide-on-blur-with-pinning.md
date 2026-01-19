# Simple Task Panel: Hide-on-Blur with Pinning

## Background

### Previous Behavior (before commit `d0d978e`)
The simple task panel used to hide automatically when it lost focus (blur). This was implemented using a `SimpleTaskEventHandler` with `window_did_resign_key` that would hide the panel and clear the pending task state.

### Current Behavior (after commit `d0d978e`)
The simple task panel no longer auto-hides on blur. Users must explicitly close it via:
- Escape key
- Double-click on the panel background
- X button (if present)
- Navigating to next task (which hides the current panel)

The reasoning was: "This allows clicking outside the panel without losing the task view."

### Desired New Behavior
Bring back hide-on-blur **unless** the panel has been "pinned" by the user. A panel becomes pinned when:
- The user **resizes** the panel, OR
- The user **moves/drags** the panel

This gives users the best of both worlds:
- Quick ephemeral usage: panel appears, user reads content, clicks elsewhere, panel disappears
- Persistent usage: user positions/sizes the panel to their liking, it stays put

---

## Implementation Plan

### 1. Track "Pinned" State

**Location:** Rust backend (`src-tauri/src/panels.rs`)

Add a global static to track whether the simple task panel is pinned:

```rust
static SIMPLE_TASK_PINNED: OnceLock<Mutex<bool>> = OnceLock::new();

fn get_simple_task_pinned_mutex() -> &'static Mutex<bool> {
    SIMPLE_TASK_PINNED.get_or_init(|| Mutex::new(false))
}

pub fn is_simple_task_pinned() -> bool {
    if let Ok(guard) = get_simple_task_pinned_mutex().lock() {
        *guard
    } else {
        false
    }
}

pub fn set_simple_task_pinned(pinned: bool) {
    if let Ok(mut guard) = get_simple_task_pinned_mutex().lock() {
        tracing::info!("[SimpleTaskPanel] Pinned state set to: {}", pinned);
        *guard = pinned;
    }
}

/// Reset pinned state when panel is explicitly hidden
pub fn clear_simple_task_pinned() {
    set_simple_task_pinned(false);
}
```

### 2. Re-enable the `SimpleTaskEventHandler` with Conditional Logic

**Location:** `create_simple_task_panel` in `src-tauri/src/panels.rs`

Re-add the event handler, but check the pinned state before hiding:

```rust
// Set up event handler to hide panel when it loses focus (blur)
// UNLESS the panel has been pinned (resized or moved by user)
let event_handler = SimpleTaskEventHandler::new();
event_handler.window_did_resign_key(|_notification| {
    // Check if panel is pinned - if so, don't hide on blur
    if is_simple_task_pinned() {
        tracing::debug!("[SimpleTaskPanel] Panel is pinned, not hiding on blur");
        return;
    }

    if let Some(app) = APP_HANDLE.get() {
        if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
            tracing::info!("[SimpleTaskPanel] Hiding panel on blur (not pinned)");
            panel.hide();
        }
        // Clear pending simple task when panel is hidden
        clear_pending_simple_task();
        // Emit event so frontend can reset state
        let _ = app.emit_to(SIMPLE_TASK_LABEL, "panel-hidden", ());
    }
});
panel.set_event_handler(Some(event_handler.as_ref()));
```

### 3. Detect Panel Resize

**Option A: Use macOS window delegate** (preferred if tauri-nspanel supports it)

Check if `tauri-nspanel` exposes `windowDidResize:` or `windowDidEndLiveResize:` delegate methods. If so, add a handler:

```rust
// In tauri_panel! macro - add resize event handler
panel_event!(SimpleTaskResizeHandler {
    window_did_end_live_resize(notification: &NSNotification) -> ()
})

// In create_simple_task_panel:
let resize_handler = SimpleTaskResizeHandler::new();
resize_handler.window_did_end_live_resize(|_notification| {
    tracing::info!("[SimpleTaskPanel] User resized panel - pinning");
    set_simple_task_pinned(true);
});
```

**Option B: Frontend detection via Tauri window events**

If native delegate isn't available, detect resize in the React frontend:

```typescript
// In simple-task-window.tsx
import { getCurrentWindow } from "@tauri-apps/api/window";

useEffect(() => {
  const currentWindow = getCurrentWindow();

  const unlisten = currentWindow.onResized(async () => {
    // User resized the window - pin it
    await invoke("pin_simple_task_panel");
  });

  return () => {
    unlisten.then(fn => fn());
  };
}, []);
```

Add corresponding Tauri command:

```rust
#[tauri::command]
pub fn pin_simple_task_panel() {
    panels::set_simple_task_pinned(true);
}
```

### 4. Detect Panel Move/Drag

**Option A: Use macOS window delegate** (preferred)

```rust
// In tauri_panel! macro
panel_event!(SimpleTaskMoveHandler {
    window_did_move(notification: &NSNotification) -> ()
})

// In create_simple_task_panel:
let move_handler = SimpleTaskMoveHandler::new();
move_handler.window_did_move(|_notification| {
    tracing::info!("[SimpleTaskPanel] User moved panel - pinning");
    set_simple_task_pinned(true);
});
```

**Option B: Frontend detection**

The existing `handleWindowDrag` function in `simple-task-window.tsx` calls `getCurrentWindow().startDragging()`. We can hook into this:

```typescript
const handleWindowDrag = useCallback(async (e: React.MouseEvent) => {
  if (e.button !== 0) return;

  const target = e.target as HTMLElement;
  const interactiveSelector = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';
  if (target.closest(interactiveSelector)) return;

  // Pin the panel since user is manually positioning it
  await invoke("pin_simple_task_panel");

  getCurrentWindow().startDragging().catch((err) => {
    console.error("[SimpleTaskWindow] startDragging failed:", err);
  });
}, []);
```

### 5. Reset Pinned State

The pinned state should be reset when:
1. The panel is explicitly hidden (via Escape, close button, or navigating away)
2. A new task is opened in the panel (reset to unpinned for fresh tasks)

**In `hide_simple_task`:**
```rust
pub fn hide_simple_task(app: &AppHandle) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SIMPLE_TASK_LABEL) {
        panel.hide();
        clear_pending_simple_task();
        clear_simple_task_pinned();  // Reset pinned state
        let _ = app.emit_to(SIMPLE_TASK_LABEL, "panel-hidden", ());
    }
    Ok(())
}
```

**In `show_simple_task`:**
```rust
pub fn show_simple_task(...) -> Result<(), String> {
    // Reset pinned state for fresh panel display
    // (User starts unpinned, can pin by moving/resizing)
    clear_simple_task_pinned();

    // ... rest of the function
}
```

### 6. Update Frontend to Remove Redundant Close Logic (Optional)

With hide-on-blur working again for unpinned panels, some explicit close mechanisms may feel redundant. However, keeping them provides a consistent way to close pinned panels:

- **Escape key**: Keep - explicit close for both pinned and unpinned
- **Double-click**: Could remove, but harmless to keep
- **Close button**: Keep for pinned panels

---

## Files to Modify

1. **`src-tauri/src/panels.rs`**
   - Add `SIMPLE_TASK_PINNED` static and accessor functions
   - Re-enable `SimpleTaskEventHandler` with pinned check
   - Add resize/move detection (if using native delegates)
   - Reset pinned state in `show_simple_task` and `hide_simple_task`

2. **`src-tauri/src/lib.rs`**
   - Add `pin_simple_task_panel` command (if using frontend detection)

3. **`src/components/simple-task/simple-task-window.tsx`**
   - Add resize listener (if using frontend detection)
   - Update `handleWindowDrag` to pin on drag (if using frontend detection)

---

## Testing Checklist

- [ ] Panel hides when clicking outside (blur) when NOT pinned
- [ ] Panel stays visible when clicking outside after being RESIZED
- [ ] Panel stays visible when clicking outside after being MOVED/DRAGGED
- [ ] Escape key closes panel regardless of pinned state
- [ ] Opening a new task resets pinned state (panel will hide on blur again)
- [ ] Explicit hide (via invoke) clears pinned state
- [ ] Focus management still works correctly during task navigation
- [ ] No regressions in keyboard navigation (arrow keys, quick actions)

---

## Open Questions

1. **Should pinned state persist across app restarts?**
   - Recommendation: No, keep it session-only. Each launch starts fresh.

2. **Should there be a visual indicator that the panel is pinned?**
   - Could add a small pin icon or subtle UI change
   - Recommendation: Not necessary for initial implementation, can add later if users request it

3. **What about programmatic moves (reposition on show)?**
   - The `show_simple_task` function repositions the panel to center of cursor screen
   - This should NOT trigger pinning since it's not a user action
   - Solution: Only detect moves AFTER the panel is visible, or use a flag to distinguish programmatic vs user moves

4. **Native delegate vs frontend detection?**
   - Native is cleaner but depends on tauri-nspanel exposing the delegate methods
   - Frontend works but adds async overhead and IPC calls
   - Recommendation: Try native first, fall back to frontend if not available
