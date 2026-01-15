# Bidirectional Task Navigation Fix Plan

## Problem Diagnosis

### Issue 1: Modifier Key Release Not Working for Task Selection
**Current Behavior**: When using hotkeys to navigate through tasks, releasing the modifier keys doesn't properly select the highlighted task.

**Root Cause**: The current implementation only tracks `isMetaPressed` state based on the `metaKey` property in keyboard events. However, the actual hotkeys can be multi-key combinations like:
- Production: `Shift+Down` (single modifier)
- Development: `Command+Shift+Down` (multiple modifiers)

**Technical Analysis**:
- The keyboard navigation hook only tracks `event.metaKey` (useKeyboardTaskNavigation.ts:64)
- For `Shift+Down`, the Meta key is never pressed, so `isMetaPressed` stays false
- For `Command+Shift+Down`, only the Meta key is tracked, ignoring the Shift key
- The selection should trigger when **ALL** modifier keys in the hotkey are released
- Current implementation fails to parse the actual hotkey and track its constituent modifiers

### Issue 2: Missing Reverse Navigation
**Current Behavior**: Only forward navigation (Shift+Down) is supported.

**Needed**: Shift+Up for backward navigation through the task list.

## Proposed Solution

### Track 1: Fix Modifier Key Release Detection

**Option A: Dynamic Hotkey Parsing and Multi-Modifier Tracking**
Parse the actual configured hotkey and track all its modifier keys, triggering selection only when all modifiers are released.

**Option B: Use Enter Key for Selection**
Simplify the interaction to use Enter key for task selection, removing the modifier key release complexity.

**Recommendation**: Option A - Parse and track all hotkey modifiers for proper Command+Tab-style behavior.

### Track 2: Add Reverse Navigation Support

**Backend Changes**: Add new hotkey registration and navigation functions
**Frontend Changes**: Extend external trigger system to support direction

## Implementation Plan

### Phase 1: Fix Multi-Modifier Key Release Detection

#### Backend Changes (src-tauri/src/lib.rs)
1. **Add hotkey information passing** to frontend
2. **Add second hotkey registration** for reverse navigation (e.g., Shift+Up)
3. **Pass hotkey configuration** to frontend for modifier tracking

#### Frontend Changes
1. **Update useKeyboardTaskNavigation** (src/hooks/use-keyboard-task-navigation.ts):
   - **Add hotkey parsing utility** to extract modifiers from hotkey strings
   - **Track all modifier keys** dynamically based on the actual hotkey
   - **Monitor all relevant modifiers** (Command, Control, Alt, Shift)
   - **Trigger selection only when ALL hotkey modifiers are released**
   - Add direction parameter to external navigation trigger

2. **Create hotkey parser utility**:
   ```typescript
   interface HotkeyModifiers {
     meta: boolean;    // Command on Mac, Ctrl on Windows/Linux
     ctrl: boolean;    // Control key
     alt: boolean;     // Alt/Option key
     shift: boolean;   // Shift key
   }

   function parseHotkey(hotkeyString: string): HotkeyModifiers {
     const parts = hotkeyString.toLowerCase().split('+');
     return {
       meta: parts.includes('command') || parts.includes('cmd') || parts.includes('meta'),
       ctrl: parts.includes('control') || parts.includes('ctrl'),
       alt: parts.includes('alt') || parts.includes('option'),
       shift: parts.includes('shift')
     };
   }
   ```

3. **Update modifier tracking logic**:
   ```typescript
   const [pressedModifiers, setPressedModifiers] = useState<HotkeyModifiers>({
     meta: false, ctrl: false, alt: false, shift: false
   });

   const handleKeyDown = useCallback((event: KeyboardEvent) => {
     // Track all modifiers that are part of the hotkey
     setPressedModifiers(prev => ({
       meta: requiredModifiers.meta ? (prev.meta || event.metaKey) : prev.meta,
       ctrl: requiredModifiers.ctrl ? (prev.ctrl || event.ctrlKey) : prev.ctrl,
       alt: requiredModifiers.alt ? (prev.alt || event.altKey) : prev.alt,
       shift: requiredModifiers.shift ? (prev.shift || event.shiftKey) : prev.shift,
     }));
   }, [requiredModifiers]);

   const handleKeyUp = useCallback((event: KeyboardEvent) => {
     // Update modifier states and check if all hotkey modifiers are released
     const newModifiers = {
       meta: requiredModifiers.meta ? (pressedModifiers.meta && event.metaKey) : false,
       ctrl: requiredModifiers.ctrl ? (pressedModifiers.ctrl && event.ctrlKey) : false,
       alt: requiredModifiers.alt ? (pressedModifiers.alt && event.altKey) : false,
       shift: requiredModifiers.shift ? (pressedModifiers.shift && event.shiftKey) : false,
     };

     setPressedModifiers(newModifiers);

     // Check if all required modifiers are now released
     const allModifiersReleased = Object.values(newModifiers).every(pressed => !pressed);
     if (allModifiersReleased && selectedTask && onMetaKeyRelease) {
       onMetaKeyRelease(selectedTask);
     }
   }, [pressedModifiers, requiredModifiers, selectedTask, onMetaKeyRelease]);
   ```

4. **Update TasksPanel** (src/components/tasks-panel/tasks-panel.tsx):
   - **Pass current hotkey string** to UnifiedTaskList for modifier parsing
   - Handle both forward and backward navigation events
   - Update navigation trigger to include direction

5. **Update UnifiedTaskList** (src/components/shared/unified-task-list.tsx):
   - **Accept hotkey configuration** as prop
   - Pass hotkey and direction information to keyboard hook

6. **Add frontend hotkey retrieval**:
   ```typescript
   // In TasksPanel component
   const [currentHotkey, setCurrentHotkey] = useState<string>("");

   useEffect(() => {
     const fetchHotkey = async () => {
       const hotkey = await invoke("get_saved_task_panel_hotkey") as string;
       setCurrentHotkey(hotkey);
     };
     fetchHotkey();
   }, []);
   ```

### Phase 2: Add Bidirectional Navigation

#### Backend Changes (src-tauri/src/panels.rs)
1. **Add navigation direction enum**:
   ```rust
   #[derive(Clone, Copy)]
   pub enum NavigationDirection {
       Forward,
       Backward,
   }
   ```

2. **Update navigate_next_task function**:
   ```rust
   pub fn navigate_task(app: &AppHandle, direction: NavigationDirection) {
       if is_navigation_mode_active() {
           let event_data = serde_json::json!({ "direction": direction });
           let _ = app.emit_to(TASKS_LIST_LABEL, "navigate", event_data);
       }
   }
   ```

3. **Add reverse navigation function**:
   ```rust
   pub fn navigate_previous_task(app: &AppHandle) {
       navigate_task(app, NavigationDirection::Backward);
   }
   ```

#### Backend Changes (src-tauri/src/lib.rs)
1. **Add Shift+Up hotkey registration**:
   ```rust
   // Register both hotkeys in register_hotkey_internal
   let task_panel_up_hotkey = "Shift+Up";
   let task_panel_down_hotkey = config::get_task_panel_hotkey(); // Shift+Down
   ```

2. **Update hotkey handlers**:
   ```rust
   // Shift+Down handler (existing)
   app.global_shortcut().on_shortcut(down_shortcut, move |_app, _shortcut, event| {
       if event.state == ShortcutState::Pressed {
           if panels::is_navigation_mode_active() {
               panels::navigate_task(&app_handle, NavigationDirection::Forward);
           } else {
               let _ = panels::show_tasks_list(&app_handle);
           }
       }
   });

   // Shift+Up handler (new)
   app.global_shortcut().on_shortcut(up_shortcut, move |_app, _shortcut, event| {
       if event.state == ShortcutState::Pressed {
           if panels::is_navigation_mode_active() {
               panels::navigate_task(&app_handle, NavigationDirection::Backward);
           }
           // Don't open panel on Shift+Up - only navigate if already open
       }
   });
   ```

#### Frontend Changes

1. **Update useKeyboardTaskNavigation hook**:
   ```typescript
   interface NavigationTrigger {
     count: number;
     direction: 'forward' | 'backward';
   }

   interface KeyboardNavigationConfig {
     // ... existing props
     externalNavigateTrigger?: NavigationTrigger;
   }

   // Update effect to handle direction
   useEffect(() => {
     if (externalNavigateTrigger && externalNavigateTrigger.count > prevTriggerRef.current) {
       if (externalNavigateTrigger.direction === 'forward') {
         setSelectedIndex((prev) => (prev + 1) % tasks.length);
       } else {
         setSelectedIndex((prev) => prev === 0 ? tasks.length - 1 : prev - 1);
       }
       prevTriggerRef.current = externalNavigateTrigger.count;
     }
   }, [externalNavigateTrigger, tasks.length]);

   // Update Shift key tracking
   const handleKeyDown = useCallback((event: KeyboardEvent) => {
     if (event.shiftKey && !isShiftPressed) {
       setIsShiftPressed(true);
     }
     // ... existing navigation logic
   }, [tasks, selectedTask, onSelect, isShiftPressed]);

   const handleKeyUp = useCallback((event: KeyboardEvent) => {
     if (event.key === 'Shift' && isShiftPressed) {
       setIsShiftPressed(false);
       if (selectedTask && onMetaKeyRelease) {
         onMetaKeyRelease(selectedTask);
       }
     }
   }, [selectedTask, onMetaKeyRelease, isShiftPressed]);
   ```

2. **Update TasksPanel component**:
   ```typescript
   const [navigationTrigger, setNavigationTrigger] = useState<NavigationTrigger>({
     count: 0,
     direction: 'forward'
   });

   // Listen for navigate events with direction
   unlistenNavigate = await listen("navigate", (event) => {
     const direction = event.payload.direction === 'Forward' ? 'forward' : 'backward';
     setNavigationTrigger(prev => ({ count: prev.count + 1, direction }));
   });
   ```

### Phase 3: Configuration Support

#### Backend Changes (src-tauri/src/config.rs)
1. **Add reverse navigation hotkey config**:
   ```rust
   #[derive(Serialize, Deserialize)]
   struct Config {
       // ... existing fields
       task_panel_reverse_hotkey: String,
   }

   pub fn get_task_panel_reverse_hotkey() -> String {
       let hotkey = load_config().task_panel_reverse_hotkey;
       if hotkey.is_empty() {
           "Shift+Up".to_string()
       } else {
           hotkey
       }
   }
   ```

2. **Add command for saving reverse hotkey**:
   ```rust
   #[tauri::command]
   fn save_task_panel_reverse_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
       config::set_task_panel_reverse_hotkey(&hotkey)?;
       let spotlight_hotkey = config::get_spotlight_hotkey();
       register_hotkey_internal(&app, &spotlight_hotkey)
   }
   ```

### Testing Strategy

1. **Manual Testing Scenarios**:

   **Single Modifier Hotkeys (e.g., Shift+Down)**:
   - Shift+Down to open panel → first task should be selected
   - Multiple Shift+Down presses → should advance through tasks
   - Shift+Up while navigating → should go backwards
   - Release Shift key → should select current task and close panel

   **Multi-Modifier Hotkeys (e.g., Command+Shift+Down)**:
   - Command+Shift+Down to open panel → first task should be selected
   - Multiple Command+Shift+Down presses → should advance through tasks
   - Command+Shift+Up while navigating → should go backwards
   - Release only Command key → should continue navigation (not select)
   - Release only Shift key → should continue navigation (not select)
   - Release BOTH Command+Shift keys → should select current task and close panel

   **General Scenarios**:
   - Click outside → should close panel without selection
   - Hotkey on empty task list → should handle gracefully
   - Reverse hotkey when panel closed → should do nothing

2. **Edge Cases**:
   - Very fast forward/backward hotkey alternation
   - Panel open while modifier keys are stuck/held
   - Task list changes during navigation
   - Multiple monitors positioning
   - Partial modifier release and re-press during navigation
   - Switching between applications while navigating
   - Different hotkey configurations (single vs multi-modifier)

### Rollout Strategy

1. **Phase 1**: Fix meta key release detection
2. **Phase 2**: Add bidirectional navigation with hardcoded hotkeys
3. **Phase 3**: Add configuration support for custom hotkeys

### Risks and Mitigations

1. **Risk**: Hotkey conflicts with system shortcuts
   **Mitigation**: Document known conflicts, provide configuration options

2. **Risk**: Race conditions between rapid key presses
   **Mitigation**: Debounce navigation events, use atomic operations

3. **Risk**: Broken navigation on task list updates
   **Mitigation**: Reset navigation state on task list changes

4. **Risk**: Inconsistent behavior across platforms
   **Mitigation**: Test on multiple macOS versions, consider platform-specific handlers

## Success Criteria

### Core Navigation
1. ✅ Forward hotkey opens panel and selects first task
2. ✅ Continued forward hotkey presses navigate forward through tasks
3. ✅ Reverse hotkey navigates backward through tasks (when panel open)
4. ✅ Visual feedback shows currently selected task
5. ✅ Navigation wraps around at list boundaries
6. ✅ Click outside or Esc closes panel without selection
7. ✅ Empty task list handled gracefully

### Multi-Modifier Key Handling
8. ✅ **Single modifier hotkeys** (e.g., Shift+Down): Release single modifier selects task
9. ✅ **Multi-modifier hotkeys** (e.g., Command+Shift+Down): Selection only occurs when ALL modifiers released
10. ✅ **Partial modifier release**: Navigation continues when only some modifiers released
11. ✅ **Dynamic hotkey parsing**: Works with any combination of Command/Control/Alt/Shift modifiers

### Configuration and Compatibility
12. ✅ Configuration UI supports custom hotkeys
13. ✅ Works with both single and multi-modifier configurations
14. ✅ Graceful fallback for unsupported hotkey formats

## Implementation Notes

- Maintain existing keyboard navigation for arrow keys and Tab
- Preserve existing click-to-select functionality
- Keep panel positioning and styling unchanged
- Ensure compatibility with existing task filtering/sorting
- Document new hotkeys in help/onboarding