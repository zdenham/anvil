# Phase 2e: Update Task Service

**File:** `src/entities/tasks/service.ts`
**Dependencies:** 00-types

## Changes

### 1. Update `create` and `createDraft` Methods

**Critical:** Both `create` and `createDraft` must initialize `pendingReviews` as an empty array:

```typescript
// In create() and createDraft():
// FROM:
pendingReview: null,

// TO:
pendingReviews: [],  // Initialize as empty array, NOT null
```

Search for all occurrences of `pendingReview: null` in task creation and replace with `pendingReviews: []`.

### 2. Update refreshTaskBySlug Event Emission

Emit `action-requested` when there are new unaddressed reviews. Use **ID-based comparison** to reliably detect genuinely new reviews (count-based comparison could miss replacements):

```typescript
// FROM:
const hadPendingReview = !!existing?.pendingReview;
const hasPendingReview = !!task.pendingReview;

if (!hadPendingReview && hasPendingReview && task.pendingReview) {
  eventBus.emit("action-requested", {
    taskId: task.id,
    markdown: task.pendingReview.markdown,
    defaultResponse: task.pendingReview.defaultResponse,
  });
}

// TO:
const oldUnaddressed = existing?.pendingReviews?.filter((r) => !r.isAddressed) ?? [];
const newUnaddressed = task.pendingReviews?.filter((r) => !r.isAddressed) ?? [];

// Use ID-based comparison to detect genuinely new reviews
// (count comparison could miss cases where one review is replaced with another)
const oldIds = new Set(oldUnaddressed.map((r) => r.id));
const genuinelyNew = newUnaddressed.filter((r) => !oldIds.has(r.id));

// Emit for the most recent genuinely new review
if (genuinelyNew.length > 0) {
  const latest = genuinelyNew.sort((a, b) => b.requestedAt - a.requestedAt)[0];
  if (latest) {
    eventBus.emit("action-requested", {
      taskId: task.id,
      markdown: latest.markdown,
      defaultResponse: latest.defaultResponse,
    });
  }
}
```

### 3. UpdateTaskInput Operations (Persistence Layer)

The `addPendingReview` and `addressPendingReview` operations defined in `UpdateTaskInput` (see 00-types.md) are handled by the **persistence layer**. This is where the actual array mutation logic lives:

**Location:** `agents/src/lib/persistence.ts` (or equivalent storage adapter)

The persistence layer must implement:

```typescript
// When handling UpdateTaskInput:
if (input.addPendingReview) {
  // Append to existing array (persistence layer generates the id)
  const newReview: PendingReview = {
    ...input.addPendingReview,
    id: crypto.randomUUID(),
  };
  task.pendingReviews = [...(task.pendingReviews ?? []), newReview];
}

if (input.addressPendingReview) {
  // Find review by ID and mark as addressed
  task.pendingReviews = task.pendingReviews.map((r) =>
    r.id === input.addressPendingReview
      ? { ...r, isAddressed: true }
      : r
  );
}
```

**Note:** The task service calls the persistence layer with these operations. The service itself does not directly manipulate the array - it constructs the appropriate `UpdateTaskInput` and delegates to persistence.

### 4. Update Event Types (if needed)

Check `src/entities/events.ts` or similar for `action-requested` event type:
- The event payload (`taskId`, `markdown`, `defaultResponse`) stays the same
- No changes needed to the event type itself

## Verification Checklist

- [ ] `create()` initializes `pendingReviews: []`
- [ ] `createDraft()` initializes `pendingReviews: []`
- [ ] No remaining `pendingReview: null` assignments
- [ ] Detection logic uses ID-based comparison (not count-based)
- [ ] Persistence layer handles `addPendingReview` operation
- [ ] Persistence layer handles `addressPendingReview` operation
