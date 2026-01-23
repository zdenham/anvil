# Plan Detection Bug Diagnosis

## Summary

**Root Cause**: When a new plan is created, `refreshById()` calls `_applyUpdate()`, but `_applyUpdate()` silently returns early if the plan doesn't already exist in the store. This means new plans are never added to the store via the event-driven flow.

## Log Analysis

Looking at the logs, the flow is:

1. **18:31:59.535** - Agent emits `plan:detected` event for plan `76fa9c53-3073-42f3-8345-e7e90a077eb9`
2. **18:31:59.539** - Spotlight window receives and emits to event bridge
3. **18:31:59.546** - Spotlight's plan listener refreshes successfully
4. **18:31:59.548** - Control-panel receives and refreshes successfully
5. **18:31:59.552** - Inbox-list receives and refreshes successfully
6. **18:31:59.835** - Main window receives the event (300ms delay!)
7. **18:32:00.016** - Main window reports "Plan refreshed successfully"

The logs show all windows receive the event and report "Plan refreshed successfully". However, **the plan is not being added to the store** in most windows because of a fundamental bug.

## The Bug: `_applyUpdate()` Doesn't Create New Plans

In `src/entities/plans/store.ts:158-160`:

```typescript
_applyUpdate: (id: string, updates: Partial<PlanMetadata>): Rollback => {
  const previous = get().plans[id];
  if (!previous) return () => {};  // <-- SILENTLY RETURNS IF PLAN DOESN'T EXIST
  // ... rest of update logic never runs
}
```

In `src/entities/plans/service.ts:372-390`, `refreshById()` does:

```typescript
async refreshById(planId: string): Promise<void> {
  // ... read metadata from disk ...
  if (result?.success) {
    usePlanStore.getState()._applyUpdate(planId, result.data);  // <-- Uses _applyUpdate
  }
}
```

**The problem**: `refreshById()` uses `_applyUpdate()` which only updates existing plans. For a newly detected plan, the store doesn't have it yet, so `_applyUpdate()` returns early and the plan is never added.

## Why Spotlight Window Works (Sometimes)

The spotlight window is special - it runs the agent and directly calls `planService.create()` or `ensurePlanExists()` which uses `_applyCreate()`. So the spotlight window's store gets the plan via the agent code path, not the event listener.

Other windows only get plans via:
1. **Hydration at startup** (`planService.hydrate()`) - reads all existing plans from disk
2. **Event listeners** calling `refreshById()` - **BUT THIS IS BROKEN FOR NEW PLANS**

## Why Main Window Is Slower

The main window shows a 300ms delay (18:31:59.535 → 18:31:59.835). This is likely due to:
- The main window being a heavier/larger React application
- More event listeners and state subscriptions
- Possible IPC overhead being higher for the main window

This delay is a separate concern but not the root cause of the bug.

## The Fix

`refreshById()` should use `_applyCreate()` when the plan doesn't exist, not just `_applyUpdate()`. Here's the fix for `src/entities/plans/service.ts:372-390`:

```typescript
async refreshById(planId: string): Promise<void> {
  const metadataPath = `${PLANS_DIRECTORY}/${planId}/metadata.json`;
  const exists = await persistence.exists(metadataPath);

  if (!exists) {
    // Plan was deleted - remove from store
    const existing = usePlanStore.getState().getPlan(planId);
    if (existing) {
      usePlanStore.getState()._applyDelete(planId);
    }
    return;
  }

  const raw = await persistence.readJson(metadataPath);
  const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
  if (result?.success) {
    const existingPlan = usePlanStore.getState().getPlan(planId);
    if (existingPlan) {
      // Plan exists - update it
      usePlanStore.getState()._applyUpdate(planId, result.data);
    } else {
      // Plan doesn't exist - create it
      usePlanStore.getState()._applyCreate(result.data);
    }
  }
}
```

## Alternative: Fix `_applyUpdate()` to Create-or-Update

Another approach is to make `_applyUpdate()` handle the create case:

```typescript
_applyUpdate: (id: string, updates: Partial<PlanMetadata>): Rollback => {
  const previous = get().plans[id];

  // If plan doesn't exist and updates contains a full plan, create it
  if (!previous) {
    if ('id' in updates && 'repoId' in updates && 'relativePath' in updates) {
      // Treat as create
      return get()._applyCreate(updates as PlanMetadata);
    }
    return () => {};
  }
  // ... rest of existing update logic
}
```

## Verification

After applying the fix, all windows should show the new plan immediately after `plan:detected` is received, without requiring an app restart or manual refresh.

## Additional Observations

1. **Duplicate log lines**: Every log line appears twice, suggesting either:
   - Double event emission
   - Double listener registration
   - React strict mode causing double renders

2. **Thread listener race**: Multiple windows (`spotlight`, `control-panel`, `inbox-list`, `main`) all listen for `agent:completed` and try to mark the thread as unread, causing duplicate writes to `metadata.json`. This is wasteful but not functionally broken.

3. **Event schema validation failure**: At 18:32:02.083, there's a validation error for `thread:status:changed` (expected `thread:status-changed` with hyphen). This is a separate bug where the agent emits the wrong event name format.
