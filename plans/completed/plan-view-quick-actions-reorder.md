# Plan View Quick Actions Reorder

## Overview

Reorder the quick actions in the plan view to match user expectations:
1. Archive plan
2. Mark unread
3. Type to do something else

Currently, plan view has: Create Thread, Edit Plan, Delete Plan

## Current State

**File**: `src/stores/quick-actions-store.ts` (lines 41-45)

```typescript
export const planDefaultActions: Array<ActionConfig> = [
  { key: "createThread", label: "Create Thread", description: "start a new thread for this plan", shortcut: "⌘N" },
  { key: "editPlan", label: "Edit Plan", description: "modify plan content", shortcut: "⌘E" },
  { key: "deletePlan", label: "Delete Plan", description: "remove this plan", shortcut: "⌘⌫" },
];
```

**Plan View Handler**: `src/components/control-panel/plan-view.tsx` (lines 108-130)
- Has placeholder TODOs for createThread, editPlan, deletePlan
- No implementation for archive or markUnread for plans

## Implementation Steps

### Step 1: Update Quick Actions Configuration

**File**: `src/stores/quick-actions-store.ts`

Change `planDefaultActions` to:

```typescript
export const planDefaultActions: Array<ActionConfig> = [
  { key: "archive", label: "Archive", description: "complete and file away" },
  { key: "markUnread", label: "Mark unread", description: "return to inbox for later" },
  { key: "respond", label: "Type something to respond" },
];
```

This matches the thread view's `threadDefaultActions` pattern exactly.

### Step 2: Implement Archive Action for Plans

**File**: `src/components/control-panel/plan-view.tsx`

Update `handleQuickAction` to handle archive:

```typescript
const handleQuickAction = useCallback(async (action: ActionType) => {
  if (isProcessing) return;

  setProcessing(action);
  try {
    if (action === "archive") {
      await planService.archive(planId);
      await invoke("hide_control_panel");
    } else if (action === "markUnread") {
      await planService.markAsUnread(planId);
      await invoke("hide_control_panel");
    } else if (action === "respond") {
      // Focus input - handled separately
    } else if (action === "closePanel") {
      await invoke("hide_control_panel");
    }
  } catch (error) {
    logger.error(`[PlanView] Failed to handle quick action ${action}:`, error);
  } finally {
    setProcessing(null);
  }
}, [planId, isProcessing, setProcessing]);
```

### Step 3: Add Plan Archive Service Method

**File**: `src/entities/plans/service.ts`

Add archive method if not present:

```typescript
async archive(planId: string): Promise<void> {
  // Move plan to archived state or directory
  // Implementation depends on how plans are stored
}

async markAsUnread(planId: string): Promise<void> {
  await this.updatePlan(planId, { isRead: false });
}
```

### Step 4: Update Legacy Action Handler

**File**: `src/components/control-panel/plan-view.tsx`

The `handleLegacyAction` is currently a no-op. Route it properly:

```typescript
const handleLegacyAction = useCallback(async (action: "markUnread" | "archive") => {
  await handleQuickAction(action);
}, [handleQuickAction]);
```

### Step 5: Add Keyboard Handler for "respond" Action

The plan view's keyboard handler needs to focus the input when "respond" is selected. Currently there's no input in plan view - this connects to the second plan (adding the input).

For now, the keyboard handler should:
- When user presses Enter on "respond", do nothing (until input is added)
- When user types any character, do nothing (until input is added)

## Testing

1. Open a plan in the control panel
2. Verify quick actions show: Archive, Mark unread, Type something to respond
3. Test Archive action - plan should be archived and panel closed
4. Test Mark unread - plan should be marked unread and panel closed
5. Verify keyboard navigation (arrow up/down) works correctly
6. Verify Enter triggers the selected action

## Notes

- The "respond" action will be fully functional after the second plan (adding input to plan view) is implemented
- Archive behavior for plans may need clarification (delete? move to archive folder? mark as completed?)
