# Inbox Navigation Crash Analysis

**Reference Commit:** 8841290ffe92dd5912fa5d96fdaccf55bdfbb604 (tasks-list panel working)
**Issue:** App crashes during Alt+Up/Down navigation mode with the new inbox-list-panel

---

## Key Differences Between Reference and Current Implementation

### 1. Tauri Command Name Mismatch (BUG)

**Reference:** `hide_tasks_panel` command matched frontend invocations

**Current:**
- Frontend calls: `invoke("hide_inbox_list_panel")`
- Tauri command is named: `close_inbox_list_panel`

**Location:**
- `src-tauri/src/lib.rs:434` - command defined as `close_inbox_list_panel`
- `src/components/inbox-list/InboxListWindow.tsx:111,131` - calls `hide_inbox_list_panel`

**Impact:** Frontend invoke calls fail silently (Promise rejection), navigation may get stuck or behave unexpectedly.

---

### 2. Panel Blur Handler Behavior (Design Difference)

**Reference (`create_tasks_list_panel`):**
```rust
// Note: Unlike other panels, tasks-list does NOT auto-hide on blur.
// Users explicitly close it via Escape key or X button.
// This allows clicking outside the panel without losing the task list.

// NO event handler set up - no panel.set_event_handler(...) call
panel.hide();
```

**Current (`create_inbox_list_panel`):**
```rust
// Set up event handler to hide panel when it loses focus (blur)
let event_handler = InboxListPanelEventHandler::new();
event_handler.window_did_resign_key(|_notification| {
    if let Some(app) = APP_HANDLE.get() {
        if let Ok(panel) = app.get_webview_panel(INBOX_LIST_PANEL_LABEL) {
            panel.hide();
        }
        let _ = app.emit_to(INBOX_LIST_PANEL_LABEL, "panel-hidden", ());
        let _ = app.emit("inbox-list-panel-hidden", ());
    }
});
panel.set_event_handler(Some(event_handler.as_ref()));
```

**Impact:** The blur handler creates multiple code paths that can hide the panel, potentially causing race conditions.

---

### 3. Panel Hiding in `on_modifier_released` (New Behavior)

**Reference:** Did NOT hide the tasks panel - only emitted `NavOpen` event
```rust
pub fn on_modifier_released(&self) {
    // ... state transition ...

    // Emit nav-open with selected index (NO panel hiding)
    self.emit(NavigationEvent::NavOpen { selected_index: index });
}
```

**Current:** Hides the inbox-list-panel BEFORE emitting `NavOpen`:
```rust
pub fn on_modifier_released(&self) {
    // ... state transition ...

    // Hide the navigation panel
    if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
        let _ = panels::hide_inbox_list_panel(app);
    }

    // Emit nav-open with selected index
    self.emit(NavigationEvent::NavOpen { selected_index: index });
}
```

**Impact:** Hiding the panel triggers the blur handler, which may cause double-hiding or event emission conflicts.

---

### 4. Panel Hiding in `on_panel_blur` (New Behavior)

**Reference:** Did NOT hide the tasks panel - only emitted `NavCancel` and stopped modifier tap
```rust
pub fn on_panel_blur(&self) {
    // ... state transition ...
    self.stop_modifier_tap();
    self.emit(NavigationEvent::NavCancel);
    // NO panel hiding
}
```

**Current:** Hides the inbox-list-panel:
```rust
pub fn on_panel_blur(&self) {
    // ... state transition ...
    self.stop_modifier_tap();

    // Hide the navigation panel
    if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
        let _ = panels::hide_inbox_list_panel(app);
    }

    self.emit(NavigationEvent::NavCancel);
}
```

---

### 5. Modifier Detection Logic Changes

**Reference:** Dynamic modifier tracking based on hotkey string
```rust
// Parsed hotkey string to determine which modifiers to track
let modifiers = ActiveModifiers::from_hotkey(hotkey);
*self.active_modifiers.lock().unwrap() = modifiers;

// In CGEventTap callback:
let all_modifiers_up = (flags_bits & modifier_mask) == 0;
if all_modifiers_up && !stop_flag_clone.load(Ordering::SeqCst) {
    get_navigation_mode().on_modifier_released();
}
```

**Current:** Hardcoded Option/Alt key tracking with previous state
```rust
// Hardcoded to only track Option/Alt
const OPTION_MASK: u64 = 0x00080000;

// Initialize with Option/Alt already set
let prev_flags = Arc::new(AtomicU64::new(OPTION_MASK));

// In CGEventTap callback:
let old_flags = prev_flags_clone.swap(flags_bits, Ordering::SeqCst);
let option_was_down = (old_flags & OPTION_MASK) != 0;
let option_is_down = (flags_bits & OPTION_MASK) != 0;

if option_was_down && !option_is_down {
    get_navigation_mode().on_modifier_released();
}
```

---

## Likely Crash Causes

### 1. Race Condition with Multiple Hide Paths

The panel can be hidden from three places simultaneously:
1. **Blur handler on the panel itself** - triggers when panel loses focus
2. **`on_modifier_released` in Rust** - explicitly calls `hide_inbox_list_panel`
3. **`on_panel_blur` in Rust** - explicitly calls `hide_inbox_list_panel`

When `on_modifier_released` calls `hide_inbox_list_panel`, this triggers the blur handler (`window_did_resign_key`), which then:
- Tries to hide an already-hiding panel
- Emits `panel-hidden` and `inbox-list-panel-hidden` events
- May call `navigation_panel_blur` from the frontend blur listener

### 2. Mutex Deadlock Potential

In `on_modifier_released`:
```rust
let mut state = self.state.lock().unwrap();  // Lock 1
// ...
if let Some(app) = self.app_handle.lock().unwrap().as_ref() {  // Lock 2
    let _ = panels::hide_inbox_list_panel(app);  // This triggers blur handler
}
```

The blur handler path may eventually call back into navigation mode state.

### 3. Frontend Command Failure

The `invoke("hide_inbox_list_panel")` calls fail because the command doesn't exist (it's `close_inbox_list_panel`). This could leave state inconsistent.

---

## Recommended Fixes

### Fix 1: Rename Command (Critical)
In `src-tauri/src/lib.rs`, rename `close_inbox_list_panel` to `hide_inbox_list_panel`:
```rust
#[tauri::command]
fn hide_inbox_list_panel(app: AppHandle) -> Result<(), String> {
    panels::hide_inbox_list_panel(&app)
}
```

And update the `generate_handler!` macro call.

### Fix 2: Remove Blur Handler (Match Reference Behavior)
In `create_inbox_list_panel`, remove the event handler setup to match the reference implementation:
```rust
// Remove these lines:
// let event_handler = InboxListPanelEventHandler::new();
// event_handler.window_did_resign_key(...);
// panel.set_event_handler(Some(event_handler.as_ref()));
```

### Fix 3: Remove Redundant Panel Hiding in Navigation Mode
In `on_modifier_released` and `on_panel_blur`, remove the explicit panel hiding since the frontend or blur handler already handles it:
```rust
// Remove:
// if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
//     let _ = panels::hide_inbox_list_panel(app);
// }
```

### Fix 4: Add Guard Against Double-Hide
If keeping multiple hide paths, add a flag to prevent double-hiding:
```rust
static INBOX_PANEL_HIDING: AtomicBool = AtomicBool::new(false);

pub fn hide_inbox_list_panel(app: &AppHandle) -> Result<(), String> {
    if INBOX_PANEL_HIDING.swap(true, Ordering::SeqCst) {
        return Ok(()); // Already hiding
    }
    // ... hide logic ...
    INBOX_PANEL_HIDING.store(false, Ordering::SeqCst);
    Ok(())
}
```

---

## Files to Modify

1. `src-tauri/src/lib.rs` - Fix command name
2. `src-tauri/src/panels.rs` - Remove blur handler from `create_inbox_list_panel`
3. `src-tauri/src/navigation_mode.rs` - Remove redundant panel hiding
