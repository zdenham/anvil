# Control Panel Navigation (Alt+Up/Down)

## Overview

Re-implement the keyboard navigation feature that previously allowed navigating between tasks using `Alt+Up` and `Alt+Down` hotkeys. The feature was removed during the task-to-thread migration but the infrastructure (config, hooks, event types) still partially exists.

## Problem

- The old `navigation_mode.rs` file was deleted during the task cleanup
- The hotkey config exists (`control_panel_navigation_up_hotkey`, `control_panel_navigation_down_hotkey`) but hotkeys are not registered
- The `useNavigationMode` hook exists but receives no events from the backend
- The `UnifiedInbox` component uses the hook but the navigation never activates

## Goal

Enable Alt+Up/Down navigation that:
1. Shows the control panel with an inbox view (if not already visible)
2. Highlights items in the unified inbox list as user navigates
3. Opens the selected thread/plan when Alt is released
4. Works identically to the old task navigation but for threads+plans

## Architecture

### Old System (Deleted)
```
User: Alt+Down
  → Rust: register_hotkey_internal() triggers navigation_hotkey_down command
  → Rust: NavigationMode state machine transitions Idle → Navigating
  → Rust: CGEventTap thread starts, monitors for Alt release
  → Rust: Emit "navigation-mode" events (nav-start, nav-down, nav-up, nav-open)
  → Frontend: useNavigationMode hook receives events
  → Frontend: TasksPanel renders with highlighted selection
  → User: Releases Alt
  → Rust: CGEventTap detects modifier release
  → Rust: Emit nav-open with selectedIndex
  → Frontend: Opens selected task
```

### New System (To Implement)
```
User: Alt+Down
  → Rust: Global shortcut triggers navigation_hotkey_down command
  → Rust: NavigationMode state machine transitions Idle → Navigating
  → Rust: CGEventTap thread starts, monitors for Alt release
  → Rust: Show control panel with inbox view
  → Rust: Emit "navigation-mode" events (nav-start, nav-down, nav-up, nav-open)
  → Frontend: useNavigationMode hook receives events
  → Frontend: UnifiedInbox renders with highlighted selection
  → User: Releases Alt
  → Rust: CGEventTap detects modifier release
  → Rust: Emit nav-open with selectedIndex
  → Frontend: Opens selected thread/plan via switchToThread/switchToPlan
```

## Implementation Steps

### Phase 1: Restore Rust Navigation Mode Module (COPY FROM GIT)

**File: `src-tauri/src/navigation_mode.rs`** (Create)

**IMPORTANT: Copy the exact code from git history and make minimal changes.**

```bash
# Extract the original working file
git show d0d978e:src-tauri/src/navigation_mode.rs > src-tauri/src/navigation_mode.rs
```

Then make these **specific changes** to the copied file:

#### Change 1: Update module doc comment (lines 1-24)
Change "Shift+Down and Shift+Up" references to "Alt+Down and Alt+Up"

#### Change 2: Change modifier mask constant (line 57)
```rust
// OLD:
const SHIFT_MASK: u64 = 0x00020000; // CGEventFlags::CGEventFlagShift

// NEW:
const OPTION_MASK: u64 = 0x00080000; // CGEventFlags::CGEventFlagOption (Alt key)
```

#### Change 3: Update panel show call (line 117)
```rust
// OLD:
let _ = panels::show_tasks_list(app);

// NEW:
let _ = panels::show_control_panel_simple(app);
```

#### Change 4: Update CGEventTap initial flags (line 220)
```rust
// OLD:
// CRITICAL: Initialize prev_flags with Shift already set
// Since this tap is started by a Shift+Down/Up hotkey, Shift is currently held
let prev_flags = Arc::new(AtomicU64::new(SHIFT_MASK));

// NEW:
// CRITICAL: Initialize prev_flags with Option/Alt already set
// Since this tap is started by an Alt+Down/Up hotkey, Alt is currently held
let prev_flags = Arc::new(AtomicU64::new(OPTION_MASK));
```

#### Change 5: Update modifier detection in CGEventTap callback (lines 233-244)
```rust
// OLD:
// Detect Shift release (was set, now clear)
let shift_was_down = (old_flags & SHIFT_MASK) != 0;
let shift_is_down = (flags_bits & SHIFT_MASK) != 0;

if shift_was_down && !shift_is_down {
    tracing::info!("NavigationMode: Shift released detected");

// NEW:
// Detect Option/Alt release (was set, now clear)
let option_was_down = (old_flags & OPTION_MASK) != 0;
let option_is_down = (flags_bits & OPTION_MASK) != 0;

if option_was_down && !option_is_down {
    tracing::info!("NavigationMode: Option/Alt released detected");
```

#### Change 6: Update log message (line 278)
```rust
// OLD:
tracing::info!("NavigationMode: CGEventTap enabled, listening for Shift release");

// NEW:
tracing::info!("NavigationMode: CGEventTap enabled, listening for Option/Alt release");
```

#### Change 7: Update doc comments on commands (lines 333-340)
```rust
// OLD:
/// Called when navigation hotkey is triggered (Shift+Down)

// NEW:
/// Called when navigation hotkey is triggered (Alt+Down)
```

### Phase 2: Register Navigation Hotkeys

**File: `src-tauri/src/lib.rs`** (Modify)

#### Step 2.1: Add module import (near line 25)
```rust
mod navigation_mode;
```

#### Step 2.2: Initialize navigation mode in setup() (after line 814)
After `panels::initialize(app.handle());` add:
```rust
// Initialize navigation mode
navigation_mode::initialize(app.handle());
```

#### Step 2.3: Register hotkeys in register_hotkey_internal() (after clipboard hotkey registration, ~line 175)
```rust
// Register control panel navigation hotkeys
let nav_down_hotkey = config::get_control_panel_navigation_down_hotkey();
if let Ok(nav_down_shortcut) = nav_down_hotkey.parse::<Shortcut>() {
    app.global_shortcut()
        .on_shortcut(nav_down_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                navigation_mode::get_navigation_mode().on_hotkey_pressed(navigation_mode::NavigationDirection::Down);
            }
        })
        .map_err(|e| format!("Failed to register nav down hotkey: {:?}", e))?;
}

let nav_up_hotkey = config::get_control_panel_navigation_up_hotkey();
if let Ok(nav_up_shortcut) = nav_up_hotkey.parse::<Shortcut>() {
    app.global_shortcut()
        .on_shortcut(nav_up_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                navigation_mode::get_navigation_mode().on_hotkey_pressed(navigation_mode::NavigationDirection::Up);
            }
        })
        .map_err(|e| format!("Failed to register nav up hotkey: {:?}", e))?;
}
```

#### Step 2.4: Register commands in invoke_handler (add to the list ~line 642)
```rust
// Navigation mode commands
navigation_mode::navigation_panel_blur,
navigation_mode::is_navigation_mode_active,
navigation_mode::get_navigation_state,
```

### Phase 3: Add Inbox View to Control Panel

**File: `src/entities/events.ts`** (Modify)

Add inbox view type to `ControlPanelViewType` (~line 37):
```typescript
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "inbox" }; // NEW
```

**File: `src/components/control-panel/control-panel-window.tsx`** (Modify)

Add inbox view handling after the plan view check (~line 55):
```tsx
if (view.type === "inbox") {
  return <InboxView />;
}
```

Create the InboxView component (can be in same file or separate):
```tsx
function InboxView() {
  const threads = useThreadStore((s) => s.getAllThreads());
  const plans = usePlanStore((s) => Object.values(s.plans));
  const threadLastMessages = useThreadLastMessages(threads);

  const handleThreadSelect = (thread: ThreadMetadata) => {
    switchToThread(thread.id);
  };

  const handlePlanSelect = (plan: PlanMetadata) => {
    switchToPlan(plan.id);
  };

  return (
    <div className="flex flex-col h-screen bg-surface-900">
      <div className="flex-1 overflow-auto">
        <UnifiedInbox
          threads={threads}
          plans={plans}
          threadLastMessages={threadLastMessages}
          onThreadSelect={handleThreadSelect}
          onPlanSelect={handlePlanSelect}
        />
      </div>
    </div>
  );
}
```

**File: `src/components/control-panel/use-control-panel-params.ts`** (Modify)

Update to handle inbox view type in the params parsing.

### Phase 4: Verify Existing Frontend Code

**File: `src/components/inbox/unified-inbox.tsx`** (Verify - already done)

The UnifiedInbox already uses `useNavigationMode`:
```tsx
const { isNavigating, selectedIndex } = useNavigationMode({
  itemCount: items.length,
  onItemSelect: (index) => {
    const item = items[index];
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else if (item.type === "plan") {
      switchToPlan(item.data.id);
    }
  },
});
```

**File: `src/hooks/use-navigation-mode.ts`** (Verify - already done)

The hook handles all navigation events correctly.

**File: `src/lib/event-bridge.ts`** (Verify - already done)

`"navigation-mode"` is in `RUST_PANEL_EVENTS`.

### Phase 5: Wire Navigation to Control Panel

When navigation mode starts, the control panel needs to:
1. Show itself if hidden
2. Switch to inbox view
3. When nav-open fires, switch to the selected item's view

The flow is:
- Rust calls `panels::show_control_panel_simple()`
- Rust emits `navigation-mode: nav-start`
- Frontend receives event, `useNavigationMode` sets `isNavigating=true`
- UnifiedInbox renders with selection highlight
- On `nav-open`, `onItemSelect` is called which uses `switchToThread`/`switchToPlan`

## Original Code Reference

The original `navigation_mode.rs` can be retrieved with:
```bash
git show d0d978e:src-tauri/src/navigation_mode.rs
```

Key sections to preserve exactly:
- `NavigationMode` struct and all its methods
- CGEventTap creation and run loop handling
- Thread spawning and synchronization with `AtomicBool` flags
- Event emission via `app.emit("navigation-mode", &event)`
- Global singleton pattern with `OnceLock`

## Files to Create/Modify

### New Files
- `src-tauri/src/navigation_mode.rs` - Copy from git, modify Shift→Alt

### Modified Files
- `src-tauri/src/lib.rs` - Add module, register hotkeys, register commands
- `src/entities/events.ts` - Add inbox view type
- `src/components/control-panel/control-panel-window.tsx` - Handle inbox view
- `src/components/control-panel/use-control-panel-params.ts` - Parse inbox view

## Testing Plan

1. **Manual Testing (Primary)**
   - Press Alt+Down → Panel appears with inbox view, first item highlighted
   - Press Alt+Down again → Selection moves to second item
   - Press Alt+Up → Selection moves back to first item
   - Release Alt → Selected item opens in control panel
   - Press Escape during navigation → Panel hides
   - Click outside panel during navigation → Cancels navigation

2. **Edge Cases**
   - Navigate with 0 items (empty inbox)
   - Navigate with 1 item
   - Navigate with many items (10+)
   - Quick repeated Alt+Down presses
   - Alt+Down then Alt+Up in quick succession

## Success Criteria

- [ ] Alt+Down shows control panel with inbox view
- [ ] Alt+Up shows control panel with inbox view
- [ ] Repeated Alt+Down/Up navigates through items
- [ ] Selection highlights correctly during navigation
- [ ] Releasing Alt opens the selected thread/plan
- [ ] Escape cancels navigation
- [ ] Panel blur cancels navigation
- [ ] Navigation works with mixed threads and plans
- [ ] Navigation wraps at list boundaries
