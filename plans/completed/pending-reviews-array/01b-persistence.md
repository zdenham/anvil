# Phase 2b: Update Persistence Layer

**File:** `agents/src/core/persistence.ts`
**Dependencies:** 00-types

## Key Design Decisions

- **ID Generation:** The persistence layer (not CLI or callers) is responsible for generating UUIDs for new reviews. Callers provide `PendingReviewInput` without an `id`, and the persistence layer assigns `id: crypto.randomUUID()`.
- **Legacy Migration:** When migrating old `pendingReview` objects, we use `threadId: 'legacy'` as a sentinel value. This indicates the review was created before thread tracking was implemented. Consumers should handle this by either:
  - Treating `'legacy'` as "unknown thread" in UI displays
  - Skipping thread-based filtering for legacy reviews

## Changes

### 1. Update createTask

Initialize with empty array instead of null:

```typescript
// FROM:
pendingReview: null,

// TO:
pendingReviews: [],
```

### 2. Update updateTask

Handle the new array operations in `updateTask`:

```typescript
async updateTask(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  const task = await this.getTask(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  let pendingReviews = [...(task.pendingReviews ?? [])];

  // Handle addPendingReview operation
  if (updates.addPendingReview) {
    const newReview: PendingReview = {
      ...updates.addPendingReview,
      id: crypto.randomUUID(),
      isAddressed: false,  // Explicitly set to false for new reviews
    };
    pendingReviews.push(newReview);
  }

  // Handle addressPendingReview operation
  if (updates.addressPendingReview) {
    const reviewExists = pendingReviews.some(
      (r) => r.id === updates.addressPendingReview
    );

    if (!reviewExists) {
      // Log warning but don't throw - the review may have been deleted or ID is stale
      console.warn(
        `[persistence] addressPendingReview: review ID not found: ${updates.addressPendingReview}`
      );
    }

    pendingReviews = pendingReviews.map((r) =>
      r.id === updates.addressPendingReview
        ? { ...r, isAddressed: true }
        : r
    );
  }

  // Remove the operation fields from updates spread
  const { addPendingReview, addressPendingReview, ...restUpdates } = updates;

  const updated: TaskMetadata = {
    ...task,
    ...restUpdates,
    pendingReviews,
    updatedAt: Date.now(),
  };

  await this.write(`${TASKS_DIR}/${task.slug}/metadata.json`, updated);
  return updated;
}
```

### 3. Update normalizeTask

Add backwards compatibility for existing tasks:

```typescript
private normalizeTask(task: TaskMetadata): TaskMetadata {
  // Handle migration from pendingReview to pendingReviews
  let pendingReviews = task.pendingReviews ?? [];

  // Backwards compat: if old pendingReview exists, migrate it
  // Note: 'legacy' threadId is a sentinel value indicating this review
  // predates thread tracking. Consumers should handle by:
  // - Treating 'legacy' as "unknown thread" in UI displays
  // - Skipping thread-based filtering for legacy reviews
  const oldReview = (task as any).pendingReview;
  if (oldReview && pendingReviews.length === 0) {
    pendingReviews = [{
      ...oldReview,
      id: crypto.randomUUID(),
      threadId: 'legacy',  // Sentinel value for pre-migration reviews
      isAddressed: false,
    }];
  }

  return {
    ...task,
    tags: task.tags ?? [],
    subtasks: task.subtasks ?? [],
    pendingReviews,
  };
}
```
