# Plan View Bugs Investigation

## Overview

Two bugs were identified in the plan view functionality:
1. **Panel not draggable** when viewing a plan
2. **markRead events not emitted** when opening a plan

---

## Issue 1: Panel Not Draggable When Viewing Plans

### Status: FIXED (but needs refactoring)

The drag handling has been implemented in `plan-view.tsx`, but the logic is **duplicated** between `ControlPanelWindowContent` and `PlanView`. This duplication should be extracted into a reusable hook.

### Current State

Both components now have identical drag handling logic:
- `control-panel-window.tsx:518-558` - `handleWindowDrag` callback
- `plan-view.tsx:124-165` - duplicate `handleWindowDrag` callback

### Refactoring Plan: Extract `useWindowDrag` Hook

Create a new reusable hook at `src/hooks/use-window-drag.ts` that encapsulates all window drag behavior.

#### Hook API Design

```typescript
interface UseWindowDragOptions {
  /** Tauri command to pin the panel (e.g., "pin_control_panel") */
  pinCommand?: string;
  /** Whether double-click should close the panel */
  enableDoubleClickClose?: boolean;
  /** Tauri command to hide the panel (e.g., "hide_control_panel") */
  hideCommand?: string;
}

interface UseWindowDragResult {
  /** Whether the window is currently focused */
  isWindowFocused: boolean;
  /** Whether a drag operation is in progress */
  isDragging: boolean;
  /** Props to spread onto the draggable container element */
  dragProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    className: string;
  };
}

function useWindowDrag(options?: UseWindowDragOptions): UseWindowDragResult;
```

#### Hook Implementation

**File: `src/hooks/use-window-drag.ts`**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "@/lib/logger-client";

interface UseWindowDragOptions {
  pinCommand?: string;
  enableDoubleClickClose?: boolean;
  hideCommand?: string;
}

interface UseWindowDragResult {
  isWindowFocused: boolean;
  isDragging: boolean;
  dragProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    className: string;
  };
}

const INTERACTIVE_SELECTOR = 'button, input, textarea, a, [role="button"], [contenteditable="true"]';

export function useWindowDrag(options: UseWindowDragOptions = {}): UseWindowDragResult {
  const {
    pinCommand = "pin_control_panel",
    enableDoubleClickClose = true,
    hideCommand = "hide_control_panel",
  } = options;

  const [isWindowFocused, setIsWindowFocused] = useState(() => document.hasFocus());
  const [isDragging, setIsDragging] = useState(false);

  // Track window focus state
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Only drag on primary (left) mouse button
    if (e.button !== 0) return;

    // Check if clicking on an interactive element
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) return;

    // When focused, only allow dragging from the header area
    if (isWindowFocused) {
      const isInHeader = target.closest('[data-drag-region="header"]');
      if (!isInHeader) return;
    }

    // Pin the panel
    if (pinCommand) {
      try {
        await invoke(pinCommand);
        logger.debug(`[useWindowDrag] Panel pinned via ${pinCommand}`);
      } catch (err) {
        logger.error(`[useWindowDrag] Failed to pin panel:`, err);
      }
    }

    // Set dragging state to disable text selection
    setIsDragging(true);

    // Start window drag via Tauri API
    getCurrentWindow().startDragging().catch((err) => {
      console.error("[useWindowDrag] startDragging failed:", err);
    });

    // Listen for mouseup to know when drag ended
    const handleMouseUp = () => {
      window.removeEventListener('mouseup', handleMouseUp);
      setIsDragging(false);
    };
    window.addEventListener('mouseup', handleMouseUp);
  }, [isWindowFocused, pinCommand]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(INTERACTIVE_SELECTOR) && hideCommand) {
      invoke(hideCommand);
    }
  }, [hideCommand]);

  return {
    isWindowFocused,
    isDragging,
    dragProps: {
      onMouseDown: handleMouseDown,
      ...(enableDoubleClickClose && { onDoubleClick: handleDoubleClick }),
      className: isDragging ? 'is-dragging' : '',
    },
  };
}
```

#### Usage in Components

**In `control-panel-window.tsx`:**

```typescript
import { useWindowDrag } from "@/hooks/use-window-drag";

function ControlPanelWindowContent({ threadId, prompt }: Props) {
  const { isDragging, dragProps } = useWindowDrag();

  // Remove: useState for isWindowFocused, isDragging
  // Remove: useEffect for focus tracking
  // Remove: handleWindowDrag callback

  return (
    <div
      className={`control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden ${dragProps.className}`}
      onMouseDown={dragProps.onMouseDown}
      onDoubleClick={dragProps.onDoubleClick}
    >
      {/* ... */}
    </div>
  );
}
```

**In `plan-view.tsx`:**

```typescript
import { useWindowDrag } from "@/hooks/use-window-drag";

export function PlanView({ planId }: PlanViewProps) {
  const { isDragging, dragProps } = useWindowDrag();

  // Remove: useState for isWindowFocused, isDragging
  // Remove: useEffect for focus tracking
  // Remove: handleWindowDrag callback

  return (
    <div
      className={`control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden ${dragProps.className}`}
      onMouseDown={dragProps.onMouseDown}
      onDoubleClick={dragProps.onDoubleClick}
    >
      {/* ... */}
    </div>
  );
}
```

#### Implementation Steps

1. **Create the hook file**: `src/hooks/use-window-drag.ts`
2. **Export from hooks index**: Add to `src/hooks/index.ts`
3. **Refactor `control-panel-window.tsx`**:
   - Import `useWindowDrag`
   - Remove duplicate state and effect code (~40 lines)
   - Use `dragProps` on the container
4. **Refactor `plan-view.tsx`**:
   - Import `useWindowDrag`
   - Remove duplicate state and effect code (~40 lines)
   - Use `dragProps` on the container

#### Files to Modify

| File | Action |
|------|--------|
| `src/hooks/use-window-drag.ts` | Create new hook |
| `src/hooks/index.ts` | Export the new hook |
| `src/components/control-panel/control-panel-window.tsx` | Replace duplicate logic with hook |
| `src/components/control-panel/plan-view.tsx` | Replace duplicate logic with hook |

#### Benefits

1. **DRY**: Single source of truth for drag behavior
2. **Reusable**: Any future panel or draggable window can use this hook
3. **Testable**: Hook can be unit tested in isolation
4. **Configurable**: Options allow customization per use case
5. **Maintainable**: Bug fixes or improvements apply everywhere

---

## Issue 2: Plans Don't Emit markRead Events

### Symptoms
When opening a plan, it doesn't get marked as read properly. The read state doesn't propagate across windows.

### Root Cause

Multiple missing pieces in the event emission chain:

#### 1. Plan Store Missing Event Emission

**Location:** `src/entities/plans/store.ts:94-106`

```typescript
markPlanAsRead: (id) => {
  const plan = get().plans[id];
  if (!plan || plan.isRead) return;

  const updated = { ...plan, isRead: true };
  set((state) => {
    const newPlans = { ...state.plans, [id]: updated };
    return {
      plans: newPlans,
      _plansArray: Object.values(newPlans),
    };
  });
  // ⚠️ NO EVENT EMISSION HERE
},
```

**Compare to Thread Store** (`src/entities/threads/store.ts:153-180`) which emits:
```typescript
eventBus.emit(EventName.THREAD_UPDATED, { threadId });
```

#### 2. Plan Service Missing Event Emission

**Location:** `src/entities/plans/service.ts:253-267`

The `planService.markAsRead()` method doesn't emit any events after updating.

#### 3. Missing Plan Listener for PLAN_UPDATED

**Location:** `src/entities/plans/listeners.ts`

The plan listeners only handle `PLAN_DETECTED` but don't listen for `PLAN_UPDATED`.

#### 4. PlanView Already Calls useMarkPlanAsRead ✅

The `useMarkPlanAsRead` hook exists at `src/entities/plans/use-mark-plan-as-read.ts` and **is already used** in `PlanView` at line 49:

```typescript
// Mark plan as read when viewed
useMarkPlanAsRead(planId);
```

This step is complete - the issue is that the underlying event emission is missing.

### How Threads Handle This Correctly

1. **Thread Store emits event** when `markThreadAsRead()` is called
2. **Thread Listener receives it** via `eventBus.on(EventName.THREAD_UPDATED)`
3. **Thread refreshes from disk** to sync state across windows
4. **Event propagates** through the event bridge for multi-window support

### Proposed Fix

#### Step 1: Emit PLAN_UPDATED in the store

In `src/entities/plans/store.ts`, add event emission after marking as read:

```typescript
markPlanAsRead: (id) => {
  const plan = get().plans[id];
  if (!plan || plan.isRead) return;

  const updated = { ...plan, isRead: true };
  set((state) => {
    const newPlans = { ...state.plans, [id]: updated };
    return {
      plans: newPlans,
      _plansArray: Object.values(newPlans),
    };
  });

  // ADD: Emit event for cross-window sync
  eventBus.emit(EventName.PLAN_UPDATED, { planId: id });
},
```

#### Step 2: Add PLAN_UPDATED listener

In `src/entities/plans/listeners.ts`, add a listener:

```typescript
eventBus.on(EventName.PLAN_UPDATED, async ({ planId }) => {
  logger.debug(`[plans:listener] Received PLAN_UPDATED for: ${planId}`);
  try {
    await planService.refreshById(planId);
  } catch (err) {
    logger.error(`[plans:listener] Failed to refresh plan ${planId}:`, err);
  }
});
```

#### Step 3: Use useMarkPlanAsRead in PlanView ✅

**Already implemented** in `src/components/control-panel/plan-view.tsx:49`:

```typescript
// Mark plan as read when viewed
useMarkPlanAsRead(planId);
```

### Files to Modify

1. `src/entities/plans/store.ts` - Add event emission
2. `src/entities/plans/listeners.ts` - Add PLAN_UPDATED listener

---

## Summary

| Issue | Status | Action Required |
|-------|--------|-----------------|
| Panel not draggable | **FIXED** (duplicated) | Extract to `useWindowDrag` hook |
| markRead not emitted | Needs implementation | Add event emission chain |

### Issue 1: Drag Handling
The drag handling is working but the code is duplicated between `control-panel-window.tsx` and `plan-view.tsx`. Extract into a reusable `useWindowDrag` hook at `src/hooks/use-window-drag.ts`.

### Issue 2: markRead Events
Still needs the event emission chain to be implemented in `store.ts`, `listeners.ts`. Note that `plan-view.tsx` already calls `useMarkPlanAsRead(planId)` at line 49.
