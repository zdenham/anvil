# Sub-Plan 02: Frontend Inbox View

## Overview

Add the "inbox" view type to the control panel so that when navigation mode activates, the panel can display the unified inbox for item selection.

## Parallel Execution

This plan can execute **in parallel** with `01-rust-navigation.md`. No shared dependencies.

## Files to Modify

| File | Action |
|------|--------|
| `src/entities/events.ts` | Modify (add inbox view type) |
| `src/components/control-panel/control-panel-window.tsx` | Modify (handle inbox view) |
| `src/components/control-panel/use-control-panel-params.ts` | Modify (parse inbox params) |

## Implementation Steps

### Step 1: Add Inbox View Type to events.ts

**File: `src/entities/events.ts`**

Update the `ControlPanelViewType` type (~line 37):

```typescript
export type ControlPanelViewType =
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "inbox" };  // ADD THIS
```

### Step 2: Create InboxView Component

**File: `src/components/control-panel/control-panel-window.tsx`**

Add imports at the top:
```typescript
import { UnifiedInbox } from "../inbox/unified-inbox";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useThreadLastMessages } from "@/hooks/use-thread-last-messages";
import { switchToThread, switchToPlan } from "@/entities/events";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
```

Add the InboxView component (can be in the same file):
```typescript
function InboxView() {
  const threads = useThreadStore((s) => s.getAllThreads());
  const plans = usePlanStore((s) => Object.values(s.plans));
  const threadLastMessages = useThreadLastMessages(threads);

  const handleThreadSelect = (thread: ThreadMetadata) => {
    switchToThread(thread.id);
  };

  const handlePlanSelect = (plan: PlanMetadata) => {
    switchToPlan(plan.id);
  };

  return (
    <div className="flex flex-col h-screen bg-surface-900">
      <div className="flex-1 overflow-auto">
        <UnifiedInbox
          threads={threads}
          plans={plans}
          threadLastMessages={threadLastMessages}
          onThreadSelect={handleThreadSelect}
          onPlanSelect={handlePlanSelect}
        />
      </div>
    </div>
  );
}
```

### Step 3: Handle Inbox View in Render

**File: `src/components/control-panel/control-panel-window.tsx`**

In the main component's render logic, add handling for inbox view after the plan view check:

```typescript
if (view.type === "inbox") {
  return <InboxView />;
}
```

### Step 4: Update URL Params Parsing

**File: `src/components/control-panel/use-control-panel-params.ts`**

Update the hook to handle `view=inbox` in the URL:

```typescript
// Add inbox view parsing
if (view === "inbox") {
  return { type: "inbox" };
}
```

The URL format will be: `control-panel.html?view=inbox`

## Verification

1. Run TypeScript check: `pnpm tsc --noEmit`
2. Run tests: `pnpm test src/components/control-panel`
3. Verify imports resolve correctly

## Success Criteria

- [ ] `ControlPanelViewType` includes `{ type: "inbox" }`
- [ ] `InboxView` component renders the `UnifiedInbox`
- [ ] control-panel-window.tsx routes to InboxView when view.type === "inbox"
- [ ] use-control-panel-params.ts parses `?view=inbox` correctly
- [ ] TypeScript compiles without errors
- [ ] Existing control panel tests still pass
