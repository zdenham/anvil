# Task Navigation Refactor Plan

## Executive Summary

Replace the current flaky React-based task navigation system with **simple Rust navigation mode tracking** and proper Tauri event bridge communication. Rust handles modifier key detection and emits events only to the tasks panel using proper event conventions.

## Current Problems

### 1. Complex Frontend Modifier Tracking
- React hook parses hotkey strings and tracks multiple modifier states
- Attempts to detect when ALL modifiers are released with complex logic
- Race conditions between keydown/keyup events

### 2. Split State Management
- Navigation state managed both in Rust (`NAVIGATION_MODE_ACTIVE`) and React
- Events can get out of sync, React state lost during HMR/reloads

### 3. Timing Issues & Poor Event Conventions
- Frontend tries to coordinate with backend using `externalNavigateTrigger` counts
- Events not following proper Tauri event bridge patterns
- No proper isolation to specific panels

## Proposed Architecture

### Core Principle: **Simple Navigation Mode + Proper Event Bridge**

Just track if navigation mode is active. Emit proper Tauri events only to the tasks panel.

```
┌─────────────────┐    Hotkey Press     ┌─────────────────────────┐
│   Global        │ ──────────────────▶ │  Rust Navigation       │
│   Hotkey        │                     │  Mode Tracker           │
│   Handler       │                     │                         │
└─────────────────┘                     │  State: ON/OFF only     │
                                        │                         │
┌─────────────────┐    Arrow Keys       │  Events to tasks-list:  │
│   Key Event     │ ──────────────────▶ │  • task-navigation-up   │
│   Handler       │                     │  • task-navigation-down │
└─────────────────┘                     │  • task-selection       │
                                        │  • navigation-end       │
┌─────────────────┐    Focus Lost       └─────────────────────────┘
│   Panel Focus   │ ──────────────────▶              │
│   Handler       │                                  │ Targeted Events
└─────────────────┘                                  ▼
                                        ┌─────────────────────────┐
                                        │  Tasks Panel ONLY       │
                                        │                         │
                                        │ • Listen to events      │
                                        │ • Update selection      │
                                        │ • Handle task selection │
                                        └─────────────────────────┘
```

## Detailed Design

### Simple Navigation State

```rust
// Just track if we're navigating and which modifiers to watch for
#[derive(Debug, Clone)]
pub struct NavigationMode {
    pub active: bool,
    pub required_modifiers: ModifierSet,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModifierSet {
    pub meta: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}
```

### Proper Tauri Event Payloads

```rust
// Events sent ONLY to tasks-list panel using emit_to()
#[derive(Debug, Serialize)]
struct TaskNavigationEvent {
    direction: NavigationDirection,
}

#[derive(Debug, Serialize)]
struct TaskSelectionEvent {
    // Empty - just signals to select current task
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum NavigationDirection {
    Up,
    Down,
}
```
### Rust Implementation

#### Simple Navigation Mode Tracker

```rust
// New module: src-tauri/src/task_navigation.rs
use tauri::{AppHandle, Emitter};
use std::sync::{Mutex, OnceLock};

static NAVIGATION_MODE: OnceLock<Mutex<Option<NavigationMode>>> = OnceLock::new();

fn get_navigation_mode() -> &'static Mutex<Option<NavigationMode>> {
    NAVIGATION_MODE.get_or_init(|| Mutex::new(None))
}

/// Start navigation mode when hotkey is pressed
pub fn start_navigation_mode(app: &AppHandle, hotkey: &str) {
    let required_modifiers = parse_hotkey_modifiers(hotkey);

    if let Ok(mut mode) = get_navigation_mode().lock() {
        *mode = Some(NavigationMode {
            active: true,
            required_modifiers,
        });

        // Show panel and start navigation
        let _ = panels::show_tasks_list(app);
    }
}

/// Handle arrow key navigation (only works if navigation mode is active)
pub fn handle_navigation_key(app: &AppHandle, direction: NavigationDirection) {
    if let Ok(mode) = get_navigation_mode().lock() {
        if mode.is_some() {
            // Emit targeted event to tasks-list panel ONLY
            let event = TaskNavigationEvent { direction };
            let _ = app.emit_to(panels::TASKS_LIST_LABEL, "task-navigation", &event);
        }
    }
}

/// Handle modifier key release - end navigation if all required modifiers released
pub fn handle_modifier_release(app: &AppHandle, current_modifiers: ModifierSet) {
    if let Ok(mut mode) = get_navigation_mode().lock() {
        if let Some(nav_mode) = &*mode {
            if all_required_modifiers_released(&nav_mode.required_modifiers, &current_modifiers) {
                // All hotkey modifiers released - select current task
                let _ = app.emit_to(panels::TASKS_LIST_LABEL, "task-selection", &TaskSelectionEvent {});
                *mode = None; // End navigation mode
            }
        }
    }
}

/// End navigation mode (panel closed, escape pressed, etc.)
pub fn end_navigation_mode(app: &AppHandle) {
    if let Ok(mut mode) = get_navigation_mode().lock() {
        if mode.is_some() {
            let _ = app.emit_to(panels::TASKS_LIST_LABEL, "navigation-end", &());
            *mode = None;
        }
    }
}

/// Check if navigation mode is currently active
pub fn is_navigation_mode_active() -> bool {
    if let Ok(mode) = get_navigation_mode().lock() {
        mode.is_some()
    } else {
        false
    }
}

fn parse_hotkey_modifiers(hotkey: &str) -> ModifierSet {
    let parts: Vec<&str> = hotkey.to_lowercase().split('+').collect();
    ModifierSet {
        meta: parts.iter().any(|&p| p == "cmd" || p == "command" || p == "meta"),
        ctrl: parts.iter().any(|&p| p == "ctrl" || p == "control"),
        alt: parts.iter().any(|&p| p == "alt" || p == "option"),
        shift: parts.iter().any(|&p| p == "shift"),
    }
}

fn all_required_modifiers_released(required: &ModifierSet, current: &ModifierSet) -> bool {
    // All modifiers that were part of the hotkey must now be released
    (!required.meta || !current.meta) &&
    (!required.ctrl || !current.ctrl) &&
    (!required.alt || !current.alt) &&
    (!required.shift || !current.shift)
}
```

#### Integration with Existing Hotkey System

```rust
// In lib.rs - modify existing hotkey registration
fn register_task_navigation_hotkeys(app: &AppHandle) -> Result<(), String> {
    let navigation_hotkey = config::get_task_panel_hotkey(); // e.g., "Shift+Down"

    let shortcut = navigation_hotkey.parse::<Shortcut>()?;
    let app_handle = app.clone();

    app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if panels::is_panel_visible(&app_handle, panels::TASKS_LIST_LABEL) {
                // Panel already open - navigate down
                task_navigation::handle_navigation_key(&app_handle, NavigationDirection::Down);
            } else {
                // Panel closed - start navigation mode
                task_navigation::start_navigation_mode(&app_handle, &navigation_hotkey);
            }
        }
    });

    Ok(())
}
```

#### Global Modifier Key Monitoring

```rust
// Platform-specific modifier key monitoring
// This runs continuously and checks current modifier state
use std::thread;
use std::time::Duration;

pub fn start_modifier_monitoring(app: AppHandle) {
    thread::spawn(move || {
        let mut last_modifiers = ModifierSet::default();

        loop {
            thread::sleep(Duration::from_millis(50)); // Check every 50ms

            if !task_navigation::is_navigation_mode_active() {
                continue; // Only monitor when navigation is active
            }

            let current_modifiers = get_current_modifiers(); // Platform-specific implementation

            if current_modifiers != last_modifiers {
                task_navigation::handle_modifier_release(&app, current_modifiers);
                last_modifiers = current_modifiers;
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn get_current_modifiers() -> ModifierSet {
    // Use CGEventSource to get current modifier state
    // Implementation details for macOS
    ModifierSet::default() // Placeholder
}
```

### Frontend Simplification

#### Simple React Hook for Tasks Panel Only

```typescript
// src/hooks/use-task-navigation.ts
interface TaskNavigationState {
  selectedIndex: number;
  isNavigating: boolean;
}

export function useTaskNavigation(
  tasks: TaskMetadata[],
  onTaskSelect: (task: TaskMetadata) => void
): TaskNavigationState {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);

  // Listen for navigation events from Rust - ONLY targeted to this panel
  useEffect(() => {
    const unlistenNavigation = listen<{ direction: 'up' | 'down' }>('task-navigation', (event) => {
      setIsNavigating(true);
      const { direction } = event.payload;

      setSelectedIndex(prev => {
        if (direction === 'down') {
          return (prev + 1) % tasks.length;
        } else {
          return prev === 0 ? tasks.length - 1 : prev - 1;
        }
      });
    });

    const unlistenSelection = listen('task-selection', () => {
      if (tasks[selectedIndex]) {
        onTaskSelect(tasks[selectedIndex]);
      }
      setIsNavigating(false);
    });

    const unlistenEnd = listen('navigation-end', () => {
      setIsNavigating(false);
    });

    return () => {
      unlistenNavigation.then(fn => fn());
      unlistenSelection.then(fn => fn());
      unlistenEnd.then(fn => fn());
    };
  }, [tasks, selectedIndex, onTaskSelect]);

  // Reset selection when tasks change
  useEffect(() => {
    setSelectedIndex(0);
  }, [tasks]);

  return { selectedIndex, isNavigating };
}
```

#### Minimal Panel Component

```typescript
// src/components/tasks-panel/tasks-panel.tsx
export function TasksPanel() {
  const [tasks, setTasks] = useState<TaskMetadata[]>([]);
  const router = useRouter();

  const { selectedIndex, isNavigating } = useTaskNavigation(tasks, (task) => {
    // Navigate to selected task
    router.navigate(`/simple-task/${task.thread_id}/${task.id}`);
  });

  // Load tasks when panel becomes visible
  useEffect(() => {
    const unlisten = listen('panel-shown', () => {
      loadTasks().then(setTasks);
    });
    return unlisten;
  }, []);

  return (
    <div className={`tasks-panel ${isNavigating ? 'navigating' : ''}`}>
      <ul className="task-list">
        {tasks.map((task, index) => (
          <TaskItem
            key={task.id}
            task={task}
            selected={index === selectedIndex}
          />
        ))}
      </ul>
    </div>
  );
}
```
## Implementation Plan

### Phase 1: Rust Navigation Mode (1 day)

1. **Create `task_navigation.rs` module**
   - Simple navigation mode on/off tracking
   - Modifier key parsing and monitoring
   - Event emission to tasks-list panel only

2. **Update hotkey registration in `lib.rs`**
   - Modify existing task panel hotkey to use navigation mode
   - Add modifier key monitoring thread

3. **Update panel focus handlers in `panels.rs`**
   - Connect panel close events to end navigation mode
   - Ensure proper cleanup

### Phase 2: Frontend Simplification (1 day)

4. **Create new minimal React hook**
   - Replace complex `useKeyboardTaskNavigation`
   - Listen only to targeted events from Rust
   - No navigation logic, just UI updates

5. **Update TasksPanel component**
   - Remove all navigation logic
   - Use new simplified hook
   - Handle proper event names

### Phase 3: Testing & Cleanup (0.5 days)

6. **Integration testing**
   - Test hotkey → navigation → selection flow
   - Verify modifier key release detection
   - Test panel isolation (no interference with main window)

7. **Remove old code**
   - Delete `useKeyboardTaskNavigation` hook
   - Remove external navigation triggers
   - Clean up unused navigation state in panels.rs

## Success Criteria

### Core Navigation Flow
- ✅ **Hotkey press**: Opens tasks panel and starts navigation mode
- ✅ **Arrow navigation**: Up/Down keys navigate through tasks (only when panel open)
- ✅ **Modifier release**: Releasing ALL hotkey modifiers selects current task and closes panel
- ✅ **Panel isolation**: Navigation only affects tasks panel, no interference with main window

### Proper Event Bridge
- ✅ **Targeted events**: Events sent only to `tasks-list` panel using `emit_to()`
- ✅ **Event naming**: Uses kebab-case naming (`task-navigation`, `task-selection`, `navigation-end`)
- ✅ **Clean payloads**: Simple, well-defined event payloads

### Modifier Key Handling
- ✅ **Single modifier** (e.g., `Shift+Down`): Release Shift → select task
- ✅ **Multi-modifier** (e.g., `Cmd+Shift+Down`): Release both Cmd AND Shift → select task
- ✅ **Partial release**: Releasing only some modifiers continues navigation
- ✅ **Platform agnostic**: Works on all supported platforms

### Reliability & Cleanup
- ✅ **No race conditions**: Simple navigation mode on/off, no complex state
- ✅ **Proper cleanup**: Panel close/blur ends navigation mode
- ✅ **Edge case handling**: Empty task list, rapid key presses
- ✅ **State isolation**: Navigation state only in Rust, React just reacts

## Architecture Benefits

### 1. **Simplicity**
- Navigation mode: just ON/OFF, no complex state machine
- React hook: ~50 lines vs 200+ lines of complex logic
- Clear separation: Rust handles logic, React handles UI

### 2. **Reliability**
- Single source of truth in Rust
- No timing issues or race conditions
- Predictable behavior with simple state

### 3. **Proper Event Architecture**
- Follows Tauri event bridge conventions
- Targeted events prevent cross-panel interference
- Clean event payloads with proper typing

### 4. **Panel Isolation**
- Navigation logic only affects tasks panel
- Main window completely isolated
- No global state pollution

### 5. **Maintainability**
- Easy to understand and debug
- Simple to extend with new navigation features
- Clear responsibilities between Rust and React

## Event Flow Summary

```
User: Presses Shift+Down
  ↓
Rust: Starts navigation mode, shows tasks panel
  ↓
Tasks Panel: Loads tasks, starts listening for events
  ↓
User: Presses Down arrow
  ↓
Rust: Emits "task-navigation" event to tasks-list panel
  ↓
Tasks Panel: Updates selected index
  ↓
User: Releases Shift key
  ↓
Rust: Emits "task-selection" event, ends navigation mode
  ↓
Tasks Panel: Selects task, closes panel
```

This refactor transforms the flaky, complex system into a simple, reliable navigation solution with proper event architecture.