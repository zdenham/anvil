# Navigation Mode Improvements Plan

## Overview

This plan addresses four improvements to the existing CGEvent navigation mode implementation:

1. **Wrap-around navigation** - Navigation should wrap when reaching the end of the list
2. **Secondary color for highlight** - Use the same muted teal (`secondary-500`) as the simple task input focus state
3. **Panel unfocus behavior** - Only open the selected task on modifier release, not on panel blur
4. **Configurable navigation hotkeys** - Settings UI for both up and down hotkeys with multi-modifier release detection

---

## Current State

### Navigation Mode Architecture

- **Backend**: `src-tauri/src/navigation_mode.rs` - State machine with CGEventTap for modifier detection
- **Frontend**: `src/hooks/use-navigation-mode.ts` - React hook for handling navigation events
- **Hotkeys**: Currently hardcoded as `Shift+Down` and `Shift+Up` in `src-tauri/src/lib.rs:163-187`
- **Settings**: `src/components/main-window/settings/task-panel-hotkey-settings.tsx` - Only one hotkey configurable (and it's for toggling, not navigation)
- **Highlight**: Blue (`border-blue-500`) in `src/components/tasks-panel/tasks-panel.tsx:265`
- **Modifier Detection**: Only detects Shift release (hardcoded `SHIFT_MASK` at line 75)

---

## Improvement 1: Wrap-Around Navigation

### Problem

Currently, navigation clamps at boundaries:
- `nav-up` uses `Math.max(prev - 1, 0)` - stops at 0
- `nav-down` uses `Math.min(prev + 1, taskCount - 1)` - stops at last item

### Solution

Implement wrapping in the frontend hook (`use-navigation-mode.ts`):

**File**: `src/hooks/use-navigation-mode.ts`

```typescript
case "nav-down":
  setSelectedIndex((prev) => {
    // Wrap to beginning when at end
    const next = prev >= taskCount - 1 ? 0 : prev + 1;
    logger.debug("[use-navigation-mode] nav-down:", prev, "->", next);
    return next;
  });
  break;

case "nav-up":
  setSelectedIndex((prev) => {
    // Wrap to end when at beginning
    const next = prev <= 0 ? Math.max(0, taskCount - 1) : prev - 1;
    logger.debug("[use-navigation-mode] nav-up:", prev, "->", next);
    return next;
  });
  break;
```

### Files to Modify

- `src/hooks/use-navigation-mode.ts` - Update nav-up and nav-down cases

### Estimated Complexity

Low - Simple arithmetic change in two places.

---

## Improvement 2: Secondary Color for Navigation Highlight

### Problem

Navigation highlight uses `border-blue-500 ring-2 ring-blue-500/50 bg-blue-500/10` which is a bright blue (#3b82f6).

The simple task input uses `focus:border-secondary-500` which is a muted teal (#5c857e) that matches the app's design language.

### Solution

Replace blue highlight with secondary color:

**File**: `src/components/tasks-panel/tasks-panel.tsx`

Current (line 265):
```tsx
? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-500/10"
```

Replace with:
```tsx
? "border-secondary-500 ring-2 ring-secondary-500/50 bg-secondary-500/10"
```

### Files to Modify

- `src/components/tasks-panel/tasks-panel.tsx` - Update TaskListItem styling

### Estimated Complexity

Low - Single line change.

---

## Improvement 3: Panel Unfocus Behavior

### Problem

Currently, when the panel loses focus during navigation mode:
1. `navigation_panel_blur()` is called from the frontend blur handler
2. This triggers `NavCancel` event
3. The selected task is NOT opened (correct behavior)

However, the user wants:
- **Panel blur during navigation**: Cancel navigation, do NOT open task (already correct)
- **Modifier release**: Open the selected task (already correct)

Wait - re-reading the requirement: "If the panel is unfocused, it should not open the currently selected task, only on meta release"

This is the **current behavior**. Let me verify by checking the code:

**Frontend blur handler** (`use-navigation-mode.ts:114-121`):
```typescript
const handleBlur = useCallback(() => {
  if (isNavigating) {
    logger.log("[use-navigation-mode] Panel blur during navigation, notifying Rust");
    invoke("navigation_panel_blur").catch(...);
  }
}, [isNavigating]);
```

**Backend blur handler** (`navigation_mode.rs:184-197`):
```rust
pub fn on_panel_blur(&self) {
    if *state == NavigationState::Navigating {
        *state = NavigationState::Idle;
        self.stop_modifier_tap();
        self.emit(NavigationEvent::NavCancel);  // <-- Emits cancel, NOT open
    }
}
```

**Frontend NavCancel handler** (`use-navigation-mode.ts:97-100`):
```typescript
case "nav-cancel":
  logger.log("[use-navigation-mode] Navigation cancelled");
  setIsNavigating(false);
  break;  // <-- Does NOT call onTaskSelect
```

The current implementation already does NOT open the task on blur - it only opens on `nav-open` (modifier release). This improvement may already be working correctly.

### Verification Needed

Before making changes, verify the actual behavior:
1. Start navigation with Shift+Down
2. Click outside the panel (blur it)
3. Confirm no task opens

If a task IS being opened on blur, trace where that's happening. Possible culprits:
- Panel close handler
- Blur event triggering something else

### Possible Issue: Panel Auto-Hide

Looking at `panels.rs`, the tasks list panel does NOT auto-hide on blur (line 1106 comment). However, if blur is being incorrectly treated as "navigation complete", there might be a race condition.

### Files to Investigate

- `src/hooks/use-navigation-mode.ts` - Verify blur handler behavior
- `src-tauri/src/navigation_mode.rs` - Verify on_panel_blur behavior
- `src/components/tasks-panel/tasks-panel.tsx` - Check for other blur handlers

### Estimated Complexity

Low - May already work correctly. Needs testing.

---

## Improvement 4: Configurable Navigation Hotkeys with Multi-Modifier Support

### Problem

1. Navigation hotkeys (`Shift+Down`, `Shift+Up`) are hardcoded in `lib.rs`
2. Only one hotkey is configurable in settings (`task-panel-hotkey-settings.tsx`) and it's for panel toggle, not navigation
3. Only Shift modifier release is detected (`SHIFT_MASK = 0x00020000`)

Users need to:
- Configure both "navigate down" and "navigate up" hotkeys
- Use any modifier combination (Command+J/K, Option+Down/Up, etc.)
- Have the task open when ALL modifiers from the hotkey are released

### Solution Architecture

#### Part A: Settings UI for Two Navigation Hotkeys

Create a new settings component for navigation hotkeys:

**New File**: `src/components/main-window/settings/navigation-hotkey-settings.tsx`

```typescript
import { ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "../settings-section";
import { HotkeyRecorder } from "@/components/onboarding/HotkeyRecorder";
import {
  getSavedNavigationDownHotkey,
  getSavedNavigationUpHotkey,
  saveNavigationDownHotkey,
  saveNavigationUpHotkey,
} from "@/lib/hotkey-service";
import { formatHotkeyDisplay } from "@/utils/hotkey-formatting";

export function NavigationHotkeySettings() {
  const [downHotkey, setDownHotkey] = useState<string>("Shift+Down");
  const [upHotkey, setUpHotkey] = useState<string>("Shift+Up");
  const [editingDown, setEditingDown] = useState(false);
  const [editingUp, setEditingUp] = useState(false);
  const [pendingDown, setPendingDown] = useState<string>("");
  const [pendingUp, setPendingUp] = useState<string>("");

  useEffect(() => {
    getSavedNavigationDownHotkey().then(setDownHotkey).catch(console.error);
    getSavedNavigationUpHotkey().then(setUpHotkey).catch(console.error);
  }, []);

  // ... save/cancel handlers for both hotkeys

  return (
    <SettingsSection
      title="Task Navigation Hotkeys"
      description="Keyboard shortcuts for Command+Tab style task navigation. Hold the modifier(s) and press the key to navigate through tasks, then release modifier(s) to open."
    >
      {/* Navigate Down Hotkey */}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-surface-400">Navigate Down</span>
        {editingDown ? (
          <div className="flex items-center gap-2">
            <HotkeyRecorder
              defaultHotkey={downHotkey}
              onHotkeyChanged={setPendingDown}
              autoFocus
            />
            {/* Save/Cancel buttons */}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <kbd className="...">{formatHotkeyDisplay(downHotkey)}</kbd>
            <button onClick={() => setEditingDown(true)}>Change</button>
          </div>
        )}
      </div>

      {/* Navigate Up Hotkey */}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-surface-400">Navigate Up</span>
        {/* Similar structure for up hotkey */}
      </div>
    </SettingsSection>
  );
}
```

#### Part B: Backend Config for Navigation Hotkeys

**File**: `src-tauri/src/config.rs`

Add new config fields:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // ... existing fields ...
    #[serde(default = "default_navigation_down_hotkey")]
    pub navigation_down_hotkey: String,
    #[serde(default = "default_navigation_up_hotkey")]
    pub navigation_up_hotkey: String,
}

fn default_navigation_down_hotkey() -> String {
    "Shift+Down".to_string()
}

fn default_navigation_up_hotkey() -> String {
    "Shift+Up".to_string()
}

// Add getter/setter functions
pub fn get_navigation_down_hotkey() -> String { ... }
pub fn set_navigation_down_hotkey(hotkey: &str) -> Result<(), String> { ... }
pub fn get_navigation_up_hotkey() -> String { ... }
pub fn set_navigation_up_hotkey(hotkey: &str) -> Result<(), String> { ... }
```

**File**: `src-tauri/src/lib.rs`

Add Tauri commands:
```rust
#[tauri::command]
fn save_navigation_down_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    config::set_navigation_down_hotkey(&hotkey)?;
    // Re-register all hotkeys
    register_hotkey_internal(&app, &config::get_spotlight_hotkey())
}

#[tauri::command]
fn get_saved_navigation_down_hotkey() -> String {
    config::get_navigation_down_hotkey()
}

// Same for up hotkey...
```

Update hotkey registration in `register_hotkey_internal`:
```rust
// Replace hardcoded Shift+Down/Up with config values
let nav_down_hotkey = config::get_navigation_down_hotkey();
let nav_down_shortcut: Shortcut = nav_down_hotkey
    .parse()
    .map_err(|e| format!("Failed to parse navigation down hotkey: {:?}", e))?;

let nav_up_hotkey = config::get_navigation_up_hotkey();
let nav_up_shortcut: Shortcut = nav_up_hotkey
    .parse()
    .map_err(|e| format!("Failed to parse navigation up hotkey: {:?}", e))?;
```

#### Part C: Multi-Modifier Release Detection

This is the most complex part. Currently, only Shift release is detected.

**Modifier Flag Constants** (from CGEventFlags):
```rust
const SHIFT_MASK: u64 = 0x00020000;    // CGEventFlagShift
const CONTROL_MASK: u64 = 0x00040000;  // CGEventFlagControl
const OPTION_MASK: u64 = 0x00080000;   // CGEventFlagAlternate
const COMMAND_MASK: u64 = 0x00100000;  // CGEventFlagCommand
```

**Strategy**: When starting navigation mode, store which modifiers were used in the hotkey. Then detect when ALL of those modifiers are released.

**File**: `src-tauri/src/navigation_mode.rs`

```rust
/// Modifier flags that are being monitored for release
#[derive(Debug, Clone, Copy)]
pub struct ActiveModifiers {
    pub shift: bool,
    pub control: bool,
    pub option: bool,
    pub command: bool,
}

impl ActiveModifiers {
    /// Parse modifiers from a hotkey string like "Command+Shift+Down"
    pub fn from_hotkey(hotkey: &str) -> Self {
        let lower = hotkey.to_lowercase();
        Self {
            shift: lower.contains("shift"),
            control: lower.contains("control") || lower.contains("ctrl"),
            option: lower.contains("option") || lower.contains("alt"),
            command: lower.contains("command") || lower.contains("cmd") || lower.contains("meta"),
        }
    }

    /// Get the combined modifier mask
    pub fn to_mask(&self) -> u64 {
        let mut mask = 0u64;
        if self.shift { mask |= SHIFT_MASK; }
        if self.control { mask |= CONTROL_MASK; }
        if self.option { mask |= OPTION_MASK; }
        if self.command { mask |= COMMAND_MASK; }
        mask
    }

    /// Check if ALL tracked modifiers are released
    pub fn all_released(&self, current_flags: u64) -> bool {
        let mask = self.to_mask();
        (current_flags & mask) == 0
    }
}

pub struct NavigationMode {
    // ... existing fields ...
    /// Modifiers that were used to start navigation (need ALL to be released)
    active_modifiers: Mutex<ActiveModifiers>,
}

impl NavigationMode {
    pub fn on_hotkey_pressed(&self, direction: NavigationDirection, hotkey: &str) {
        // Parse which modifiers are in the hotkey
        let modifiers = ActiveModifiers::from_hotkey(hotkey);
        *self.active_modifiers.lock().unwrap() = modifiers;

        // ... rest of existing logic ...
    }
}
```

**Update CGEventTap callback**:

```rust
let active_modifiers = self.active_modifiers.lock().unwrap().clone();
let modifier_mask = active_modifiers.to_mask();

let callback = move |event: CGEvent| -> Option<CGEvent> {
    let flags = event.get_flags();
    let flags_bits = flags.bits();
    let old_flags = prev_flags_clone.swap(flags_bits, Ordering::SeqCst);

    // Check if ALL tracked modifiers were down and are now up
    let modifiers_were_down = (old_flags & modifier_mask) == modifier_mask;
    let modifiers_are_up = (flags_bits & modifier_mask) == 0;

    if modifiers_were_down && modifiers_are_up {
        tracing::info!("NavigationMode: All modifiers released");
        stop_flag_clone.store(true, Ordering::SeqCst);
        get_navigation_mode().on_modifier_released();
    }

    None
};
```

**Alternative Approach**: Detect when ANY of the tracked modifiers is released (simpler, matches Command+Tab behavior):

```rust
// ANY modifier released triggers open
let any_modifier_released =
    (old_flags & modifier_mask) != 0 &&
    (flags_bits & modifier_mask) != (old_flags & modifier_mask);
```

**Recommendation**: Use "ALL modifiers released" to match the user's requirement. This means if the user sets `Command+Shift+Down` as the hotkey, they must release both Command AND Shift to open the task.

#### Part D: Frontend Service Updates

**File**: `src/lib/hotkey-service.ts`

Add new functions:
```typescript
export const saveNavigationDownHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_navigation_down_hotkey", { hotkey });
};

export const getSavedNavigationDownHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_navigation_down_hotkey");
};

export const saveNavigationUpHotkey = async (hotkey: string): Promise<void> => {
  await invoke("save_navigation_up_hotkey", { hotkey });
};

export const getSavedNavigationUpHotkey = async (): Promise<string> => {
  return invoke<string>("get_saved_navigation_up_hotkey");
};
```

#### Part E: Update Settings Page

**File**: `src/components/main-window/settings-page.tsx`

```typescript
import { NavigationHotkeySettings } from "./settings/navigation-hotkey-settings";

// In the component render:
<HotkeySettings />
<ClipboardHotkeySettings />
<TaskPanelHotkeySettings />  {/* For toggle hotkey */}
<NavigationHotkeySettings /> {/* NEW: For navigation up/down hotkeys */}
```

### Files to Create

- `src/components/main-window/settings/navigation-hotkey-settings.tsx`

### Files to Modify

- `src-tauri/src/config.rs` - Add navigation hotkey config
- `src-tauri/src/lib.rs` - Add commands, update hotkey registration
- `src-tauri/src/navigation_mode.rs` - Add ActiveModifiers, multi-modifier detection
- `src/lib/hotkey-service.ts` - Add navigation hotkey service functions
- `src/components/main-window/settings-page.tsx` - Add NavigationHotkeySettings

### Estimated Complexity

High - Multiple files, new UI component, complex modifier detection logic.

---

## Implementation Order

### Phase 1: Quick Wins (Can be done in parallel)

1. **Wrap-around navigation** (Improvement 1)
   - Single file change
   - Low risk

2. **Secondary color highlight** (Improvement 2)
   - Single line change
   - Low risk

### Phase 2: Verification

3. **Panel unfocus behavior** (Improvement 3)
   - Test current behavior
   - Fix if needed

### Phase 3: Configurable Hotkeys (Sequential)

4. **Backend config** (Improvement 4 Part B)
   - Add config fields
   - Add getter/setter functions
   - Add Tauri commands

5. **Multi-modifier detection** (Improvement 4 Part C)
   - Add ActiveModifiers struct
   - Update CGEventTap callback
   - Update on_hotkey_pressed signature

6. **Update hotkey registration** (Improvement 4 Part B continued)
   - Replace hardcoded hotkeys with config values
   - Pass hotkey string to on_hotkey_pressed

7. **Frontend service** (Improvement 4 Part D)
   - Add hotkey service functions

8. **Settings UI** (Improvement 4 Parts A & E)
   - Create NavigationHotkeySettings component
   - Add to settings page

---

## Testing Plan

### Improvement 1: Wrap-Around

- [ ] Navigate to last item, press Down, should wrap to first item
- [ ] Navigate to first item, press Up, should wrap to last item
- [ ] Works with single-item list (stays on same item)
- [ ] Works with empty list (no crash)

### Improvement 2: Secondary Color

- [ ] Verify highlight uses muted teal color
- [ ] Matches simple task input focus ring

### Improvement 3: Panel Unfocus

- [ ] Start navigation, blur panel, no task opens
- [ ] Start navigation, release modifier, task opens
- [ ] Start navigation, press Escape, no task opens

### Improvement 4: Configurable Hotkeys

- [ ] Change navigate down hotkey in settings
- [ ] Change navigate up hotkey in settings
- [ ] Hotkeys persist across app restart
- [ ] Single modifier (Shift+Down) works
- [ ] Double modifier (Command+Shift+J) works
- [ ] All configured modifiers must be released to open task
- [ ] Partial modifier release does not open task

---

## Risk Assessment

| Improvement | Risk | Mitigation |
|-------------|------|------------|
| Wrap-around | Low | Simple arithmetic |
| Color change | Low | Semantic color already exists |
| Panel unfocus | Low | May already work correctly |
| Configurable hotkeys | Medium | Complex modifier logic, thorough testing needed |

---

## Summary

This plan addresses all four requested improvements:

1. **Wrap-around**: Simple change in `use-navigation-mode.ts`
2. **Secondary color**: Replace `blue-500` with `secondary-500` in task panel styling
3. **Panel unfocus**: Verify current behavior (likely already correct)
4. **Configurable hotkeys**: Multi-phase implementation with new settings UI, config changes, and multi-modifier detection

Total estimated files to modify: 7-8
Total new files: 1 (NavigationHotkeySettings component)
