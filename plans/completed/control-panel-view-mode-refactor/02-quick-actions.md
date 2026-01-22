# Sub-Plan 02: Quick Actions by View Mode

**Parallelizable with:** 01-control-panel-window.md, 03-inbox-wiring.md
**Depends on:** 00-type-fixes.md

## Goal

Make quick actions context-aware - show different actions for Plan view vs Thread view.

## Files Owned by This Sub-Plan

- `src/stores/quick-actions-store.ts`
- `src/components/control-panel/suggested-actions-panel.tsx`

## Implementation Steps

### Step 1: Define Action Lists in quick-actions-store.ts

**File:** `src/stores/quick-actions-store.ts`

Add view-specific action lists:

```typescript
import type { ControlPanelViewType } from "@/entities/events";

// Plan view actions
export const planDefaultActions: QuickAction[] = [
  {
    id: "createThread",
    label: "Create Thread",
    shortcut: "⌘N",
    action: () => { /* TODO: implement */ },
  },
  {
    id: "editPlan",
    label: "Edit Plan",
    shortcut: "⌘E",
    action: () => { /* TODO: implement */ },
  },
  {
    id: "deletePlan",
    label: "Delete Plan",
    shortcut: "⌘⌫",
    action: () => { /* TODO: implement */ },
  },
];

// Thread view default actions
export const threadDefaultActions: QuickAction[] = [
  {
    id: "archive",
    label: "Archive",
    shortcut: "A",
    action: () => { /* existing implementation */ },
  },
  {
    id: "markUnread",
    label: "Mark Unread",
    shortcut: "U",
    action: () => { /* existing implementation */ },
  },
  {
    id: "toggleView",
    label: "Toggle View",
    shortcut: "Tab",
    action: () => { /* existing implementation */ },
  },
];

// Thread view streaming actions
export const threadStreamingActions: QuickAction[] = [
  {
    id: "cancel",
    label: "Cancel",
    shortcut: "Esc",
    action: () => { /* existing implementation */ },
  },
  {
    id: "pause",
    label: "Pause",
    shortcut: "Space",
    action: () => { /* existing implementation */ },
  },
];

// Helper to get actions for a view
export function getActionsForView(
  view: ControlPanelViewType | null,
  isStreaming: boolean = false
): QuickAction[] {
  if (!view) return [];

  if (view.type === "plan") {
    return planDefaultActions;
  }

  return isStreaming ? threadStreamingActions : threadDefaultActions;
}
```

### Step 2: Update suggested-actions-panel.tsx

**File:** `src/components/control-panel/suggested-actions-panel.tsx`

1. Accept `view` prop with discriminated union type
2. Use `getActionsForView()` to get appropriate actions
3. Remove hardcoded action lists

```typescript
import { getActionsForView } from "@/stores/quick-actions-store";
import type { ControlPanelViewType } from "@/entities/events";

interface SuggestedActionsPanelProps {
  view: ControlPanelViewType | null;
  isStreaming?: boolean;
}

export function SuggestedActionsPanel({ view, isStreaming = false }: SuggestedActionsPanelProps) {
  const actions = useMemo(
    () => getActionsForView(view, isStreaming),
    [view, isStreaming]
  );

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="suggested-actions">
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}
```

### Step 3: Wire Up Action Handlers

Ensure each action has a working handler:

**Plan actions:**
- `createThread` - Opens thread creation dialog/input with plan context
- `editPlan` - Navigates to plan edit mode (or opens editor)
- `deletePlan` - Shows confirmation dialog, then deletes

**Thread actions (existing):**
- Verify existing handlers still work
- No changes needed unless they reference old tab structure

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Run quick actions tests
pnpm test src/stores/quick-actions

# Manual verification:
# 1. Open a plan - should see Create Thread, Edit, Delete actions
# 2. Open a thread - should see Archive, Mark Unread, Toggle View actions
# 3. Start streaming in thread - should see Cancel, Pause actions
```

## Success Criteria

- [ ] Plan view shows plan-specific actions
- [ ] Thread view shows thread-specific actions
- [ ] Streaming state shows streaming actions
- [ ] Action handlers work correctly
- [ ] No TypeScript errors
- [ ] Existing tests pass
