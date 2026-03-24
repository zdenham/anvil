# Archive Plan Thread Edges

Clean up plan-thread edge files that are no longer needed, and ensure archiving a plan properly archives its edges.

## Context

**Current behavior**: When a plan is archived, the `PLAN_ARCHIVED` event listener calls `relationService.archiveByPlan(planId)`, which sets `archived: true` on each relation's JSON file. The files stay in `~/.anvil/plan-thread-edges/` and continue to be loaded during every hydration. Same thing happens for `THREAD_ARCHIVED`.

**Problems**:
1. Archived relation files accumulate in the active directory indefinitely
2. Relations where both the plan and thread are archived/missing are never cleaned up
3. Every hydration loads all these dead relations into memory, filtering them out at query time

## Strategy

Two changes:

### 1. Move relation files to archive on plan archive

When `archiveByPlan` (or `archiveByThread`) runs, instead of just setting `archived: true` and leaving the file in place, **move the file** from `plan-thread-edges/` to `archive/plan-thread-edges/`. This keeps the relation data recoverable but removes it from the active directory.

- Update `RelationService.archiveByPlan()` to move the file to `archive/plan-thread-edges/{planId}-{threadId}.json` and delete from the active directory
- Update `RelationService.archiveByThread()` with the same approach
- Remove the relation from the in-memory store (via `_applyDelete`) instead of setting `archived: true`
- The archived copy on disk is only read if someone calls `listArchived()` (which could be added later if needed for history)

### 2. Cleanup orphaned edges on mount

After hydration completes, scan all loaded relations and remove any where **neither the plan nor the thread exists in the active stores**. This catches edges that slipped through (e.g., app crashed during archive, manual file deletion, etc).

- Add a `cleanupOrphaned()` method to `RelationService`
- For each relation in the store, check: does `planStore.getPlan(planId)` exist? Does `threadStore.getThread(threadId)` exist?
- If **both** are missing → delete the file from `plan-thread-edges/` and remove from store
- If **only one** is missing → archive the relation (move to archive dir, remove from store). This covers the case where a thread was archived but the edge wasn't cleaned up, or vice versa.
- Call `cleanupOrphaned()` in `hydrateEntities()` after all core entities (threads, plans, relations) are hydrated

## Files to change

| File | Change |
|------|--------|
| `src/entities/relations/service.ts` | Update `archiveByPlan`/`archiveByThread` to move files + delete from store. Add `cleanupOrphaned()` method. |
| `src/entities/index.ts` | Call `relationService.cleanupOrphaned()` after core entity hydration |

## Phases

- [x] Update `archiveByPlan` and `archiveByThread` to move files to archive dir and remove from store
- [x] Add `cleanupOrphaned()` method that removes relations with no active plan or thread
- [x] Call `cleanupOrphaned()` during hydration in `hydrateEntities()`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Edge cases

- **Race condition on archive**: Plan archive cascades to children → each child emits `PLAN_ARCHIVED` → each triggers `archiveByPlan()`. The `getByPlan()` call filters by `!archived`, so already-archived relations won't be double-processed. With the new approach (file move), we should handle "file already moved" gracefully (no-op).
- **Thread still active**: When archiving a plan, some related threads may still be active. Moving the edge to archive is correct—the thread's `useRelatedPlans` hook will stop showing the archived plan.
- **App crash during archive**: The cleanup-on-mount step catches any partially-completed archives.
