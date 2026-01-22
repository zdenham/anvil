# Control Panel View Mode Refactor

## Overview

The control panel (formerly "simple task pane") needs architectural changes to support two distinct view modes:

1. **Plan View** - When a plan is opened, shows ONLY the plan content
2. **Thread View** - When a thread is opened, shows thread conversation + diff tabs

Each mode will have its own set of quick actions appropriate to that content type.

## Current State

The current implementation has THREE tabs that cycle: `thread -> plan -> changes -> thread`

```typescript
// Current toggle logic in control-panel-window.tsx
const handleToggleView = useCallback(() => {
  setActiveView((current) => {
    switch (current) {
      case "thread": return "plan";
      case "plan": return "changes";
      case "changes": return "thread";
    }
  });
}, []);
```

## Target State

### View Modes

| Mode | Tabs Available | Tab Toggle Behavior |
|------|----------------|---------------------|
| Plan | (none) | Single view showing plan content |
| Thread | conversation, changes | Toggle between conversation and file diff |

### Quick Actions by Mode

**Plan View Actions:**
- Create thread from plan
- Edit plan
- Delete plan
- (No thread-specific actions like archive, markUnread)

**Thread View Actions (default):**
- Archive thread
- Mark as unread
- Delete thread
- Toggle view (conversation/changes)

**Thread View Actions (streaming):**
- Cancel
- Pause/Resume

## Type Foundation

The discriminated union should be simplified in `src/entities/events.ts`:

```typescript
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string };
```

**Key design decision:** Tabs are managed as local component state, not part of the routing type.

- The union only captures *what* to show (thread or plan), not *how* to show it (which tab)
- Thread view manages its own `conversation | changes` tab state locally
- Plan view has no tabs - it's a single view showing plan content
- This keeps routing concerns separate from UI state

## Implementation Plan

### Phase 1: Update Control Panel Routing

**File: `src/components/control-panel/control-panel-window.tsx`**

1. Replace string-based `activeView` state with discriminated union
2. Implement conditional rendering based on `view.type`:
   ```typescript
   if (view.type === "plan") {
     return <PlanView planId={view.planId} />;
   } else {
     return <ThreadView threadId={view.threadId} />;
   }
   ```
3. Remove the three-way toggle cycle
4. Thread view manages its own tab state internally (conversation/changes toggle)
5. Plan view has no tabs - single view

### Phase 2: Update Parameters Hook

**File: `src/components/control-panel/use-control-panel-params.ts`**

1. Fully adopt the `ControlPanelViewType` discriminated union
2. Remove legacy string-based `initialView` handling (or keep for backward compat)
3. Return properly typed view object to consuming components

### Phase 3: Update Store

**File: `src/components/control-panel/store.ts`**

1. Store active view as discriminated union type
2. No tab state in store - tabs are local component state

```typescript
interface ControlPanelState {
  view: ControlPanelViewType | null;
  setView: (view: ControlPanelViewType) => void;
}
```

### Phase 4: Context-Aware Quick Actions

**Files:**
- `src/stores/quick-actions-store.ts`
- `src/components/control-panel/suggested-actions-panel.tsx`

1. Define separate action lists:
   ```typescript
   const planDefaultActions: QuickAction[] = [
     { id: "createThread", label: "Create Thread", ... },
     { id: "editPlan", label: "Edit", ... },
   ];

   const threadDefaultActions: QuickAction[] = [
     { id: "archive", label: "Archive", ... },
     { id: "markUnread", label: "Mark Unread", ... },
   ];

   const threadStreamingActions: QuickAction[] = [
     { id: "cancel", label: "Cancel", ... },
   ];
   ```

2. Update `SuggestedActionsPanel` to receive view type and select appropriate actions:
   ```typescript
   const actions = useMemo(() => {
     if (view.type === "plan") {
       return planDefaultActions;
     }
     return isStreaming ? threadStreamingActions : threadDefaultActions;
   }, [view.type, isStreaming]);
   ```

### Phase 5: Header Refactor

**File: `src/components/control-panel/control-panel-header.tsx`**

1. Conditionally render based on view type
2. Plan mode header:
   - Plan name as title
   - No tabs, no streaming indicators
3. Thread mode header:
   - Thread status dot
   - Breadcrumb with repo/thread info
   - Cancel button when streaming
   - Tab toggle (conversation/changes) - controlled by local state passed from parent

### Phase 6: Inbox → Control Panel Wiring

**Problem:** The unified inbox has click handlers that are currently TODOs. We need to wire up thread and plan selection to open the control panel.

**Files:**
- `src/components/main-window/main-window-layout.tsx`
- `src/lib/hotkey-service.ts`
- `src/lib/tauri-commands.ts`

#### 6.1 Implement Inbox Click Handlers

In `main-window-layout.tsx`, the handlers need implementation:

```typescript
const handleThreadSelect = useCallback(async (thread: ThreadMetadata) => {
  // Option A: Open native panel (if not already open)
  await openControlPanel(thread.id, thread.taskId ?? "", undefined);

  // Option B: Client-side switch (if panel already open, avoids focus flicker)
  // eventBus.emit("open-control-panel", {
  //   view: { type: "thread", threadId: thread.id }
  // });
}, []);

const handlePlanSelect = useCallback(async (plan: PlanMetadata) => {
  // Emit event for control panel to handle
  eventBus.emit("open-control-panel", {
    view: { type: "plan", planId: plan.id }
  });

  // If panel not visible, need to show it
  await invoke("show_control_panel");
}, []);
```

#### 6.2 Add `show_control_panel` Tauri Command

The existing `open_control_panel` command sets up thread context. We need a simpler command that just shows the panel (for plans, or when switching views client-side):

```rust
// src-tauri/src/panels.rs
#[tauri::command]
pub async fn show_control_panel(app: AppHandle) -> Result<(), String> {
    // Show the control panel window without setting thread context
    // Panel will receive view info via eventBus
}
```

#### 6.3 Update Event Payload Schema

Ensure `OpenControlPanelPayload` in `src/entities/events.ts` properly supports the discriminated union:

```typescript
export interface OpenControlPanelPayload {
  // Legacy fields (keep for backward compat during migration)
  threadId?: string;
  prompt?: string;
  initialView?: "thread" | "changes" | "plan";

  // New discriminated union (preferred)
  view?: ControlPanelViewType;
}
```

### Phase 7: Local Navigation Support

**Problem:** Quick actions should support "local" navigation where the user can switch threads/plans without the native panel needing to open or refocus.

**Current state:** `useNavigationMode` hook exists for Shift+Up/Down keyboard navigation through lists. `switchControlPanelClientSide()` exists in hotkey-service for client-side thread switching.

**Files:**
- `src/lib/hotkey-service.ts`
- `src/hooks/use-navigation-mode.ts`
- `src/components/inbox/unified-inbox.tsx`

#### 7.1 Extend Client-Side Switch for Plans

Add plan support to `hotkey-service.ts`:

```typescript
export const switchControlPanelClientSide = (
  view: ControlPanelViewType,
): void => {
  import("@/entities").then(({ eventBus }) => {
    logger.debug(`[hotkey-service] Client-side switch to:`, view);
    eventBus.emit("open-control-panel", { view });
  });
};

// Convenience wrappers
export const switchToThread = (threadId: string) =>
  switchControlPanelClientSide({ type: "thread", threadId });

export const switchToPlan = (planId: string) =>
  switchControlPanelClientSide({ type: "plan", planId });
```

#### 7.2 Use Navigation Mode for Inbox

The inbox should integrate with `useNavigationMode` for keyboard-driven selection:

```typescript
// In unified-inbox.tsx
const { isNavigating, selectedIndex } = useNavigationMode({
  itemCount: items.length,
  onItemSelect: (index) => {
    const item = items[index];
    if (item.type === "thread") {
      switchToThread(item.data.id);
    } else {
      switchToPlan(item.data.id);
    }
  },
});
```

#### 7.3 Visual Feedback During Navigation

When `isNavigating` is true, highlight the `selectedIndex` item in the inbox list without opening the panel. The panel opens only when Shift is released (`nav-open` event).

### Phase 8: Leverage Existing Plan Components

The following components already exist and should be integrated:
- `plan-view.tsx` - Plan content display (simplify to remove tabs)
- `plan-view-header.tsx` - Header for plan view
- `plan-input-area.tsx` - Input area for creating threads from plans

Ensure these are properly used in the Plan mode flow.

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `control-panel-window.tsx` | Major | Discriminated union routing, conditional rendering |
| `use-control-panel-params.ts` | Moderate | Full adoption of new type system |
| `store.ts` | Moderate | Store discriminated union, tab tracking |
| `suggested-actions-panel.tsx` | Moderate | Accept view type, select actions |
| `quick-actions-store.ts` | Moderate | Add plan-specific action lists |
| `control-panel-header.tsx` | Moderate | Conditional header rendering |
| `plan-view.tsx` | Minor | Integration into main flow |
| `main-window-layout.tsx` | Moderate | Implement inbox click handlers |
| `hotkey-service.ts` | Moderate | Add plan switching, refactor to use discriminated union |
| `src-tauri/src/panels.rs` | Minor | Add `show_control_panel` command |
| `unified-inbox.tsx` | Moderate | Integrate navigation mode, visual feedback |
| `entities/events.ts` | Minor | Ensure payload supports discriminated union |

## Testing Considerations

1. **Type Safety Tests** - Already exist in `view-types.test.ts`, ensure they pass
2. **Routing Tests** - Verify correct component renders for each view type
3. **Quick Actions Tests** - Verify correct actions appear per mode
4. **Tab Toggle Tests** - Verify two-way toggle works within each mode
5. **Header Tests** - Verify correct header elements per mode

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing thread view | Keep thread view working first, then add plan mode |
| Type migration complexity | Discriminated union already exists, incremental adoption |
| Quick actions side effects | Actions are already modular, just need filtering |

## Success Criteria

- [ ] Opening a plan shows plan-only view (single view, no tabs)
- [ ] Opening a thread shows thread view with conversation/changes tabs (local state)
- [ ] Quick actions are appropriate for the current view mode
- [ ] Thread tab toggle cycles between two tabs (not three)
- [ ] Header displays mode-appropriate content
- [ ] Clicking a thread in inbox opens control panel with thread view
- [ ] Clicking a plan in inbox opens control panel with plan view
- [ ] Client-side switching works without focus flicker when panel already open
- [ ] Keyboard navigation (Shift+Up/Down) highlights items without opening panel
- [ ] Releasing Shift opens the selected item
- [ ] All existing tests pass
- [ ] No TypeScript errors
