# 08: Cleanup and Testing

**Group:** E (Final)
**Dependencies:** 06, 07 (all write paths updated)
**Blocks:** None

---

## Goal

Remove deprecated code, add integration tests, and document the pattern.

---

## Deprecated Functions to Remove

After confirming no remaining callers:

| File | Function | Replacement |
|------|----------|-------------|
| `agents/src/core/persistence.ts:142` | `updateTaskBySlug` | `updateTask(id)` |
| `agents/src/core/persistence.ts:174` | `deleteTaskBySlug` | `deleteTask(id)` |

### Removal Process

1. Search for all usages: `rg "updateTaskBySlug|deleteTaskBySlug"`
2. Confirm zero results (or migrate remaining callers)
3. Delete the functions
4. Remove from exports if applicable

---

## Integration Tests to Add

### Test: Rename During Execution

```typescript
describe("task rename during thread execution", () => {
  it("should continue writing to correct location after rename", async () => {
    // 1. Create task with slug "draft-abc123"
    // 2. Start thread execution
    // 3. Rename task to "my-feature" mid-execution
    // 4. Verify state.json written to tasks/my-feature/threads/...
    // 5. Verify metadata.json in correct location
  });
});
```

### Test: Resume After Rename

```typescript
describe("thread resume after task rename", () => {
  it("should find thread by ID even if task was renamed", async () => {
    // 1. Create task, start thread, write state
    // 2. Stop thread
    // 3. Rename task
    // 4. Resume thread by ID
    // 5. Verify thread found and continues correctly
  });
});
```

### Test: Concurrent Rename

```typescript
describe("concurrent operations", () => {
  it("should handle rename and write happening simultaneously", async () => {
    // Edge case: write starts, rename happens, write completes
    // Should either succeed at new location or fail gracefully
  });
});
```

---

## Documentation to Add

### Code Comments

Add to `core/services/resolution-service.ts`:

```typescript
/**
 * Resolution Service - Path Resolution with Lazy Fallback
 *
 * ## Problem
 * Task slugs can change (rename), but thread writes need correct paths.
 *
 * ## Solution
 * 1. Always try "hint" path first (O(1))
 * 2. Fall back to directory scan only when hint fails (O(n))
 * 3. Cache successful resolution for subsequent writes
 *
 * ## Usage
 * - Pass expected/cached paths as hints
 * - Don't pre-verify paths (lazy verification)
 * - Use task ID as source of truth, not slug
 */
```

---

## Manual Testing Checklist

- [ ] Create task → run thread → rename task → verify state writes to new location
- [ ] Stop thread → rename task → resume thread → verify finds correct location
- [ ] Delete task while thread running → verify graceful failure
- [ ] Rapid rename (multiple times) → verify eventually writes correctly

---

## Final Verification

- [ ] No remaining `updateTaskBySlug` or `deleteTaskBySlug` calls
- [ ] All integration tests pass
- [ ] Manual tests pass
- [ ] No console errors during normal operation
- [ ] Performance: O(1) path for normal operations (check via logging)
