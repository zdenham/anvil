# Inbox Navigation Fix Plan

## Problem Statement

The control panel navigation feature (Alt+Down/Up) was supposed to work like "Mission Control" for the unified inbox - showing the inbox list and allowing keyboard navigation through items with modifier release to open the selected item.

Currently, the infrastructure exists but there's a critical disconnect: navigation mode needs to show a **dedicated inbox list panel**, separate from the control panel that shows thread/plan views. The current implementation incorrectly tries to reuse the control panel for the inbox view.

## Reference Implementation

At commit `8841290ffe92dd5912fa5d96fdaccf55bdfbb604`, a similar feature worked for tasks:
- Used a dedicated `tasks-panel` with its own URL route and **separate native NSPanel**
- Navigation mode would call `panels::show_tasks_list(app)`
- The tasks panel had `useNavigationMode` hook integrated
- Clear separation: `tasks-panel` for navigation list, `control-panel` for task details

## Architecture Clarification

**Two separate native panels are required:**

| Panel | Purpose | Tauri Label |
|-------|---------|-------------|
| **Inbox List Panel** | Shows unified inbox for navigation mode (Alt+Down/Up) | `inbox-list-panel` |
| **Control Panel** | Shows thread conversation or plan details | `control-panel` |

This matches the old tasks architecture where `tasks-panel` was distinct from `control-panel`.

## Current State Analysis

### What's Already Working
1. **Rust backend** (`navigation_mode.rs`): Complete state machine with Alt key detection via CGEventTap
2. **Hotkey registration** (`lib.rs`): Alt+Down/Up properly registered and calling `on_hotkey_pressed`
3. **Frontend hook** (`use-navigation-mode.ts`): Listens for navigation events, manages selection state
4. **Unified inbox component** (`unified-inbox.tsx`): Already uses `useNavigationMode` hook with proper callbacks
5. **Event types** (`events.ts`): All navigation events defined

### What's Missing
1. **Dedicated `inbox-list-panel` native NSPanel** - Does not exist yet
2. **Rust panel management** for `inbox-list-panel` - `show_inbox_list()`, `hide_inbox_list()` functions
3. **Frontend route/window** for the inbox list panel
4. **Navigation mode calling the correct panel** - Currently calls `show_control_panel_simple()`

### What Should Be Removed/Changed
1. **`InboxView` in `control-panel-window.tsx`** - This was a wrong approach; inbox list should not be a view mode of the control panel
2. **`view.type === "inbox"` routing** - Remove from control panel, it belongs in its own panel

## Implementation Plan

### Step 1: Create Inbox List Panel (Rust)

Add new panel functions in `src-tauri/src/panels.rs`:

```rust
pub fn show_inbox_list(app: &AppHandle) -> Result<()> {
    // Similar to old show_tasks_list implementation
    // Create/show NSPanel with label "inbox-list-panel"
    // Load route: /inbox-list
}

pub fn hide_inbox_list(app: &AppHandle) -> Result<()> {
    // Hide the inbox-list-panel
}

pub fn focus_inbox_list(app: &AppHandle) -> Result<()> {
    // Focus the inbox-list-panel
}
```

### Step 2: Register Inbox List Panel Window

In `src-tauri/tauri.conf.json` or programmatically, ensure the `inbox-list-panel` window is configured:
- Decorations: false
- Transparent: true
- Always on top: true
- Skip taskbar: true
- Similar config to old tasks-panel

### Step 3: Create Frontend Inbox List Window

Create new files:
- `src/components/inbox-list-panel/inbox-list-window.tsx` - Main window component
- `src/components/inbox-list-panel/use-inbox-list-params.ts` - Params hook (if needed)
- `src/routes/inbox-list.tsx` - Route entry point

The window component should:
- Render `<UnifiedInbox />` with navigation mode integration
- Handle `nav-cancel` to hide itself
- Handle item selection to open control panel with selected thread/plan

### Step 4: Update Navigation Mode (Rust)

Modify `src-tauri/src/navigation_mode.rs`:

```rust
// Replace show_control_panel_simple() with:
panels::show_inbox_list(app)?;

// On nav-cancel:
panels::hide_inbox_list(app)?;

// On nav-open (item selected):
panels::hide_inbox_list(app)?;
// The frontend will call show_control_panel with the selected thread/plan
```

### Step 5: Update Frontend Navigation Flow

In the inbox list panel, when an item is selected via navigation:

```typescript
const handleItemSelect = (item: ThreadMetadata | PlanMetadata) => {
  // Hide inbox list panel
  invoke("hide_inbox_list_panel");

  // Open control panel with selected item
  if ('messages' in item || item.type === 'thread') {
    switchToThread(item.id);
  } else {
    switchToPlan(item.id);
  }
};
```

### Step 6: Clean Up Control Panel

Remove inbox view from control panel:
1. Delete `InboxView` component from `control-panel-window.tsx`
2. Remove `view.type === "inbox"` routing
3. Remove `UnifiedInbox` import (if no longer needed there)

### Step 7: Add Tauri Commands

Add IPC commands for the new panel:

```rust
#[tauri::command]
pub async fn show_inbox_list_panel(app: AppHandle) -> Result<(), String> { ... }

#[tauri::command]
pub async fn hide_inbox_list_panel(app: AppHandle) -> Result<(), String> { ... }

#[tauri::command]
pub async fn focus_inbox_list_panel(app: AppHandle) -> Result<(), String> { ... }
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/inbox-list-panel/inbox-list-window.tsx` | Main inbox list panel component |
| `src/routes/inbox-list.tsx` | Route for inbox list panel |

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/panels.rs` | Add `show_inbox_list`, `hide_inbox_list`, `focus_inbox_list` |
| `src-tauri/src/lib.rs` | Register new Tauri commands for inbox list panel |
| `src-tauri/src/navigation_mode.rs` | Call `show_inbox_list` instead of `show_control_panel_simple` |
| `src-tauri/tauri.conf.json` | Add `inbox-list-panel` window config (if declarative) |
| `src/components/control-panel/control-panel-window.tsx` | Remove `InboxView` and inbox routing |
| `src/App.tsx` or router config | Add `/inbox-list` route |

## Testing Checklist

- [ ] Alt+Down shows **inbox list panel** (not control panel)
- [ ] Alt+Up shows **inbox list panel** (not control panel)
- [ ] Repeated Alt+Down/Up navigates through items in inbox list panel
- [ ] Selection highlights correctly during navigation
- [ ] Releasing Alt opens the selected thread in **control panel**
- [ ] Releasing Alt opens the selected plan in **control panel**
- [ ] Escape cancels navigation and hides **inbox list panel**
- [ ] Panel blur cancels navigation and hides **inbox list panel**
- [ ] Navigation works with mixed threads and plans
- [ ] Navigation wraps at list boundaries (already implemented in hook)
- [ ] Opening a thread via navigation shows thread view in control panel
- [ ] Opening a plan via navigation shows plan view in control panel
- [ ] Both panels can coexist (inbox list panel + control panel visible simultaneously during transition)

## Success Criteria

After implementation:
1. Press Alt+Down → **Inbox list panel** appears showing unified inbox with first item selected
2. Hold Alt, press Down repeatedly → Selection moves through items in inbox list panel
3. Hold Alt, press Up → Selection moves up in inbox list panel
4. Release Alt → Inbox list panel hides, **control panel** opens with selected thread/plan
5. Press Escape during navigation → Inbox list panel hides, navigation cancelled

## Panel Naming Convention

| Native Panel | Tauri Label | Purpose |
|--------------|-------------|---------|
| Inbox List Panel | `inbox-list-panel` | Navigation mode inbox list |
| Control Panel | `control-panel` | Thread/plan detail view |
