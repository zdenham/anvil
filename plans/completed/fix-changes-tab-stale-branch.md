# Fix Changes Tab Showing Stale Branch Name

## Problem

The changes tab summary header shows `main → origin/main` even when the current worktree branch is **not** main. The display string is built in `changes-view.tsx:208`:

```typescript
return `${branchName} → origin/${defaultBranch ?? "main"}`;
```

Where `branchName` comes from the `useRepoWorktreeLookupStore`'s `currentBranch` field — a value persisted in `~/.anvil/repositories/{repo}/settings.json` and only refreshed during `worktree_sync`.

## Root Cause

`currentBranch` in the worktree settings becomes stale. Here's the lifecycle:

1. **Worktree created** → `current_branch: None` (Rust: `worktree_commands.rs:102`)
2. **worktree_sync runs** → reads `git worktree list --porcelain`, updates `current_branch` from git (Rust: `worktree_commands.rs:378-382`)
3. **Agent checks out a branch** → the git state changes, but settings.json is **not** updated
4. **Frontend reads store** → gets the stale value from hydration

The sync only fires on `WORKTREE_SYNCED` events (from agent lifecycle). If the branch changes between syncs (e.g., agent creates and checks out a branch mid-task), the store keeps the old value.

**Secondary impact**: The stale `currentBranch` is also passed to `resolveMergeBase()` in `changes-diff-fetcher.ts:29`. If `currentBranch === defaultBranch` (both "main"), it takes a wrong code path — diffing against `origin/main` directly instead of computing the proper merge-base. This means the diff itself may be wrong, not just the label.

## Key Files

| File | Role |
| --- | --- |
| `src/components/changes/changes-view.tsx:192-211` | `getSubtext()` — renders the `branch → origin/default` label |
| `src/components/changes/use-changes-data.ts:47` | Reads `currentBranch` from store |
| `src/components/changes/changes-diff-fetcher.ts:20-40` | `resolveMergeBase()` — uses `currentBranch` for diff base logic |
| `src/stores/repo-worktree-lookup-store.ts:129-131` | `getCurrentBranch()` — reads from hydrated settings |
| `src-tauri/src/worktree_commands.rs:376-383` | Rust sync — updates `current_branch` from git |
| `src-tauri/src/git_commands.rs:506-553` | `git_list_worktrees` — parses `git worktree list --porcelain` |
| `src/components/changes/changes-diff-cache.ts` | `rangeDiffCache` — stale-while-revalidate cache keyed by worktree path (not branch) |

## Phases

- [x] Read the current branch from git at diff time instead of relying on stale store value

- [x] Invalidate range diff cache when branch changes

- [x] Keep store in sync as a secondary measure

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Read current branch from git at diff time

The most reliable fix: query git directly in `useChangesData` / `fetchRawDiff` instead of trusting the store.

### Approach

1. **Add a Tauri command** `git_get_current_branch` in `src-tauri/src/git_commands.rs`:

   - Runs `git rev-parse --abbrev-ref HEAD` in the given worktree path
   - Returns `null` for detached HEAD (git outputs `"HEAD"` literally)
   - Register in `src-tauri/src/lib.rs`

2. **Add frontend wrapper** in `src/lib/tauri-commands.ts`:

   ```typescript
   getCurrentBranch: (worktreePath: string) =>
     invoke<string | null>("git_get_current_branch", { worktreePath }),
   ```

3. **Use fresh branch in** `useChangesData` (`src/components/changes/use-changes-data.ts`):

   - Add a `freshBranch` state that's fetched via the new Tauri command when `worktreePath` changes
   - Return `freshBranch` as `branchName` instead of `currentBranch` from store
   - Pass `freshBranch` to `fetchRawDiff` for correct merge-base computation

4. **Update** `fetchRawDiff` to use the fresh branch value it receives (already does via `currentBranch` param — just need to ensure the caller passes the fresh value).

### Why this approach

- Git is the source of truth for the current branch — reading it directly eliminates all staleness
- The Tauri command is cheap (single `git rev-parse` call)
- The `useChangesData` hook already re-runs when `worktreePath` changes, so adding a git query there is natural
- No need to maintain cache invalidation logic for the store

## Phase 2: Invalidate range diff cache when branch changes

The `rangeDiffCache` (`changes-diff-cache.ts:20`) is keyed by **worktree path only** — it doesn't account for which branch the diff was computed against. When the branch changes within a worktree, the stale-while-revalidate path (`use-changes-data.ts:75`) serves the previous branch's diff before the fresh fetch replaces it. `invalidateRangeDiffCache()` exists but is never called on branch change.

### Approach

1. **In** `useChangesData`, after fetching the fresh branch from git (Phase 1), compare it to the `mergeBase`-associated branch in the cache. If the branch changed, call `invalidateRangeDiffCache(worktreePath)` **before** the stale-while-revalidate read:

   ```typescript
   // Inside loadDiff, before the stale-while-revalidate block:
   const cached = isRangeMode ? getCachedRangeDiff(worktreePath) : undefined;
   if (cached && freshBranch !== previousBranchRef.current) {
     invalidateRangeDiffCache(worktreePath);
     cached = undefined; // skip stale display
   }
   previousBranchRef.current = freshBranch;
   ```

2. **Track the previous branch** with a `useRef` so we can detect transitions without an extra git call.

### Why this approach

- Avoids showing the wrong branch's diff during the stale-while-revalidate window
- Cheap — just a string comparison, no extra git calls
- The `invalidateRangeDiffCache` function already exists and is tested, just unused in this path
- Only invalidates on actual branch transitions, not on every render

---

## Phase 3: Keep store in sync (defense-in-depth)

Even with Phase 1, the store's `currentBranch` is used elsewhere (breadcrumbs, tree menu display). Keep it reasonably fresh.

### Approach

1. **Trigger a lightweight sync when opening changes view**: In `useChangesData`, after fetching the fresh branch from git, update the store if it differs:

   ```typescript
   // If fresh branch differs from store, trigger background re-hydrate
   if (freshBranch !== storeBranch) {
     worktreeService.sync(repoName).then(() =>
       useRepoWorktreeLookupStore.getState().hydrate()
     );
   }
   ```

2. **This is fire-and-forget** — the changes view doesn't wait for it, since it already has the fresh branch from Phase 1. But it ensures the store catches up for other consumers.