# Phase 2d: Update Action Panel

**File:** `src/components/workspace/action-panel.tsx`
**Dependencies:** 00-types

## Changes

### 1. Get Latest Unaddressed Review (with useMemo)

Use `useMemo` to avoid recomputing the filter/sort on every render:

```typescript
// FROM:
const pendingReview = task?.pendingReview ?? null;

// TO:
import { useMemo } from 'react'; // Add to imports if not present

const latestReview = useMemo(() => {
  const reviews = task?.pendingReviews ?? [];
  return reviews
    .filter((r) => !r.isAddressed)
    .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;
}, [task?.pendingReviews]);
```

**Note:** Ensure `useMemo` is imported from React at the top of the file.

### 2. Update Props Interface

```typescript
// FROM:
pendingReview: PendingReview | null;

// TO (rename for clarity):
latestReview: PendingReview | null;
```

### 3. Update handleReviewSubmit

Mark the review as addressed when user responds. **Important:** Remove the old `pendingReview: null` update pattern.

```typescript
// FROM (showing key parts):
const handleReviewSubmit = useCallback(async () => {
  if (!taskId || !pendingReview) {
    logger.warn("[ActionPanel] handleReviewSubmit early return");
    return;
  }

  const message = hasUserFeedback ? inputValue.trim() : pendingReview.defaultResponse;

  // Old pattern - REMOVE THIS:
  await taskService.update(taskId, {
    pendingReview: null  // <-- DELETE this line/pattern
  });

  // ... rest of submission logic
}, [taskId, pendingReview, hasUserFeedback, inputValue]);

// TO:
const handleReviewSubmit = useCallback(async () => {
  if (!taskId || !latestReview) {
    logger.warn("[ActionPanel] handleReviewSubmit early return");
    return;
  }

  const message = hasUserFeedback ? inputValue.trim() : latestReview.defaultResponse;

  // Mark this specific review as addressed (uses reviewId to identify which one)
  logger.info("[ActionPanel] Marking review as addressed", {
    taskId,
    reviewId: latestReview.id
  });
  await taskService.update(taskId, {
    addressPendingReview: latestReview.id
  });

  // ... rest of submission logic (spawn agent, etc.)
}, [taskId, latestReview, hasUserFeedback, inputValue, taskService, logger]);
```

**Key changes:**
- Replace `pendingReview` with `latestReview` in null check and all usages
- Remove the old `pendingReview: null` update pattern entirely
- Use `addressPendingReview: latestReview.id` to mark specific review as addressed
- Update dependency array to include all referenced values (`latestReview` instead of `pendingReview`)

### 4. Update All References

Replace all `pendingReview` references with `latestReview`:
- Line 82: prop passing
- Line 109: function signature
- Lines 134-135: onFeedback/onApprove access
- Lines 144-146: logging
- Lines 153-156: null checks
- Line 163: defaultResponse
- Lines 269, 304, 315: rendering

## Verification Checklist

- [ ] `useMemo` is imported from React
- [ ] `latestReview` is computed with proper memoization and dependency array
- [ ] All `pendingReview` references are renamed to `latestReview`
- [ ] Old `pendingReview: null` update pattern is removed
- [ ] `handleReviewSubmit` uses `addressPendingReview: latestReview.id`
- [ ] `handleReviewSubmit` dependency array is complete and updated
- [ ] TypeScript compiles without errors
