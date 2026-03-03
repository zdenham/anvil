# Fix diff base resolution to match GitHub behavior

## Problem

The Changes diff viewer computes the merge-base against the **local** default branch ref (e.g., `main`) instead of `origin/main`. When the local `main` is stale (hasn't been pulled), the diff includes unrelated commits that landed on main, inflating the file count and line changes.

**Observed**: shortcut repo PR #6824 shows +317/-125 (14 files) on GitHub, but the app shows +1784/-982 (37 files) because local `main` is behind `origin/main` by 1 commit with a different merge-base ancestor.

The root cause is in `resolveMergeBase()` at `src/components/changes/changes-diff-fetcher.ts:31`:
```typescript
gitCommands.getMergeBase(worktreePath, currentBranch, defaultBranch)
//                                                     ^^^^^^^^^^^^^ local "main", not "origin/main"
```

## Phases

- [x] Fix `resolveMergeBase` to use `origin/<defaultBranch>` and fetch before diffing
- [x] Verify the "on main" case still works correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix `resolveMergeBase` to use `origin/<defaultBranch>` and fetch before diffing

### Changes to `src/components/changes/changes-diff-fetcher.ts`

**1. Add a fetch before resolving merge-base**

In `fetchRawDiff`, before calling `resolveMergeBase`, do a `git fetch origin` to ensure `origin/<defaultBranch>` is current. This matches what worktree creation already does. Use a fire-and-forget approach with a short timeout so the UI isn't blocked if the network is slow — stale `origin/main` is still better than stale local `main`.

```typescript
// In fetchRawDiff, before resolveMergeBase:
try {
  await gitCommands.fetch(worktreePath, "origin");
} catch {
  logger.warn("[changes] fetch failed, proceeding with stale refs");
}
```

**2. Fix merge-base to use `origin/<defaultBranch>`**

Change `resolveMergeBase` so all paths use the remote ref:

```typescript
export async function resolveMergeBase(
  worktreePath: string,
  currentBranch: string | null,
  defaultBranch: string
): Promise<string> {
  const remoteRef = `origin/${defaultBranch}`;

  // On default branch: diff against origin/<defaultBranch> directly
  // (shows unpushed work — merge-base would return HEAD itself)
  if (currentBranch === defaultBranch) {
    return getRemoteFallback(worktreePath, defaultBranch);
  }

  // Detached HEAD or feature branch: compute merge-base against remote ref
  try {
    return await gitCommands.getMergeBase(worktreePath, "HEAD", remoteRef);
  } catch {
    logger.warn("[changes] getMergeBase failed, falling back to remote ref");
    return getRemoteFallback(worktreePath, defaultBranch);
  }
}
```

Key changes:
- **Detached HEAD** (normal worktree): now goes through merge-base (`HEAD` vs `origin/main`) instead of skipping to remote fallback. This correctly finds the fork point.
- **Feature branch**: uses `HEAD` and `origin/<defaultBranch>` instead of `currentBranch` and local `defaultBranch`. Using `HEAD` is more reliable for detached state.
- **On default branch**: unchanged — still diffs directly against `origin/<defaultBranch>` to show unpushed work.
- **Fallback**: unchanged — if merge-base fails, use `origin/<defaultBranch>` directly.

## Phase 2: Verify the "on main" case still works

The `currentBranch === defaultBranch` check correctly catches the case where someone is working directly on main. In this case:
- `git merge-base HEAD origin/main` would return HEAD itself (or close to it) → useless diff
- So we skip merge-base and diff directly against `origin/main` → shows unpushed work

Verify this path is preserved and doesn't regress. No code changes expected — just validation.

## Files modified

- `src/components/changes/changes-diff-fetcher.ts` — the only file that needs changes
