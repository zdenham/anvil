# 09: Tauri Backend Changes

**Dependencies:** 03-delete-tasks.md, 08-control-panel.md
**Can run parallel with:** 04-thread-refactor.md, 05-plan-entity.md

## Goal

Update the Rust/Tauri backend to remove task references and support new architecture.

## Tasks

### 1. Remove task commands

Update `src-tauri/src/anvil_commands.rs`:

**Remove:**
- `update_task()` command (lines 296-318) - this is the only task command that emits events (`task:update-from-agent`)

### 2. Remove task window functions from lib.rs

Update `src-tauri/src/lib.rs`:

**Remove these public functions:**
- `open_task()` function
- `hide_task()` function
- `show_tasks_panel()` function
- `hide_tasks_panel()` function

**Note:** The simple-task renaming (`open_simple_task()` → `open_control_panel()`, `hide_simple_task()` → `hide_control_panel()`) is handled in 08-control-panel.md.

### 3. Remove task panel code from panels.rs

Update `src-tauri/src/panels.rs`:

**Remove constants:**
- `TASK_LABEL`
- `TASK_WIDTH`
- `TASK_HEIGHT`
- `TASKS_LIST_LABEL`
- `TASKS_LIST_WIDTH`
- `TASKS_LIST_HEIGHT`

**Remove structs and handlers:**
- `TaskPanel` struct
- `TaskEventHandler` struct
- `TasksListPanel` struct
- `TasksListEventHandler` struct
- `PendingTask` struct

**Remove functions:**
- `create_task_panel()`
- `show_task()`
- `hide_task()`
- `create_tasks_list_panel()`
- `show_tasks_list()`
- `hide_tasks_list()`
- `set_pending_task()`
- `get_pending_task()`
- `clear_pending_task()`
- `peek_pending_task()`

**Note:** Simple-task panel code renaming (`SIMPLE_TASK_LABEL`, `create_simple_task_panel()`, etc.) is handled in 08-control-panel.md.

### 4. Remove task navigation hotkeys from config.rs

Update `src-tauri/src/config.rs`:

**Remove:**
- `task_navigation_down_hotkey`
- `task_navigation_up_hotkey`
- Any other task-related hotkey configs

### 5. Remove navigation_mode.rs

The `src-tauri/src/navigation_mode.rs` file is task-panel specific:
- Contains "task navigation" terminology throughout
- Calls `panels::show_tasks_list(app)` (line 173)
- Has commands `navigation_hotkey_down`, `navigation_hotkey_up`, `navigation_panel_blur`

**Action:** Remove `navigation_mode.rs` entirely since the tasks-list panel concept is being removed.

### 6. Remove task panel creation from setup()

Update `src-tauri/src/lib.rs` `setup()` function:

**Remove these calls:**
- `panels::create_task_panel(app.handle())` (around line 992)
- `panels::create_tasks_list_panel(app.handle())` (around line 1001)

### 7. Remove task navigation hotkey registration

Update `src-tauri/src/lib.rs` `register_hotkey_internal()` function (starting around line 111):

**Remove:**
- The entire block registering task navigation hotkeys on macOS (lines 180-266 approximately)

### 8. Update command registration

Update `src-tauri/src/lib.rs` `.invoke_handler(tauri::generate_handler![...])`:

**Remove these commands:**
- `open_task`
- `hide_task`
- `show_tasks_panel`
- `hide_tasks_panel`
- `anvil_commands::update_task`
- `save_task_navigation_down_hotkey`
- `get_saved_task_navigation_down_hotkey`
- `save_task_navigation_up_hotkey`
- `get_saved_task_navigation_up_hotkey`
- `navigation_hotkey_down` (from navigation_mode.rs)
- `navigation_hotkey_up` (from navigation_mode.rs)
- `navigation_panel_blur` (from navigation_mode.rs)

### 9. Remove navigation_mode.rs module declaration

Update `src-tauri/src/lib.rs`:

**Remove:**
- `mod navigation_mode;` declaration
- Any `use navigation_mode::*;` statements

### 10. Clean up unused imports

After removing task code, clean up any unused imports in:
- `src-tauri/src/lib.rs`
- `src-tauri/src/panels.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/anvil_commands.rs`

## Note on Event Handling

The TypeScript event bridge (`src/lib/event-bridge.ts`) task event handling is covered by plan 03-delete-tasks.md, not this plan. This plan only removes the Rust-side task code.

The Rust backend emits one task-related event via `update_task()` which emits `task:update-from-agent`. This event emission is removed when the `update_task` command is removed in Task 1.

## Verification

```bash
# Check for task-related code patterns (more specific to avoid false positives)
grep -r "task_id\|TaskPanel\|TasksList\|TASK_LABEL\|TASKS_LIST\|task::\|PendingTask" --include="*.rs" src-tauri/src/

# Check for navigation_mode references
grep -r "navigation_mode\|navigation_hotkey" --include="*.rs" src-tauri/src/

# Build should succeed
cd src-tauri && cargo build
```

## Acceptance Criteria

- [ ] `update_task` command removed from anvil_commands.rs
- [ ] Task window functions removed from lib.rs (`open_task`, `hide_task`, `show_tasks_panel`, `hide_tasks_panel`)
- [ ] Task panel structs, handlers, and functions removed from panels.rs
- [ ] Task panel constants removed from panels.rs
- [ ] `PendingTask` state management removed from panels.rs
- [ ] Task navigation hotkeys removed from config.rs
- [ ] `navigation_mode.rs` file removed entirely
- [ ] Task panel creation calls removed from setup()
- [ ] Task navigation hotkey registration removed from register_hotkey_internal()
- [ ] All task-related commands removed from invoke_handler registration
- [ ] `navigation_mode` module declaration removed from lib.rs
- [ ] Unused imports cleaned up
- [ ] Rust compiles without errors (`cargo build` succeeds)
- [ ] Verification grep commands return no results

## Programmatic Testing Plan

The implementation agent must create and pass all of the following automated tests before considering this plan complete.

### 1. Compilation Tests

**Test: Rust project compiles successfully**
```bash
cd src-tauri && cargo build 2>&1
```
- Expected: Build succeeds with exit code 0
- No compilation errors related to missing task functions, structs, or modules

**Test: Rust project compiles in release mode**
```bash
cd src-tauri && cargo build --release 2>&1
```
- Expected: Build succeeds with exit code 0

### 2. Code Removal Verification Tests

**Test: No task-related patterns remain in Rust source**
```bash
grep -rE "task_id|TaskPanel|TasksList|TASK_LABEL|TASKS_LIST|task::|PendingTask" --include="*.rs" src-tauri/src/
```
- Expected: No matches found (exit code 1, empty output)

**Test: No navigation_mode references remain**
```bash
grep -rE "navigation_mode|navigation_hotkey" --include="*.rs" src-tauri/src/
```
- Expected: No matches found (exit code 1, empty output)

**Test: navigation_mode.rs file is deleted**
```bash
test ! -f src-tauri/src/navigation_mode.rs && echo "PASS: File deleted"
```
- Expected: "PASS: File deleted" output

**Test: No update_task command in anvil_commands.rs**
```bash
grep -E "pub.*fn.*update_task|async.*fn.*update_task" src-tauri/src/anvil_commands.rs
```
- Expected: No matches found (exit code 1, empty output)

**Test: No task window functions in lib.rs**
```bash
grep -E "pub.*fn.*(open_task|hide_task|show_tasks_panel|hide_tasks_panel)\s*\(" src-tauri/src/lib.rs
```
- Expected: No matches found (exit code 1, empty output)

**Test: No task navigation hotkey configs in config.rs**
```bash
grep -E "task_navigation_(down|up)_hotkey" src-tauri/src/config.rs
```
- Expected: No matches found (exit code 1, empty output)

**Test: No task panel creation in setup()**
```bash
grep -E "create_task_panel|create_tasks_list_panel" src-tauri/src/lib.rs
```
- Expected: No matches found (exit code 1, empty output)

### 3. Cargo Check Tests

**Test: No unused imports warnings**
```bash
cd src-tauri && cargo check 2>&1 | grep -E "unused import|unused variable" | grep -iE "task|navigation"
```
- Expected: No task/navigation-related unused import warnings

**Test: No dead code warnings for removed items**
```bash
cd src-tauri && cargo check 2>&1 | grep -E "dead_code" | grep -iE "task|navigation"
```
- Expected: No task/navigation-related dead code warnings

### 4. Integration Smoke Test

**Test: Tauri app starts without panics (if testable in CI)**
```bash
cd src-tauri && timeout 10 cargo run -- --version 2>&1 || true
```
- Expected: No panic messages related to missing task modules or functions
- Note: This test may need adjustment based on how the app handles --version flag

### 5. Module Structure Tests

**Test: lib.rs does not declare navigation_mode module**
```bash
grep -E "^mod navigation_mode" src-tauri/src/lib.rs
```
- Expected: No matches found (exit code 1, empty output)

**Test: invoke_handler does not register removed commands**
```bash
grep -E "open_task|hide_task|show_tasks_panel|hide_tasks_panel|update_task|navigation_hotkey_down|navigation_hotkey_up|navigation_panel_blur|save_task_navigation|get_saved_task_navigation" src-tauri/src/lib.rs | grep -v "//"
```
- Expected: No non-commented matches found

### Test Execution Requirements

The implementation agent must:
1. Run all tests after completing the implementation
2. Fix any failing tests before marking the plan complete
3. Document any test that cannot be run (e.g., environment-specific) with justification
4. All grep-based verification tests must return no matches (indicating complete removal)
5. All compilation tests must succeed with exit code 0
