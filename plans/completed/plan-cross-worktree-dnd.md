# Plan: Sidebar Plan Movement & Cross-Worktree DnD

Two features for plan drag-and-drop in the sidebar tree:

1. **Intra-worktree plan moves** — Moving a plan in the sidebar reflects on disk (file rename in `plans/` directory)
2. **Cross-worktree plan DnD** — Plans (and only plans) can be dragged between worktrees, deleting from source and creating in destination

## Current State

- DnD updates `visualSettings.parentId` + `sortKey` only (`tree-dnd-drop-executor.ts`)
- `canCrossWorktreeBoundary()` in `dnd-validation.ts` returns `false` for all types, with a comment: "Future: return type === 'plan' to allow plans to cross worktree boundaries"
- Plan metadata tracks: `repoId`, `worktreeId`, `relativePath` (e.g., `plans/auth/login.md`)
- Plan files live at `{worktreePath}/{relativePath}` — resolved by `resolvePlanPath()` in `src/entities/plans/utils.ts`
- `planService` has `create()`, `delete()`, `update()`, and `ensurePlanExists()` — all handle metadata in `~/.anvil/plans/{id}/metadata.json`
- `FilesystemClient.move()` exists for file operations
- `detectParentPlan()` derives domain parent from file path structure ([readme.md](http://readme.md) convention)
- No `git_mv` Tauri command exists currently; `git_rm` does exist

## Design

### Feature 1: Intra-Worktree Plan File Moves

When a plan is dropped onto a different parent **within the same worktree**, and the new parent is a plan or worktree:

1. **Compute new** `relativePath` from the drop target:

   - If dropped inside a **plan** parent → derive destination directory from parent plan's `relativePath` directory
   - If dropped inside a **worktree** (root level) → destination is `plans/{filename}`
   - If dropped inside a **folder** → no file move (folders are visual-only, not file-backed)
   - If dropped above/below (reorder) → only move if the parent changes

2. **Move the file on disk**: `FilesystemClient.move(oldAbsPath, newAbsPath)` with `mkdir` for destination directory

3. **Update plan metadata**: `relativePath`, `parentId` (re-detect from new path), `visualSettings.parentId`

4. **Handle nested plan files**: If the plan being moved is a folder plan (e.g., `plans/auth/readme.md`), move the entire directory (`plans/auth/` → `plans/new-parent/auth/`). Update all descendant plans' `relativePath` too.

5. **Refresh parent relationships** for affected plans via `planService.refreshSinglePlanParent()`

**Key file**: `src/components/tree-menu/tree-dnd-drop-executor.ts` — extend `executeDrop()` to detect plan moves and call a new `movePlanFile()` method on `planService`.

### Feature 2: Cross-Worktree Plan DnD

When a plan is dragged from worktree A to worktree B:

1. **Enable in validation**: `canCrossWorktreeBoundary("plan")` returns `true`

2. **Destination is always** `plans/{filename}` — regardless of where the plan lived in the source worktree, it lands at the root of the destination's `plans/` directory. No attempt to preserve the source directory structure. The user can then re-nest it within the destination worktree via normal intra-worktree DnD.

3. **On drop, in** `executeDrop()`:

   - Read the plan file content from source worktree
   - Write the file to `{destWorktreePath}/plans/{filename}`
   - Delete the file from source worktree
   - Delete the old plan metadata from `~/.anvil/plans/{oldId}/`
   - Create new plan metadata with new `worktreeId`, `relativePath: plans/{filename}`, `visualSettings.parentId` set to destination worktree ID
   - If the plan had descendants, move them all (each lands at plans root too)

4. **Handle different repos**: Worktrees can belong to different repos. The plan's `repoId` must also update when crossing repo boundaries. Since all worktrees in the tree have `repoId` on the `TreeItemNode`, this is available at drop time.

5. **Cleanup**: Archive/delete relations (plan-thread edges) for the old plan ID since they reference threads in the old worktree.

### Approach: Single `planService.movePlan()` Method

Add a `movePlan(planId, targetWorktreeId, newRelativePath)` method to `PlanService` that:

- Reads old file, writes to new location, deletes old file
- Handles metadata update (in-place update for same worktree, delete+create for cross-worktree)
- Updates all descendant plans if moving a folder plan
- Refreshes parent relationships

Then `executeDrop()` calls `movePlan()` when the dragged item is a plan and the parent/worktree changes.

## Files to Modify

| File | Change |
| --- | --- |
| `src/lib/dnd-validation.ts` | `canCrossWorktreeBoundary` returns `true` for `"plan"` |
| `src/lib/__tests__/dnd-validation.test.ts` | Update test to expect `true` for plan type |
| `src/components/tree-menu/tree-dnd-drop-executor.ts` | Add plan-specific logic in `executeDrop()` — detect worktree change or parent plan change, call `planService.movePlan()` |
| `src/entities/plans/service.ts` | Add `movePlan()` and `movePlanFile()` methods |
| `core/types/plans.ts` | Add `worktreeId` and `relativePath` to `UpdatePlanInput` |
| `src/entities/plans/utils.ts` | Add helper to compute `relativePath` from a target plan parent |

## Edge Cases

- **Plan file already exists at destination**: Check before moving, reject or prompt
- **Moving a [readme.md](http://readme.md) plan**: The parent directory semantics change — if `plans/auth/readme.md` is moved to root, it becomes just another plan file, not a folder parent
- **Empty source directory after move**: Clean up empty directories left behind
- **Git tracking**: Files may be git-tracked. For now, use plain file move (not `git mv`). The user's git workflow will pick up the rename. Future: add `git_mv` Tauri command for cleaner diffs.
- **Plan-thread relations**: When moving cross-worktree, existing plan-thread edges reference threads in the old worktree. Keep them intact (thread IDs are stable) but the relation may become less meaningful.

## Phases

- [x] Add `movePlan()` and `movePlanFile()` to `PlanService` — handles both intra-worktree file moves and cross-worktree transfers (read→write→delete pattern)

- [x] Enable `canCrossWorktreeBoundary("plan")` in `dnd-validation.ts` and update the validation logic to handle plan-specific cross-worktree drops

- [x] Extend `executeDrop()` in `tree-dnd-drop-executor.ts` to detect plan parent/worktree changes and call `planService.movePlan()`

- [x] Handle folder plans (plans with descendants) — move entire directory and update all descendant `relativePath` values

- [x] Add/update tests: DnD validation for cross-worktree plans, `movePlan()` unit tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---