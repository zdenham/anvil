# Skip Running Plans in Next Action Navigation

## Problem Confirmed

The "next action" navigation currently navigates to running plans when it should skip them. This happens because the navigation logic in `src/hooks/use-unified-inbox-navigation.ts` only checks:

- **For threads**: `!item.data.isRead`
- **For plans**: `!item.data.isRead && !item.data.stale`

It does **not** check whether a plan has running threads associated with it. The running status for plans is derived from associated threads (via the relations store), but this check is missing from the navigation logic.

### Current Behavior
When the user triggers "next action" (e.g., after archiving a thread), the system navigates to the next unread item. If an unread plan has a running thread associated with it, the user is navigated to that plan - even though they likely want to skip actively running work.

### Expected Behavior
Running items (threads with `status === "running"` and plans with running threads) should be skipped during "next action" navigation, allowing users to focus on items that need attention.

## Root Cause

The navigation logic in `use-unified-inbox-navigation.ts` (lines 85-90 and 106-111) filters items by:
1. `isRead` status
2. `stale` status (for plans)
3. `markedUnreadAt` cooldown

But it does **not** filter out:
1. Threads with `status === "running"`
2. Plans that have associated running threads

## Solution: Minimal Change in Navigation Hook

Modify `src/hooks/use-unified-inbox-navigation.ts` to add running status checks:

```typescript
// Add imports
import { useRelationStore } from "@/entities/relations/store";

// Add helper function
function hasRunningThread(planId: string, threads: Record<string, ThreadMetadata>): boolean {
  const relations = useRelationStore.getState().getByPlan(planId);
  return relations.some(rel => threads[rel.threadId]?.status === "running");
}

// In getNextUnreadItem, modify the thread check:
if (item.type === "thread" && !item.data.isRead && item.data.status !== "running") {
  return { type: "thread", id: item.data.id };
}

// In getNextUnreadItem, modify the plan check:
if (item.type === "plan" && !item.data.isRead && !item.data.stale) {
  if (!hasRunningThread(item.data.id, threads)) {
    return { type: "plan", id: item.data.id };
  }
}
```

## Implementation Steps

1. **Add thread data access in navigation hook**
   - Get threads from `useThreadStore.getState().getAllThreads()` (already available)
   - Import `useRelationStore`

2. **Add `hasRunningThread` helper function**
   - Query relations for the plan
   - Check if any related thread has `status === "running"`

3. **Update filtering logic in `getNextUnreadItem`**
   - Skip threads where `status === "running"`
   - Skip plans where `hasRunningThread()` returns true

4. **Update filtering logic in `getFirstUnreadItem`**
   - Same changes as above

5. **Test scenarios**
   - Archive thread → next action skips running thread/plan
   - Mark unread → next action skips running thread/plan
   - Wrap-around navigation respects running status
   - No regressions in normal unread navigation

## Files to Modify

- `src/hooks/use-unified-inbox-navigation.ts` - Main navigation logic
- `src/hooks/use-unified-inbox-navigation.test.ts` - Add tests (if exists)

## Edge Cases to Consider

1. **All unread items are running**: Should fall back to inbox panel (existing behavior)
2. **Running thread finishes during navigation**: Accept slight race condition; user can navigate again
3. **Plan with multiple threads, some running**: Skip if ANY thread is running (consistent with inbox display)
