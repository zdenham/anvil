# Quick Action Next Item Navigation Plan

## Overview

Restore the "navigate to next unread item" functionality that existed two days ago, but updated for the new thread/plan model. When a user performs a quick action (archive, mark unread), the system should automatically navigate to the next unread item in the queue, or fall back to showing the inbox panel if all items are read.

## Historical Context

### What Existed Before (Jan 20, 2025 - commit `4c3d03a`)

The previous implementation had:

1. **`src/hooks/use-navigate-to-next-task.ts`** - A hook that provided `navigateToNextTaskOrFallback()` which:
   - Called `getNextUnreadTaskId()` to find the next unread task
   - Used client-side switching via `switchSimpleTaskClientSide()` when panel was already visible
   - Fell back to `showTasksPanel()` if no unread items remained
   - Showed a navigation banner with completion messages ("Task archived", "Next unread focused")

2. **`src/hooks/use-simple-task-navigation.ts`** - Core navigation logic:
   - `getNextUnreadTaskId()` - Found next unread task after current position
   - `isTaskUnread()` - Checked if task had unread threads
   - `hasUnreadPlan()` - Checked if task had unread plan
   - Prioritized unread threads over unread plans
   - Returned `openPlanTab: boolean` to indicate if plan view should be opened

3. **`src/lib/hotkey-service.ts`** - Provided `switchSimpleTaskClientSide()` for:
   - Avoiding IPC round-trips when navigating between tasks
   - Preventing focus flickering during navigation
   - Emitting `open-simple-task` event via eventBus

### What Changed (The Current State)

The codebase was refactored to:
- Remove the task-centric model in favor of threads + plans
- Replace `simple-task` panel with `control-panel`
- Remove the `use-navigate-to-next-task.ts` and `use-simple-task-navigation.ts` hooks
- Leave a TODO comment at `control-panel-window.tsx:395-397`:
  ```typescript
  if (action === "nextItem") {
    // TODO: Implement thread navigation
    await invoke("hide_control_panel");
  }
  ```

## Current Architecture

### Data Model

**Threads** (`src/entities/threads/store.ts`):
- `isRead: boolean` - Read/unread status
- `getUnreadThreads()` - Returns all unread threads
- Sorted by `updatedAt` in the inbox list

**Plans** (`src/entities/plans/store.ts`):
- `isRead: boolean` - Read/unread status
- `stale: boolean` - Whether file was found on last access
- `getUnreadPlans()` - Returns unread, non-stale plans

**Unified Inbox** (`src/components/inbox/utils.ts`):
- `createUnifiedList()` - Combines threads and plans sorted by `updatedAt` (most recent first)
- Returns `InboxItem[]` with type discrimination (`thread` | `plan`)

### Current Quick Action Handling

**Thread View** (`control-panel-window.tsx:390-412`):
```typescript
const handleQuickAction = useCallback(async (action: ActionType) => {
  if (action === "nextItem") {
    // TODO: Implement thread navigation
    await invoke("hide_control_panel");
  } else if (action === "markUnread" || action === "archive") {
    await handleSuggestedAction(action);  // Archives/marks unread, then hides panel
  }
  // ...
}, []);
```

**Plan View** (`plan-view.tsx:154-176`):
```typescript
const handleQuickAction = useCallback(async (action: ActionType) => {
  if (action === "archive") {
    await planService.archive(planId);
    await invoke("hide_control_panel");
  } else if (action === "markUnread") {
    await planService.markAsUnread(planId);
    await invoke("hide_control_panel");
  }
  // ...
}, []);
```

## Proposed Solution

### 1. Create `useUnifiedInboxNavigation` Hook

**File:** `src/hooks/use-unified-inbox-navigation.ts`

This hook will provide navigation logic for the unified thread+plan inbox:

```typescript
interface NavigationResult {
  type: "thread" | "plan";
  id: string;  // threadId or planId
}

interface UseUnifiedInboxNavigationReturn {
  /**
   * Get the next unread item in the queue after the current position.
   * Items are ordered by updatedAt descending (most recent first).
   *
   * @param currentItem - Current item being viewed
   * @returns Next unread item or null if none available
   */
  getNextUnreadItem: (currentItem: { type: "thread" | "plan"; id: string }) => NavigationResult | null;

  /**
   * Get the first unread item in the queue (for initial navigation).
   */
  getFirstUnreadItem: () => NavigationResult | null;
}
```

Implementation:
- Use `useThreadStore` and `usePlanStore` to access unread items
- Create unified list using `createUnifiedList()` helper
- Find current item's position and return next unread item after it
- Return `null` if no unread items remain

### 2. Create `useNavigateToNextItem` Hook

**File:** `src/hooks/use-navigate-to-next-item.ts`

This hook wraps navigation logic with panel management:

```typescript
interface UseNavigateToNextItemReturn {
  /**
   * Navigate to next unread item or fall back to inbox panel.
   *
   * @param currentItem - Current item being viewed
   * @param options.fallbackToInbox - Whether to show inbox if no next item (default: true)
   * @param options.actionType - Action that triggered navigation (for banner message)
   * @returns true if navigated to next item, false if fell back to inbox
   */
  navigateToNextItemOrFallback: (
    currentItem: { type: "thread" | "plan"; id: string },
    options?: {
      fallbackToInbox?: boolean;
      actionType?: "archive" | "markUnread" | "nextItem";
    }
  ) => Promise<boolean>;
}
```

Implementation:
- Use `getNextUnreadItem()` from `useUnifiedInboxNavigation`
- If next item found:
  - Check if control panel is visible via `isPanelVisible("control-panel")`
  - Use client-side switch via `switchControlPanelClientSide()` if visible
  - Otherwise use `showControlPanelWithView()` for IPC navigation
  - Show success banner via `useNavigationBannerStore`
- If no next item:
  - Show inbox panel via `invoke("show_inbox_list_panel")`
  - Show "All caught up" banner

### 3. Update Quick Action Handlers

#### Thread View (`control-panel-window.tsx`)

Update `handleQuickAction` to use the new navigation hook:

```typescript
const { navigateToNextItemOrFallback } = useNavigateToNextItem();

const handleQuickAction = useCallback(async (action: ActionType) => {
  const currentItem = { type: "thread" as const, id: threadId };

  if (action === "nextItem") {
    await navigateToNextItemOrFallback(currentItem, { actionType: "nextItem" });
  } else if (action === "archive") {
    await threadService.archive(threadId);
    await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
  } else if (action === "markUnread") {
    await useThreadStore.getState().markThreadAsUnread(threadId);
    await navigateToNextItemOrFallback(currentItem, { actionType: "markUnread" });
  }
  // ...
}, [threadId, navigateToNextItemOrFallback]);
```

#### Plan View (`plan-view.tsx`)

Update `handleQuickAction` similarly:

```typescript
const { navigateToNextItemOrFallback } = useNavigateToNextItem();

const handleQuickAction = useCallback(async (action: ActionType) => {
  const currentItem = { type: "plan" as const, id: planId };

  if (action === "archive") {
    await planService.archive(planId);
    await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
  } else if (action === "markUnread") {
    await planService.markAsUnread(planId);
    await navigateToNextItemOrFallback(currentItem, { actionType: "markUnread" });
  }
  // ...
}, [planId, navigateToNextItemOrFallback]);
```

### 4. Update `handleSuggestedAction` (Thread View)

The existing `handleSuggestedAction` should be removed or simplified - the new `handleQuickAction` will handle both the action and navigation.

## Implementation Steps

### Phase 1: Create Navigation Infrastructure

1. **Create `src/hooks/use-unified-inbox-navigation.ts`**
   - Implement `getNextUnreadItem()` using thread/plan stores
   - Implement `getFirstUnreadItem()` for initial navigation
   - Use `createUnifiedList()` for consistent ordering with inbox display
   - Add unit tests

2. **Create `src/hooks/use-navigate-to-next-item.ts`**
   - Implement `navigateToNextItemOrFallback()`
   - Integrate with `useNavigationBannerStore` for completion messages
   - Handle both client-side and IPC navigation paths
   - Add unit tests

### Phase 2: Update Thread View

1. **Update `control-panel-window.tsx`**
   - Import and use `useNavigateToNextItem`
   - Update `handleQuickAction` for `nextItem`, `archive`, `markUnread`
   - Remove or simplify `handleSuggestedAction`
   - Update the `onAction` prop passed to `SuggestedActionsPanel`

2. **Test thread quick actions**
   - Archive navigates to next unread
   - Mark unread navigates to next unread
   - Next item (streaming) navigates to next unread
   - Fallback to inbox when no unread items

### Phase 3: Update Plan View

1. **Update `plan-view.tsx`**
   - Import and use `useNavigateToNextItem`
   - Update `handleQuickAction` for `archive`, `markUnread`
   - Remove duplicate hide panel logic

2. **Test plan quick actions**
   - Archive navigates to next unread
   - Mark unread navigates to next unread
   - Fallback to inbox when no unread items

### Phase 4: Navigation Banner Integration

1. **Verify banner store exists** (`src/stores/navigation-banner-store.ts`)
   - Confirm `showBanner(message, submessage)` API

2. **Add banner messages**
   - "Thread archived" / "Plan archived" + "Next unread focused"
   - "Marked unread" + "Next unread focused"
   - "[Action]" + "All caught up" (when falling back to inbox)

### Phase 5: Testing & Polish

1. **Integration testing**
   - Quick action from thread -> next thread
   - Quick action from thread -> next plan
   - Quick action from plan -> next thread
   - Quick action from plan -> next plan
   - All read -> falls back to inbox

2. **Edge cases**
   - Only one item in inbox
   - Current item is last in queue
   - Rapid successive quick actions
   - Quick action during agent streaming

## API Reference

### New Files

```
src/hooks/use-unified-inbox-navigation.ts   - Core navigation logic
src/hooks/use-navigate-to-next-item.ts      - Navigation with panel management
```

### Modified Files

```
src/components/control-panel/control-panel-window.tsx  - Thread view quick actions
src/components/control-panel/plan-view.tsx             - Plan view quick actions
```

### Dependencies

```
src/components/inbox/utils.ts                 - createUnifiedList()
src/entities/threads/store.ts                 - getUnreadThreads()
src/entities/plans/store.ts                   - getUnreadPlans()
src/lib/hotkey-service.ts                     - switchToThread(), switchToPlan()
src/stores/navigation-banner-store.ts         - showBanner()
```

## Success Criteria

1. **Functional**
   - Quick actions (archive, mark unread) navigate to next unread item
   - Navigation respects inbox ordering (most recent first)
   - Falls back to inbox panel when no unread items remain
   - Banner shows completion message

2. **UX**
   - Smooth transition between items (no flicker)
   - Client-side switch when panel already visible
   - Consistent behavior across thread and plan views

3. **Technical**
   - No circular dependencies
   - Hooks are testable in isolation
   - Reuses existing store infrastructure
