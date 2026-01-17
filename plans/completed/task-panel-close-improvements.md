# Task Panel Close Improvements

## Goal
Improve the task panel UX by:
1. Adding Escape key support to close the panel when focused
2. Adding an "X" close button in the top right corner
3. Removing the auto-hide on unfocus behavior

## Current Behavior

The task panel is implemented as a macOS NSPanel that:
- Auto-hides when it loses focus (blur event) via `TasksListEventHandler.window_did_resign_key`
- Can be toggled via hotkey
- Has no explicit close button in the UI
- Has no keyboard shortcut to dismiss

**Key Files:**
- `src/components/tasks-panel/tasks-panel.tsx` - React component
- `src-tauri/src/panels.rs` - Native panel creation and event handling
- `src-tauri/src/task_navigation.rs` - Toggle logic

## Implementation Plan

### Step 1: Remove Auto-Hide on Blur (Rust)

**File:** `src-tauri/src/panels.rs`

Remove or comment out the `window_did_resign_key` handler that auto-hides the panel when it loses focus.

Current code (~lines 1107-1121):
```rust
event_handler.window_did_resign_key(|_notification| {
    if let Some(app) = APP_HANDLE.get() {
        if let Ok(panel) = app.get_webview_panel(TASKS_LIST_LABEL) {
            panel.hide();  // Remove this auto-hide
        }
        let _ = app.emit("panel-hidden", ());
    }
});
```

**Change:** Remove both the `panel.hide()` call AND the `app.emit("panel-hidden", ())` call from the `window_did_resign_key` handler. The event emission must be removed because it would be inaccurate - the panel is not actually hidden when it loses focus, so emitting "panel-hidden" would cause events to not match reality. The entire handler body can be made empty or the handler can be removed entirely.

### Step 2: Add Close Button to UI (React)

**File:** `src/components/tasks-panel/tasks-panel.tsx`

Add an "X" button to the header, positioned in the top right corner.

Current header structure (~lines 90-105):
```tsx
<header className="...">
  <h1 className="...">Tasks</h1>
  <button onClick={handleRefresh}>...</button>
</header>
```

**Change:** Modify header to include a close button:
```tsx
<header className="flex items-center justify-between p-4 border-b border-white/10">
  <h1 className="text-lg font-semibold text-white">Tasks</h1>
  <div className="flex items-center gap-2">
    <button onClick={handleRefresh} ...>
      {/* Refresh icon */}
    </button>
    <button
      onClick={handleClose}
      className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white"
      aria-label="Close panel"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
</header>
```

Add handler:
```tsx
const handleClose = useCallback(async () => {
  await invoke("hide_tasks_panel");
}, []);
```

### Step 3: Add Escape Key Handler (React)

**File:** `src/components/tasks-panel/tasks-panel.tsx`

Add a `useEffect` to listen for the Escape key and close the panel.

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      invoke("hide_tasks_panel");
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

## Testing Checklist

- [ ] Panel no longer hides when clicking outside of it
- [ ] Pressing Escape while panel is focused closes it
- [ ] Clicking the X button closes the panel
- [ ] Hotkey toggle still works correctly
- [ ] Panel can still be shown after being closed via X or Escape
- [ ] Refresh button still works

## Risks & Considerations

1. **Focus Management:** With auto-hide removed, users must explicitly close the panel. This is more intentional but requires the close affordances to be discoverable.

2. **Hotkey Conflict:** Ensure Escape doesn't conflict with other keyboard shortcuts when the panel is focused. Since the panel has its own webview, this should be isolated.

3. **Panel Stacking:** Without auto-hide, the panel may remain visible when switching to other apps. This may or may not be desired behavior - monitor user feedback.
