# Sub-Plan 01: Rust Navigation Mode Module

## Overview

Restore the navigation_mode.rs module from git history and update it to use Alt instead of Shift as the modifier key. Register the hotkeys and commands in lib.rs.

## Parallel Execution

This plan can execute **in parallel** with `02-frontend-inbox-view.md`. No shared dependencies.

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/src/navigation_mode.rs` | Create (copy from git, modify) |
| `src-tauri/src/lib.rs` | Modify (add module, hotkeys, commands) |

## Implementation Steps

### Step 1: Restore navigation_mode.rs from Git

Extract the original working file:
```bash
git show d0d978e:src-tauri/src/navigation_mode.rs > src-tauri/src/navigation_mode.rs
```

### Step 2: Apply Shift→Alt Changes

Make these specific changes to the copied file:

#### Change 1: Update module doc comment (lines 1-24)
Change all "Shift+Down and Shift+Up" references to "Alt+Down and Alt+Up"

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
let prev_flags = Arc::new(AtomicU64::new(SHIFT_MASK));

// NEW:
let prev_flags = Arc::new(AtomicU64::new(OPTION_MASK));
```

#### Change 5: Update modifier detection in CGEventTap callback (lines 233-244)
```rust
// OLD:
let shift_was_down = (old_flags & SHIFT_MASK) != 0;
let shift_is_down = (flags_bits & SHIFT_MASK) != 0;
if shift_was_down && !shift_is_down {
    tracing::info!("NavigationMode: Shift released detected");

// NEW:
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

### Step 3: Modify lib.rs - Add Module Import

Near line 25, add:
```rust
mod navigation_mode;
```

### Step 4: Modify lib.rs - Initialize Navigation Mode

After `panels::initialize(app.handle());` (around line 814), add:
```rust
// Initialize navigation mode
navigation_mode::initialize(app.handle());
```

### Step 5: Modify lib.rs - Register Hotkeys

In `register_hotkey_internal()`, after the clipboard hotkey registration (~line 175), add:

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

### Step 6: Modify lib.rs - Register Commands

In the `invoke_handler` macro call (~line 642), add:
```rust
// Navigation mode commands
navigation_mode::navigation_panel_blur,
navigation_mode::is_navigation_mode_active,
navigation_mode::get_navigation_state,
```

## Verification

1. Run `cargo check` in `src-tauri/` - should compile without errors
2. Run `cargo build` to ensure full build works
3. Verify the module exports the expected public functions

## Success Criteria

- [ ] navigation_mode.rs created with Alt modifier (not Shift)
- [ ] lib.rs imports the module
- [ ] lib.rs initializes navigation mode in setup()
- [ ] lib.rs registers Alt+Down and Alt+Up hotkeys
- [ ] lib.rs registers navigation commands in invoke_handler
- [ ] `cargo check` passes
- [ ] `cargo build` succeeds
