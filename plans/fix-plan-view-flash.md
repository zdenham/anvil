# Fix: "No Plan Found" Flash When Opening Plans

## Problem

When opening a plan, users see a brief flash of "Plan not found" or blank content before the actual plan content appears. This creates a jarring visual experience.

## Root Cause Analysis

The flash occurs due to a race condition between store hydration and the `planNotFound` state. Here's the problematic sequence:

```
T0: Component mounts, planId from URL params
T1: usePlanStore.getPlan(planId) returns undefined (plan not yet loaded)
T2: Effect triggers refresh from disk (lines 113-141 in plan-view.tsx)
T3: setRefreshAttempted(true) and setLoading(true)
T4: Async refreshById() starts
T5: Component renders showing "Loading..." (good)
T6: refreshById() completes, plan IS found and added to store
T7: setLoading(false) - this triggers a re-render
T8: BUT! The plan subscription hasn't updated yet
T9: !plan is still true, planNotFound may be true -> shows "Plan not found" briefly
T10: Store subscription updates, plan is now available -> shows content
```

**The key issue:** The `loading` state is set to `false` before the Zustand selector has re-evaluated with the updated store. This creates a brief window where `loading=false`, `plan=undefined`, and `planNotFound=true`.

Additionally, there's a secondary issue in `usePlanContent`:
- Lines 37-39: On `planId` change, it immediately sets `content=null` and `isLoading=true`
- This creates a flash of blank content even when the plan IS found

## Proposed Fix

### Option A: Optimistic Loading State (Recommended)

Instead of relying on the component's local `loading` state, derive loading status from whether we're awaiting store data:

```tsx
// plan-view.tsx

// Replace lines 42-44 with:
const [refreshAttempted, setRefreshAttempted] = useState(false);

// Then update the conditional rendering (lines 267-311):

// Show loading while: refresh in progress OR waiting for store to catch up after refresh
const isLoading = !plan && !refreshAttempted;
const isRefreshing = !plan && refreshAttempted && !planNotFound;

if (isLoading || isRefreshing) {
  // Show loading state
}

if (!plan && planNotFound) {
  // Show "Plan not found" only when refresh completed AND plan truly doesn't exist
}
```

### Option B: Remove Intermediate Loading State

The simplest fix - don't show "Loading..." at all, just show blank until content is ready:

```tsx
// plan-view.tsx lines 267-311

// Remove the loading state render entirely
// Just show blank div until plan is available
if (!plan) {
  return (
    <div className={...}>
      <ControlPanelHeader view={{ type: "plan", planId }} />
      <div className="flex-1" />  {/* Blank content area */}
    </div>
  );
}

// Only show "Plan not found" if refresh was attempted AND failed
// by checking that the plan truly doesn't exist after the refresh completed
```

### Option C: Delay planNotFound Until Store Settles

Add a small delay before setting `planNotFound` to give the store subscription time to update:

```tsx
// plan-view.tsx, inside the refreshPlan function (lines 122-137)

async function refreshPlan() {
  setLoading(true);
  setRefreshAttempted(true);
  try {
    await planService.refreshById(currentPlanId);
    // Wait for next tick to let store subscription update
    await new Promise(resolve => setTimeout(resolve, 0));
    const refreshedPlan = usePlanStore.getState().getPlan(currentPlanId);
    if (!refreshedPlan) {
      setPlanNotFound(true);
    }
  } catch (err) {
    setPlanNotFound(true);
  } finally {
    setLoading(false);
  }
}
```

## Recommended Implementation: Combined Approach

The cleanest fix combines Options A and C:

1. **Don't set `loading=false` until we've verified the store state**
2. **Only show "Plan not found" when we're certain the plan doesn't exist**

```tsx
// plan-view.tsx

// 1. Remove the separate planNotFound state - derive it instead
const [refreshAttempted, setRefreshAttempted] = useState(false);
const [refreshResult, setRefreshResult] = useState<'pending' | 'found' | 'not-found'>('pending');

// 2. Update the refresh effect
useEffect(() => {
  if (!planId) return;
  if (plan) {
    setRefreshResult('found');
    return;
  }
  if (refreshAttempted) return;

  const currentPlanId = planId;

  async function refreshPlan() {
    setRefreshAttempted(true);
    try {
      await planService.refreshById(currentPlanId);
      // Check store directly after refresh
      const refreshedPlan = usePlanStore.getState().getPlan(currentPlanId);
      setRefreshResult(refreshedPlan ? 'found' : 'not-found');
    } catch (err) {
      setRefreshResult('not-found');
    }
  }

  refreshPlan();
}, [planId, plan, refreshAttempted]);

// 3. Simplified render conditions
if (!plan && refreshResult === 'pending') {
  // Loading state - refresh in progress or waiting for store
  return <LoadingView />;
}

if (!plan && refreshResult === 'not-found') {
  // Plan truly not found
  return <NotFoundView />;
}

if (!plan) {
  // Edge case: refresh says found but store hasn't updated yet
  return <LoadingView />;
}

// Plan found, render content
```

## Files to Modify

1. `src/components/control-panel/plan-view.tsx` - Main changes to loading/error state logic

## Testing

1. Open a plan that exists - should show content immediately (no flash)
2. Open a plan that doesn't exist - should show "Plan not found" (no flash of content first)
3. Open a plan from another window - should load correctly via refresh
4. Delete a plan file while viewing - should show stale view appropriately
