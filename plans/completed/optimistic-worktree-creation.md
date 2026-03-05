# Optimistic Worktree Creation

## Problem

Creating a worktree takes several seconds because the Rust backend does `git fetch` + `git worktree add` before the UI learns about the new worktree. During this time, the user only sees a spinner on the **existing** section's plus button — the new worktree section doesn't appear in the sidebar until the full round-trip completes.

## Goal

The new worktree section should appear **immediately** in the left sidebar when the user clicks "New worktree", with a loading/creating indicator, while the git operations run in the background.

## Current Flow (slow path)

```
handleNewWorktree(repoName)
  → setCreatingWorktreeForRepo(repoName)   // spinner on plus button
  → worktreeService.sync()                 // IPC: git prune + list
  → generateUniqueWorktreeName()           // pick random name
  → worktreeService.create()               // IPC: git fetch + git worktree add (SLOW)
  → worktreeService.sync()                 // IPC: re-sync
  → lookupStore.hydrate()                  // re-read all settings.json from disk
  → treeMenuService.hydrate()              // refresh sidebar
  // NOW the section finally appears
```

## Design

### Approach: Optimistic insert into the lookup store

The sidebar tree is derived from `useRepoWorktreeLookupStore.repos` (via `useTreeData` → `buildTreeFromEntities`). If we insert a placeholder worktree entry into the lookup store **before** calling the Tauri backend, the section will render instantly.

### Changes

#### 1. Add optimistic insert/remove/reconcile methods to `useRepoWorktreeLookupStore`

File: `src/stores/repo-worktree-lookup-store.ts`

Add three new methods:

- **`addOptimisticWorktree(repoId, tempWorktreeId, name)`** — Inserts a placeholder `WorktreeLookupInfo` into the repo's worktree map with `path: ""` and `currentBranch: null`. Returns the tempWorktreeId for later reconciliation.

- **`reconcileWorktree(repoId, tempWorktreeId, realWorktreeId, realPath)`** — Replaces the temp entry with the real one (swaps the key from temp ID to real ID, fills in path). Called after the backend returns successfully.

- **`removeOptimisticWorktree(repoId, tempWorktreeId)`** — Removes the placeholder on error/rollback.

#### 2. Track "creating" worktree sections in UI

File: `src/stores/tree-menu/store.ts` (or the component directly)

Add a state field like `creatingSectionIds: Set<string>` to track which `repoId:worktreeId` sections are currently being created. This lets the section header show a spinner or shimmer instead of the normal plus button spinner.

#### 3. Update `handleNewWorktree` in `main-window-layout.tsx`

File: `src/components/main-window/main-window-layout.tsx` (lines 412-465)

New flow:
```
handleNewWorktree(repoName)
  → sync existing worktrees (to get names, same as before)
  → generateUniqueWorktreeName()
  → generate tempWorktreeId = crypto.randomUUID()
  → resolve repoId from repoName via lookup store
  → lookupStore.addOptimisticWorktree(repoId, tempWorktreeId, worktreeName)
  → mark section `repoId:tempWorktreeId` as "creating"
  // Section appears IMMEDIATELY in sidebar ✓
  → worktreeService.create(repoName, worktreeName)          // async, in background
  → worktreeService.sync(repoName)                          // get real worktree data
  → lookupStore.reconcileWorktree(repoId, tempId, realId, realPath)
  → lookupStore.hydrate()                                   // full re-sync for safety
  → treeMenuService.hydrate()
  → clear "creating" state
```

On error:
```
  → lookupStore.removeOptimisticWorktree(repoId, tempWorktreeId)
  → clear "creating" state
```

#### 4. Visual treatment of the optimistic section

File: `src/components/tree-menu/repo-worktree-section.tsx`

When a section is in the "creating" state:
- Show a small spinner or shimmer next to the worktree name in the section header
- Disable interactive actions (new thread, context menu) until creation completes
- The section should otherwise look normal (expanded, empty items list)

This is minimal — just a visual cue that git operations are in progress. No skeleton UI needed since the section is expected to be empty at first anyway.

## Phases

- [x] Add optimistic CRUD methods to `useRepoWorktreeLookupStore`
- [x] Add `creatingSectionIds` tracking (tree-menu store or local state)
- [x] Refactor `handleNewWorktree` to insert optimistic entry before IPC call
- [x] Add "creating" visual state to `RepoWorktreeSection` header
- [x] Handle error rollback (remove optimistic entry on failure)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Edge Cases

- **Name collision after optimistic insert**: The name is generated from the existing set, and checked for uniqueness by the backend too. No new risk here.
- **User clicks "New worktree" rapidly**: The spinner/disabled state on the plus button already prevents this. The `creatingSectionIds` state provides extra safety.
- **Backend failure**: Remove the optimistic section cleanly. User sees it disappear — could show a toast if desired, but not required for v1.
- **Reconciliation mismatch**: If `worktreeService.sync()` returns a different ID than expected (shouldn't happen since we just created it), the full `hydrate()` at the end corrects everything.

## Non-Goals

- Allowing thread creation in the optimistic section before the worktree exists on disk (needs a real path)
- Changing the Rust backend to be faster (separate concern)
- Skeleton/shimmer UI for child items (section will be empty anyway)
