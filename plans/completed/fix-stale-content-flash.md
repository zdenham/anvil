# Fix Stale Content Flash When Opening Plans/Threads

## Problem

When opening a plan or thread, there's a brief flash of the previously opened item's content before the new content renders. This creates a jarring UX where users see the wrong content for ~50-200ms.

## Root Cause

The issue stems from **Zustand selector closure problems** combined with async content loading. The thread view was previously fixed (see `plans/completed/thread-display-stale-bug.md`), but the **same fixes were never applied to the plan view**.

### Why the Flash Happens

1. User switches from Plan A to Plan B
2. The Zustand selector `(s) => s.getPlan(planId)` captures `planId` in a closure
3. Zustand doesn't know `planId` changed externally - it only tracks store changes
4. The old Plan A object briefly stays in state (~50-200ms)
5. Header shows Plan A name while content area shows "Loading..."
6. Eventually the selector updates, Plan B loads, flash disappears

## Affected Files

| File | Line | Issue | Severity |
|------|------|-------|----------|
| `src/components/control-panel/plan-view.tsx` | 31 | Selector missing `useCallback` wrapper | HIGH |
| `src/components/control-panel/plan-view.tsx` | 218 | No `key` prop on content container | MEDIUM |
| `src/components/control-panel/control-panel-header.tsx` | 68 | Selector missing `useCallback` wrapper | MEDIUM |

## Recommended Fixes

### Fix 1: Wrap Plan Store Selector in useCallback (Primary)

**File:** `src/components/control-panel/plan-view.tsx`

```typescript
// Before (line 31):
const plan = usePlanStore((s) => s.getPlan(planId));

// After:
const plan = usePlanStore(
  useCallback((s) => s.getPlan(planId), [planId])
);
```

This ensures Zustand creates a new subscription when `planId` changes, immediately returning the correct plan.

### Fix 2: Add Key to Content Container

**File:** `src/components/control-panel/plan-view.tsx`

```typescript
// Before (line 218):
<div className="flex-1 min-h-0 overflow-y-auto p-4">

// After:
<div key={planId} className="flex-1 min-h-0 overflow-y-auto p-4">
```

This forces React to unmount/remount the content area when switching plans, preventing any lingering DOM state.

### Fix 3: Fix Header Plan Selector

**File:** `src/components/control-panel/control-panel-header.tsx`

```typescript
// Before (line 68):
const plan = usePlanStore((s) => s.getPlan(planId));

// After:
const plan = usePlanStore(
  useCallback((s) => s.getPlan(planId), [planId])
);
```

This prevents the header from briefly showing the old plan's name.

## Why These Fixes Work

The thread view was already fixed using this exact pattern:

```typescript
// ThreadView in control-panel-window.tsx (lines 85-86)
const activeState = useThreadStore(
  useCallback((s) => s.threadStates[threadId], [threadId])
);
```

The `useCallback` wrapper with `[planId]` or `[threadId]` dependency ensures:
1. When the ID prop changes, the selector function identity changes
2. Zustand sees a "new" selector and re-subscribes
3. The selector immediately returns the correct data for the new ID

## Implementation Checklist

- [ ] Add `useCallback` import to `plan-view.tsx` if not present
- [ ] Wrap plan selector in `useCallback` with `[planId]` dependency
- [ ] Add `key={planId}` to content container div
- [ ] Add `useCallback` import to `control-panel-header.tsx` if not present
- [ ] Wrap header plan selector in `useCallback` with `[planId]` dependency
- [ ] Test switching between multiple plans rapidly
- [ ] Verify no flash of old content

## Optional Enhancement: Loading Skeleton

To further improve UX during the brief loading period, consider showing a skeleton instead of "Loading plan content...":

```tsx
{isContentLoading ? (
  <div className="animate-pulse space-y-3 p-4">
    <div className="h-6 bg-surface-700 rounded w-3/4" />
    <div className="h-4 bg-surface-700 rounded w-full" />
    <div className="h-4 bg-surface-700 rounded w-5/6" />
  </div>
) : // ... rest of content
}
```

This eliminates the visual "jump" when content loads.

## Testing

1. Open Plan A, wait for content to load
2. Click to open Plan B
3. Verify: No flash of Plan A content, header updates immediately
4. Repeat switching rapidly between 3+ plans
5. Verify: All transitions are clean with no stale content
