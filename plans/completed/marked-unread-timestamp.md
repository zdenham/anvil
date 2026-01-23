# Plan: Marked Unread Timestamp to Prevent Navigation Cycles

## Problem

When a user marks an item as unread and navigates to the next item, the navigation logic may immediately navigate back to the item that was just marked unread (since it's now unread and potentially the "next" item in the list). This creates a frustrating cycle.

## Solution

Introduce a `markedUnreadAt` timestamp field to both plan and thread entities. When navigating to the next item, skip any items that were marked unread within the last 60 seconds.

## Implementation Steps

### 1. Update Type Definitions

**File: `core/types/plans.ts`**
- Add `markedUnreadAt: z.number().optional()` to `PlanMetadataSchema`
- No changes needed to `UpdatePlanInput` as it already has `isRead?: boolean` and we'll set the timestamp internally

**File: `core/types/threads.ts`**
- Add `markedUnreadAt: z.number().optional()` to `ThreadMetadataBaseSchema`
- No changes needed to `UpdateThreadInput` as we'll set the timestamp internally

### 2. Update Plan Store and Service

**File: `src/entities/plans/store.ts`**
- Update `markPlanAsUnread` action to set `markedUnreadAt: Date.now()` along with `isRead: false`
- Update `markPlanAsRead` action to clear `markedUnreadAt: undefined` (optional, but cleaner)

**File: `src/entities/plans/service.ts`**
- No changes needed - the store already handles the state update and service persists the full plan object

### 3. Update Thread Store

**File: `src/entities/threads/store.ts`**
- Update `markThreadAsUnread` action to set `markedUnreadAt: Date.now()` along with `isRead: false`
- Update `markThreadAsRead` action to clear `markedUnreadAt: undefined` (optional, but cleaner)

### 4. Update Navigation Logic

**File: `src/hooks/use-unified-inbox-navigation.ts`**
- In the `getNextUnreadItem` function (or wherever items are filtered for navigation)
- Add logic to skip items where `markedUnreadAt` exists and `Date.now() - markedUnreadAt < 60000` (60 seconds)

The filtering logic should be:
```typescript
const MARKED_UNREAD_COOLDOWN_MS = 60 * 1000; // 60 seconds

// When filtering unread items for navigation:
const isRecentlyMarkedUnread = (item: UnifiedItem): boolean => {
  const markedUnreadAt = item.data.markedUnreadAt;
  if (!markedUnreadAt) return false;
  return Date.now() - markedUnreadAt < MARKED_UNREAD_COOLDOWN_MS;
};

// Skip items that are recently marked unread
if (isRecentlyMarkedUnread(item)) {
  return false; // Don't include in navigation candidates
}
```

### 5. Cross-Window Broadcasting

**No changes needed** - The existing `PLAN_UPDATED` and `THREAD_UPDATED` events already:
1. Broadcast to all windows via Tauri's event system
2. Trigger listeners that refresh the entity from disk
3. Include the full metadata (including the new timestamp)

The persistence flow already writes the complete metadata object to disk, and other windows refresh from disk when they receive update events.

## Files to Modify

1. `core/types/plans.ts` - Add `markedUnreadAt` field to schema
2. `core/types/threads.ts` - Add `markedUnreadAt` field to schema
3. `src/entities/plans/store.ts` - Set timestamp in `markPlanAsUnread`
4. `src/entities/threads/store.ts` - Set timestamp in `markThreadAsUnread`
5. `src/hooks/use-unified-inbox-navigation.ts` - Add cooldown filter logic

## Testing Considerations

1. Mark an item as unread → Navigate to next → Should NOT navigate back to the just-marked item
2. Wait 60+ seconds → Navigate to next → Should now be able to navigate to that item
3. Mark item as unread in one window → Other windows should receive the update with timestamp
4. Mark item as read → `markedUnreadAt` should be cleared
5. Restart app → `markedUnreadAt` should persist (stored in metadata.json)

## Edge Cases

- Items marked unread before this feature exists will have `markedUnreadAt: undefined` and will work normally (no cooldown)
- If ALL remaining unread items are in cooldown, navigation should show "all caught up" (existing behavior when no valid next item)
