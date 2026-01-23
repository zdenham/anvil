# Fix Archive Plan Event Broadcast

## Problem

When archiving a plan, the main view does not refresh. However, the "mark unread" functionality works correctly and triggers a refresh. This suggests the archive event is being emitted but not handled.

## Diagnosis

### Root Cause: Missing Event Listener

The `PLAN_ARCHIVED` event is being emitted correctly, but **there is no listener for it** in `src/entities/plans/listeners.ts`.

### Evidence

**1. Archive function emits the event correctly** (`src/entities/plans/service.ts:481`):
```typescript
// Emit event so relation service can archive associated relations
eventBus.emit(EventName.PLAN_ARCHIVED, { planId });
```

**2. Plan listeners only handle two events** (`src/entities/plans/listeners.ts`):
- `PLAN_DETECTED` (line 13) → triggers `planService.refreshById()`
- `PLAN_UPDATED` (line 25) → triggers `planService.refreshById()`

There is **no listener for `PLAN_ARCHIVED`**.

**3. Mark unread works because it emits `PLAN_UPDATED`** (`src/entities/plans/store.ts:134`):
```typescript
// Emit event for cross-window sync
eventBus.emit(EventName.PLAN_UPDATED, { planId: id });
```

**4. Thread archive works correctly** - for comparison, `src/entities/threads/listeners.ts:82-94` has a proper `THREAD_ARCHIVED` listener that calls `store._applyDelete(threadId)`.

### Current Behavior

1. User archives a plan
2. `planService.archive()` optimistically removes the plan from the local store via `_applyDelete(planId)`
3. The event `PLAN_ARCHIVED` is emitted
4. **No listener processes this event**
5. Other windows never receive the update
6. Main view doesn't refresh because nothing triggers a store update

### Why the Local Window Updates

The local window does update correctly because `archive()` calls `usePlanStore.getState()._applyDelete(planId)` directly (line 448). This removes the plan from the Zustand store, which triggers a re-render.

The issue is **cross-window sync** - other windows don't know about the archive.

## Proposed Fix

Add a `PLAN_ARCHIVED` event listener in `src/entities/plans/listeners.ts`, modeled after the thread implementation:

```typescript
// Plan archived - remove from store (for cross-window sync)
eventBus.on(EventName.PLAN_ARCHIVED, ({ planId }: EventPayloads[typeof EventName.PLAN_ARCHIVED]) => {
  try {
    const store = usePlanStore.getState();
    // Remove from store (disk already updated by archive operation)
    if (store.plans[planId]) {
      store._applyDelete(planId);
      logger.info(`[plans:listener] 📋 Removed archived plan ${planId} from store`);
    }
  } catch (e) {
    logger.error(`[plans:listener] 📋 Failed to handle plan archive ${planId}:`, e);
  }
});
```

### Required Changes

1. **File**: `src/entities/plans/listeners.ts`
   - Add import for `EventPayloads` type
   - Add import for `usePlanStore`
   - Add the `PLAN_ARCHIVED` event listener

### Files to Modify

| File | Change |
|------|--------|
| `src/entities/plans/listeners.ts` | Add `PLAN_ARCHIVED` listener |

### Verification

After the fix:
1. Open the app in two windows
2. Archive a plan in window 1
3. Window 2 should immediately remove the plan from its list without requiring a manual refresh
