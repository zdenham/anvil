# CGEvent Navigation Mode Implementation Plan

## Overview

Implement a Command+Tab style navigation mode for the task panel. The user can use **two hotkeys**:

- **Shift+Down** - Opens the task panel (if not open) and navigates DOWN the list
- **Shift+Up** - Opens the task panel (if not open) and navigates UP the list

While in navigation mode, the user can continue pressing either hotkey to navigate in that direction. When the **Shift key is released**, the currently selected task is opened and navigation mode ends.

### Key Requirements

1. **Navigation Mode State Machine** - Entirely in Rust
2. **CGEvent Listeners** - To detect modifier key release (not possible with Tauri shortcuts)
3. **Event Bridge** - Emit events like `nav-up`, `nav-down`, `nav-open` to React
4. **Proper Cleanup** - CGEvent listeners must be cleaned up on modifier release OR panel blur
5. **Testable in Isolation** - CGEvent functionality must be validated before building the full feature
6. **Bidirectional Navigation** - Both Shift+Up and Shift+Down hotkeys supported from the start

### Previous Attempts

A previous `modifier_monitor.rs` was removed due to issues with:
- Double navigation events from inadequate cleanup
- Race conditions in thread lifecycle management
- Conflicts between global shortcuts and local navigation

This plan addresses these concerns with:
- Synchronous, single-threaded event tap
- Explicit cleanup coordination
- Phase 1 focused on validating CGEvent listening works at all

---

## Phase 1: CGEvent Tap Validation (CRITICAL - Must Complete First)

### Goal

Prove that we can successfully listen to global keyboard events using CGEventTap before building any navigation logic. This is a **blocking prerequisite** - if CGEvent listening doesn't work reliably, the entire approach must be reconsidered.

### Technical Background

The `core-graphics` crate provides two distinct capabilities:

1. **CGEvent posting** (already used in `clipboard.rs` and `keyboard.rs`)
   - `CGEvent::new_keyboard_event()` - create synthetic events
   - `event.post(CGEventTapLocation::Session)` - post to system

2. **CGEventTap listening** (NOT currently used - this is what we need)
   - `CGEventTapCreate()` - create a tap to intercept events
   - Requires Accessibility permission
   - Returns events through a callback or run loop source

### Implementation: `cgevent_test` CLI Command

Add a new command to `anvil-test` that validates CGEventTap functionality.

**File**: `src-tauri/src/bin/anvil-test/main.rs`

Add new command:
```rust
/// Test CGEvent listening capability
CgeventTest {
    /// Duration in seconds to listen (default: 5)
    #[arg(short, long, default_value = "5")]
    duration: u64,

    /// Only listen for modifier keys (Shift, Command, Option, Control)
    #[arg(long)]
    modifiers_only: bool,
}
```

**New File**: `src-tauri/src/bin/anvil-test/cgevent_listener.rs`

```rust
//! CGEvent tap testing module
//!
//! This module provides headless testing of CGEventTap functionality
//! to validate that we can listen to global keyboard events.

use core_foundation::base::TCFType;
use core_foundation::runloop::{CFRunLoop, CFRunLoopSource, kCFRunLoopCommonModes};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapPlacement,
    CGEventTapOptions, CGEventType, CGEvent,
    CGEventFlags,
};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Statistics collected during event tap test
#[derive(Debug, Default)]
pub struct EventTapStats {
    pub total_events: u32,
    pub key_down_events: u32,
    pub key_up_events: u32,
    pub flags_changed_events: u32,
    pub modifier_releases: u32,
    pub shift_releases: u32,
    pub command_releases: u32,
}

/// Result of the CGEventTap test
#[derive(Debug)]
pub struct EventTapTestResult {
    pub success: bool,
    pub tap_created: bool,
    pub run_loop_attached: bool,
    pub events_received: bool,
    pub stats: EventTapStats,
    pub error: Option<String>,
}

/// Test CGEventTap functionality
///
/// This function:
/// 1. Creates a CGEventTap to intercept keyboard events
/// 2. Runs the event loop for the specified duration
/// 3. Collects statistics on received events
/// 4. Returns detailed results for validation
pub fn test_cgevent_tap(
    duration: Duration,
    modifiers_only: bool,
) -> EventTapTestResult {
    // Check accessibility permission first
    if !crate::accessibility::is_accessibility_trusted() {
        return EventTapTestResult {
            success: false,
            tap_created: false,
            run_loop_attached: false,
            events_received: false,
            stats: EventTapStats::default(),
            error: Some("Accessibility permission not granted".to_string()),
        };
    }

    // Shared state for the callback
    let stats = Arc::new(EventTapStatsAtomic::default());
    let stats_clone = stats.clone();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    // Track previous modifier state to detect releases
    let prev_flags = Arc::new(AtomicU64::new(0));

    // Event mask - what events to intercept
    let event_mask = if modifiers_only {
        // Only flags changed events (modifier keys)
        1 << CGEventType::FlagsChanged as u32
    } else {
        // Key up, key down, and flags changed
        (1 << CGEventType::KeyDown as u32)
            | (1 << CGEventType::KeyUp as u32)
            | (1 << CGEventType::FlagsChanged as u32)
    };

    // Create the event tap
    // CGEventTapCreate is unsafe and requires accessibility permission
    let tap_result = unsafe {
        create_event_tap(event_mask, stats_clone, prev_flags)
    };

    let (tap, run_loop_source) = match tap_result {
        Ok(t) => t,
        Err(e) => {
            return EventTapTestResult {
                success: false,
                tap_created: false,
                run_loop_attached: false,
                events_received: false,
                stats: EventTapStats::default(),
                error: Some(e),
            };
        }
    };

    // Add to run loop
    unsafe {
        CFRunLoop::get_current().add_source(&run_loop_source, kCFRunLoopCommonModes);
    }

    // Enable the tap
    // CGEventTapEnable(tap, true);

    eprintln!("CGEventTap created successfully. Listening for {} seconds...", duration.as_secs());
    eprintln!("Press keys to test. Modifier key releases will be logged.");

    // Run the event loop for the specified duration
    let start = Instant::now();
    while start.elapsed() < duration && !stop_flag_clone.load(Ordering::Relaxed) {
        // Run the run loop for 100ms at a time
        unsafe {
            CFRunLoop::run_in_mode(kCFRunLoopDefaultMode, 0.1, false);
        }
    }

    // Clean up
    unsafe {
        CFRunLoop::get_current().remove_source(&run_loop_source, kCFRunLoopCommonModes);
        // CGEventTapEnable(tap, false);
    }

    let final_stats = stats.to_stats();

    EventTapTestResult {
        success: final_stats.total_events > 0,
        tap_created: true,
        run_loop_attached: true,
        events_received: final_stats.total_events > 0,
        stats: final_stats,
        error: None,
    }
}
```

### Dependency Updates

**File**: `src-tauri/Cargo.toml`

The `core-graphics` crate is already included but may need additional features:
```toml
core-graphics = { version = "0.24", features = ["event-tap"] }
```

Note: Verify if the `core-graphics` crate supports CGEventTap bindings. If not, we may need:
- `core-graphics-types` for additional type definitions
- Direct `libc` FFI bindings to the CGEvent C API
- The `rdev` crate as an alternative (provides cross-platform event listening)

### Alternative: Using `rdev` Crate

If `core-graphics` doesn't provide CGEventTap bindings, the `rdev` crate is the **preferred fallback**. It's a Rust library that provides cross-platform keyboard and mouse event listening by wrapping platform-specific APIs (CGEventTap on macOS, raw input on Windows, etc.) with a simpler, safe Rust interface.

```toml
rdev = "0.5"  # Cross-platform keyboard/mouse event listening
```

```rust
use rdev::{listen, Event, EventType, Key};

fn callback(event: Event) {
    match event.event_type {
        EventType::KeyRelease(Key::ShiftLeft) | EventType::KeyRelease(Key::ShiftRight) => {
            eprintln!("Shift released!");
        }
        _ => {}
    }
}

// In a thread:
if let Err(error) = listen(callback) {
    eprintln!("Error: {:?}", error);
}
```

**Why `rdev` is a good fallback:**
- Well-maintained crate with active development
- Handles the low-level CGEventTap FFI for us
- Provides a cleaner callback-based API
- Already handles run loop integration

### Test Procedure

1. **Build the test binary**:
   ```bash
   cargo build --bin anvil-test
   ```

2. **Ensure accessibility permission**:
   ```bash
   ./target/debug/anvil-test check-accessibility
   # If not granted:
   ./target/debug/anvil-test request-accessibility
   ```

3. **Run the CGEventTap test**:
   ```bash
   # Test all key events for 5 seconds
   ./target/debug/anvil-test cgevent-test --duration 5

   # Test only modifier keys
   ./target/debug/anvil-test cgevent-test --duration 5 --modifiers-only
   ```

4. **Validate output**:
   - Should print each detected key event
   - Should specifically log modifier key releases (Shift up, Command up, etc.)
   - Should print final statistics

### Success Criteria for Phase 1

- [ ] CGEventTap is created without error
- [ ] Events are received when pressing keys
- [ ] Modifier key releases (Shift up) are correctly detected
- [ ] No crashes or hangs
- [ ] Cleanup works properly (no orphaned threads/resources)
- [ ] Test can be run headlessly (no UI interaction required)

### Programmatic Test

Add an integration test that can run in CI:

**File**: `src-tauri/tests/cgevent_tap_test.rs`

```rust
#[cfg(target_os = "macos")]
#[test]
#[ignore] // Requires accessibility permission, run manually
fn test_cgevent_tap_creation() {
    // Just test that we can create and destroy the tap without crashing
    // Actual event listening requires user interaction

    // This validates the FFI bindings work correctly
}
```

---

## Phase 2: Navigation State Machine (Rust)

### Goal

Implement the complete navigation mode state machine in Rust, driven by the validated CGEventTap.

### State Machine

```
                                    ┌─────────────────────┐
                                    │                     │
     Shift+Down OR Shift+Up         │       IDLE          │
          │                         │                     │
          │                         └─────────────────────┘
          │                                   ▲
          ▼                                   │
┌─────────────────────┐                       │
│                     │   Shift released      │
│   NAVIGATING        │───────────────────────┘
│                     │   (emit: nav-open)
└─────────────────────┘
          │ ▲
          │ │ Shift+Down (emit: nav-down)
          │ │ Shift+Up (emit: nav-up)
          └─┘
```

### State Transitions

| Current State | Event | Next State | Actions |
|--------------|-------|------------|---------|
| IDLE | Shift+Down pressed | NAVIGATING | Open panel, start CGEventTap, emit `nav-start`, emit `nav-down` |
| IDLE | Shift+Up pressed | NAVIGATING | Open panel, start CGEventTap, emit `nav-start`, emit `nav-up` |
| NAVIGATING | Shift+Down pressed | NAVIGATING | Emit `nav-down` |
| NAVIGATING | Shift+Up pressed | NAVIGATING | Emit `nav-up` |
| NAVIGATING | Shift released | IDLE | Stop CGEventTap, emit `nav-open` |
| NAVIGATING | Panel blur | IDLE | Stop CGEventTap, emit `nav-cancel` |

**Note on initial selection:** When entering navigation mode:
- Shift+Down starts with item 0 selected (top of list), then navigates down
- Shift+Up starts with item 0 selected (top of list), then navigates up (wraps or clamps)

### File Structure

**New File**: `src-tauri/src/navigation_mode.rs`

```rust
//! Navigation mode state machine
//!
//! Implements Command+Tab style navigation for the task panel.
//! Supports bidirectional navigation with Shift+Down and Shift+Up hotkeys.

use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

/// Navigation direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDirection {
    Up,
    Down,
}

/// Navigation mode state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationState {
    Idle,
    Navigating,
}

/// Events emitted to the frontend
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum NavigationEvent {
    #[serde(rename = "nav-start")]
    Start,
    #[serde(rename = "nav-down")]
    Down,
    #[serde(rename = "nav-up")]
    Up,
    #[serde(rename = "nav-open")]
    Open { task_index: usize },
    #[serde(rename = "nav-cancel")]
    Cancel,
}

/// Navigation mode manager
pub struct NavigationMode {
    state: Mutex<NavigationState>,
    current_index: Mutex<usize>,
    modifier_tap_active: AtomicBool,
    app_handle: Mutex<Option<AppHandle>>,
}

impl NavigationMode {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(NavigationState::Idle),
            current_index: Mutex::new(0),
            modifier_tap_active: AtomicBool::new(false),
            app_handle: Mutex::new(None),
        }
    }

    /// Initialize with app handle for event emission
    pub fn init(&self, app: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app);
    }

    /// Called when a navigation hotkey is pressed (Shift+Up or Shift+Down)
    pub fn on_hotkey_pressed(&self, direction: NavigationDirection) {
        let mut state = self.state.lock().unwrap();

        match *state {
            NavigationState::Idle => {
                *state = NavigationState::Navigating;
                *self.current_index.lock().unwrap() = 0;

                // Start modifier tap to detect Shift release
                self.start_modifier_tap();

                // Emit nav-start to open/show the panel
                self.emit(NavigationEvent::Start);

                // Emit the initial navigation direction
                match direction {
                    NavigationDirection::Down => self.emit(NavigationEvent::Down),
                    NavigationDirection::Up => self.emit(NavigationEvent::Up),
                }
            }
            NavigationState::Navigating => {
                // Continue navigating in the requested direction
                match direction {
                    NavigationDirection::Down => {
                        let mut index = self.current_index.lock().unwrap();
                        *index = index.saturating_add(1);
                        self.emit(NavigationEvent::Down);
                    }
                    NavigationDirection::Up => {
                        let mut index = self.current_index.lock().unwrap();
                        *index = index.saturating_sub(1);
                        self.emit(NavigationEvent::Up);
                    }
                }
            }
        }
    }

    /// Called when modifier key is released (from CGEventTap)
    pub fn on_modifier_released(&self) {
        let mut state = self.state.lock().unwrap();

        if *state == NavigationState::Navigating {
            let index = *self.current_index.lock().unwrap();
            *state = NavigationState::Idle;

            // Stop modifier tap
            self.stop_modifier_tap();

            // Emit nav-open with selected index
            self.emit(NavigationEvent::Open { task_index: index });
        }
    }

    /// Called when panel loses focus
    pub fn on_panel_blur(&self) {
        let mut state = self.state.lock().unwrap();

        if *state == NavigationState::Navigating {
            *state = NavigationState::Idle;

            // Stop modifier tap
            self.stop_modifier_tap();

            // Emit cancel
            self.emit(NavigationEvent::Cancel);
        }
    }

    /// Check if navigation mode is currently active
    pub fn is_active(&self) -> bool {
        *self.state.lock().unwrap() == NavigationState::Navigating
    }

    /// Start the CGEventTap for modifier monitoring
    fn start_modifier_tap(&self) {
        if self.modifier_tap_active.swap(true, Ordering::SeqCst) {
            // Already active, avoid double-start
            return;
        }

        // TODO: Implement actual CGEventTap start
        // This will use the code validated in Phase 1
    }

    /// Stop the CGEventTap
    fn stop_modifier_tap(&self) {
        if !self.modifier_tap_active.swap(false, Ordering::SeqCst) {
            // Already stopped
            return;
        }

        // TODO: Implement actual CGEventTap stop
        // Critical: Must fully clean up before returning
    }

    /// Emit a navigation event to the frontend
    fn emit(&self, event: NavigationEvent) {
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            let _ = app.emit("navigation-event", event);
        }
    }
}

// Global singleton
static NAVIGATION_MODE: OnceLock<NavigationMode> = OnceLock::new();

pub fn get_navigation_mode() -> &'static NavigationMode {
    NAVIGATION_MODE.get_or_init(NavigationMode::new)
}
```

### CGEventTap Integration

The CGEventTap must run on a dedicated thread to avoid blocking the main thread.

**IMPORTANT: Initial Modifier State**

When the CGEventTap starts (after the hotkey is pressed), the modifier key (Shift) is **already held down**. The tap will not see a "Shift pressed" event - it will only see subsequent `FlagsChanged` events. This means:

1. **Initialize `prev_flags` with Shift set**: When starting the tap, we must initialize the previous flags state to include the Shift modifier (0x00020000). This ensures that when Shift is released, the transition from "Shift down" to "Shift up" is correctly detected.

2. **Use `CGEventSourceFlagsState()` or hardcode**: We can either:
   - Query the current modifier state using `CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState)` at tap creation time
   - Hardcode the initial state knowing Shift must be down (since that's how we got here)

```rust
fn start_modifier_tap(&self) {
    let app_handle = self.app_handle.clone();
    let active_flag = self.modifier_tap_active.clone();

    std::thread::spawn(move || {
        // Create event tap for FlagsChanged events only
        // Listen for Shift key release

        // CRITICAL: Initialize prev_flags with Shift already set
        // Since this tap is started by a Shift+Down/Up hotkey, Shift is currently held
        const SHIFT_MASK: u64 = 0x00020000;
        let prev_flags = Arc::new(AtomicU64::new(SHIFT_MASK));

        let callback = |event: CGEvent| -> Option<CGEvent> {
            let flags = event.get_flags();
            let old_flags = prev_flags.swap(flags.bits(), Ordering::SeqCst);

            // Detect Shift release (was set, now clear)
            let shift_was_down = (old_flags & SHIFT_MASK) != 0;
            let shift_is_down = (flags.bits() & SHIFT_MASK) != 0;

            if shift_was_down && !shift_is_down {
                // Shift was released - trigger navigation open
                if let Some(app) = &app_handle {
                    get_navigation_mode().on_modifier_released();
                }
            }

            // Pass event through unchanged (ListenOnly mode)
            None
        };

        // Run event loop until stopped
        while active_flag.load(Ordering::SeqCst) {
            // CFRunLoop iteration
        }

        // Cleanup
    });
}
```

### Thread Safety and Cleanup

Key concerns from previous implementation:
1. **Double-start prevention**: Use AtomicBool swap to prevent multiple taps
2. **Synchronous cleanup**: `stop_modifier_tap()` must block until thread exits
3. **Event deduplication**: Track previous modifier state to detect transitions

```rust
fn stop_modifier_tap(&self) {
    // Signal thread to stop
    self.modifier_tap_active.store(false, Ordering::SeqCst);

    // Wait for thread to acknowledge (with timeout)
    let start = Instant::now();
    while !self.tap_thread_exited.load(Ordering::SeqCst) {
        if start.elapsed() > Duration::from_millis(500) {
            tracing::warn!("Modifier tap thread did not exit cleanly");
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
```

---

## Phase 3: Tauri Command Integration

### Goal

Expose the navigation mode to the frontend via Tauri commands and connect to the existing hotkey system.

### Commands

**File**: `src-tauri/src/lib.rs`

```rust
/// Called when navigation hotkey is triggered
#[tauri::command]
pub fn navigation_hotkey_pressed(app: AppHandle) {
    navigation_mode::get_navigation_mode().on_hotkey_pressed();
}

/// Called when task panel loses focus (from frontend)
#[tauri::command]
pub fn navigation_panel_blur(app: AppHandle) {
    navigation_mode::get_navigation_mode().on_panel_blur();
}

/// Check if currently in navigation mode
#[tauri::command]
pub fn is_navigation_mode_active() -> bool {
    navigation_mode::get_navigation_mode().is_active()
}
```

### Hotkey Registration

Register both Shift+Up and Shift+Down hotkeys:

```rust
use navigation_mode::{get_navigation_mode, NavigationDirection};

// Register Shift+Down for downward navigation
let down_shortcut: Shortcut = "Shift+Down".parse()?;
let down_app = app.clone();
app.global_shortcut()
    .on_shortcut(down_shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            get_navigation_mode().on_hotkey_pressed(NavigationDirection::Down);
        }
    })?;

// Register Shift+Up for upward navigation
let up_shortcut: Shortcut = "Shift+Up".parse()?;
let up_app = app.clone();
app.global_shortcut()
    .on_shortcut(up_shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            get_navigation_mode().on_hotkey_pressed(NavigationDirection::Up);
        }
    })?;
```

---

## Phase 4: Frontend Integration

### Goal

React to navigation events from Rust and update the task panel UI accordingly.

### Event Types

**File**: `src/entities/events.ts`

```typescript
// Add navigation event types
export interface NavigationStartPayload {
  type: "nav-start";
}

export interface NavigationDownPayload {
  type: "nav-down";
}

export interface NavigationUpPayload {
  type: "nav-up";
}

export interface NavigationOpenPayload {
  type: "nav-open";
  task_index: number;
}

export interface NavigationCancelPayload {
  type: "nav-cancel";
}

export type NavigationEventPayload =
  | NavigationStartPayload
  | NavigationDownPayload
  | NavigationUpPayload
  | NavigationOpenPayload
  | NavigationCancelPayload;

// Add to LocalEvents
type LocalEvents = {
  // ... existing events ...
  "navigation-event": NavigationEventPayload;
};
```

### Task Panel Hook

**File**: `src/hooks/use-navigation-mode.ts`

```typescript
import { useEffect, useState, useCallback } from "react";
import { eventBus, NavigationEventPayload } from "@/entities/events";
import { invoke } from "@tauri-apps/api/core";

export function useNavigationMode(tasks: Task[]) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleNavigationEvent = (event: NavigationEventPayload) => {
      switch (event.type) {
        case "nav-start":
          setIsNavigating(true);
          setSelectedIndex(0);
          break;

        case "nav-down":
          setSelectedIndex((prev) => Math.min(prev + 1, tasks.length - 1));
          break;

        case "nav-up":
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "nav-open":
          setIsNavigating(false);
          // Open the task at the selected index
          const task = tasks[event.task_index];
          if (task) {
            openTask(task);
          }
          break;

        case "nav-cancel":
          setIsNavigating(false);
          break;
      }
    };

    eventBus.on("navigation-event", handleNavigationEvent);
    return () => eventBus.off("navigation-event", handleNavigationEvent);
  }, [tasks]);

  // Notify Rust when panel loses focus
  const handleBlur = useCallback(() => {
    if (isNavigating) {
      invoke("navigation_panel_blur");
    }
  }, [isNavigating]);

  return {
    isNavigating,
    selectedIndex,
    handleBlur,
  };
}
```

### Task Panel Updates

**File**: `src/components/tasks-panel/tasks-panel.tsx`

```typescript
// In TasksPanel component
const { isNavigating, selectedIndex, handleBlur } = useNavigationMode(tasks);

// Add blur handler to panel
useEffect(() => {
  window.addEventListener("blur", handleBlur);
  return () => window.removeEventListener("blur", handleBlur);
}, [handleBlur]);

// Highlight the selected task during navigation
<TaskList
  tasks={tasks}
  selectedIndex={isNavigating ? selectedIndex : undefined}
  isNavigating={isNavigating}
/>
```

---

## Phase 5: Testing and Polish

### Integration Tests

1. **Shift+Down triggers navigation mode**
   - Press Shift+Down → panel opens, first task highlighted, then moves down

2. **Shift+Up triggers navigation mode**
   - Press Shift+Up → panel opens, first task highlighted, then moves up (clamps at 0)

3. **Bidirectional navigation while in mode**
   - Start with Shift+Down, then press Shift+Up → highlight moves up
   - Start with Shift+Up, then press Shift+Down → highlight moves down

4. **Modifier release opens task**
   - Release Shift → highlighted task opens, navigation mode ends

5. **Panel blur cancels navigation**
   - Click outside panel while navigating → navigation cancelled, no task opened

6. **Cleanup validation**
   - Verify no orphaned CGEventTap threads after modifier release
   - Verify no orphaned CGEventTap threads after panel blur
   - Verify no duplicate events on rapid key presses

### Edge Cases

1. **Rapid key presses** - Should not cause double navigation
2. **Empty task list** - Navigation mode should handle gracefully
3. **Panel closed during navigation** - Should clean up properly
4. **Multiple modifier releases** - Should only trigger once

### Logging

Add tracing to all state transitions:

```rust
tracing::debug!("NavigationMode: {:?} -> {:?}", old_state, new_state);
tracing::info!("CGEventTap: Modifier released, opening task {}", index);
```

---

## Implementation Order

1. **Phase 1** - CGEventTap Validation (BLOCKING)
   - Add `cgevent-test` command to anvil-test
   - Validate we can detect modifier key releases
   - If this fails, investigate alternatives (rdev crate, IOKit, etc.)

2. **Phase 2** - Navigation State Machine
   - Implement NavigationMode struct
   - Integrate validated CGEventTap code
   - Add thread safety and cleanup

3. **Phase 3** - Tauri Commands
   - Expose navigation mode to frontend
   - Connect to hotkey system

4. **Phase 4** - Frontend Integration
   - Handle navigation events
   - Update task panel UI
   - Add blur handling

5. **Phase 5** - Testing and Polish
   - End-to-end testing
   - Edge case handling
   - Performance optimization

---

## Risk Mitigation

### CGEventTap Doesn't Work

**Fallback 1 (Preferred)**: Use the `rdev` crate which provides a higher-level API for event listening. This is the recommended fallback as it's a well-maintained library that wraps CGEventTap with a cleaner Rust API.

**Fallback 2**: Different interaction model - instead of modifier release, use Enter to confirm selection and Escape to cancel. This changes the UX but is reliable.

**Fallback 3 (Last Resort - Avoid if Possible)**: Use a polling approach - periodically check `CGEventSourceKeyState()` to detect if Shift is still held. This is **not recommended** because:
- Polling introduces latency (the modifier release won't be detected until the next poll interval)
- It wastes CPU cycles checking constantly
- It's not the standard macOS approach for this type of interaction
- Only consider this if CGEventTap AND `rdev` both fail, which would be unusual

### Accessibility Permission Issues

The app already requires accessibility for clipboard paste. Ensure the same permission covers CGEventTap.

### Thread Safety Concerns

- Use `Arc<AtomicBool>` for stop flags
- Use channels for event delivery instead of direct function calls
- Implement proper join/cleanup with timeout

---

## Files to Create/Modify

### New Files
- `src-tauri/src/bin/anvil-test/cgevent_listener.rs` - Phase 1 test code
- `src-tauri/src/navigation_mode.rs` - Phase 2 state machine
- `src/hooks/use-navigation-mode.ts` - Phase 4 React hook

### Modified Files
- `src-tauri/src/bin/anvil-test/main.rs` - Add cgevent-test command
- `src-tauri/Cargo.toml` - Potentially add dependencies
- `src-tauri/src/lib.rs` - Add commands and hotkey registration
- `src/entities/events.ts` - Add navigation event types
- `src/components/tasks-panel/tasks-panel.tsx` - Use navigation hook
