# Stale Metadata Cleanup

## Issue

**Problem:** When a plan is "decomposed" (the markdown file is deleted, typically replaced by a directory with sub-plans), the metadata in `~/.anvil/plans/{id}/` is not being cleaned up. This causes a stale plan to linger in the left panel.

**Current Behavior:**
1. User has `plans/auth.md` → metadata exists at `~/.anvil/plans/{id}/metadata.json`
2. File is deleted (decomposed into `plans/auth/` directory with sub-plans)
3. Metadata remains → plan shows as "stale" (amber dot) in left panel indefinitely

**Root Cause:** The system has stale detection (`markAsStale()` in `service.ts:329-348`) that marks plans when their file can't be read, but there's no automatic cleanup of stale plan metadata. The `delete()` method at `service.ts:274-291` only deletes metadata when explicitly called, but nothing triggers it when a file is deleted externally.

## Solution

When `markAsStale()` is called, automatically delete the plan metadata. Since the file doesn't exist, there's no reason to keep the metadata around.

## Implementation

**File:** `src/entities/plans/service.ts`

Modify `markAsStale()` to call `delete()` instead of just setting the flag:

```typescript
// In service.ts, modify markAsStale method (lines 328-348)
async markAsStale(id: string): Promise<void> {
  const plan = usePlanStore.getState().getPlan(id);
  if (!plan) return;

  logger.debug(`[planService:markAsStale] Plan file not found, deleting metadata: ${id}`);

  // Delete the plan metadata since the file no longer exists
  await this.delete(id);
}
```

**Alternative approach (if we want grace period):** We could keep the stale flag and add a separate cleanup routine that runs periodically, but the simpler approach is to delete immediately since the file is gone.

## Affected Files

- `src/entities/plans/service.ts` - Modify `markAsStale()` to delete instead of flag

## Testing

- [ ] Delete a plan markdown file externally
- [ ] Verify plan disappears from left panel (not stale, completely gone)
- [ ] Create a decomposition scenario: delete `auth.md`, create `auth/readme.md`
- [ ] Verify old `auth.md` metadata is cleaned up, new plan appears correctly

## Complexity

Low
