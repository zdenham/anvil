# Diff View Caching

Cache range diffs and decouple `git fetch` from the critical path so the Changes tab opens instantly.

## Problem

Current data flow in `changes-diff-fetcher.ts` / `use-changes-data.ts` on every tab open:
1. `git fetch origin` — **network call on every mount**
2. `resolveMergeBase()` — git command
3. `git diff <mergeBase>` — diff computation
4. `parseDiff()` — parsing
5. `fetchFileContents()` — N parallel `git show` calls for highlighting

Only single-commit diffs are cached (`commitDiffCache`). The common "all changes" path re-fetches everything including the network call every time.

## Phases

- [x] Range diff caching (stale-while-revalidate)
- [x] Background fetch + optimistic loading

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Range diff caching (stale-while-revalidate)

### 1a. Cache range diffs by worktree + merge-base
Add a `rangeDiffCache` alongside the existing `commitDiffCache` in `changes-diff-fetcher.ts`:

```ts
interface RangeDiffCacheEntry {
  raw: string;
  parsed: ParsedDiff;
  mergeBase: string;
  fileContents: Record<string, FileContentEntry>;
  timestamp: number;
}

const rangeDiffCache = new Map<string, RangeDiffCacheEntry>();
```

Key: `${worktreePath}:${mergeBase}` (or just `worktreeId`).

### 1b. Stale-while-revalidate in `useChangesData`
Modify `loadDiff` in `use-changes-data.ts`:

1. On mount, check `rangeDiffCache`. If found, immediately set state with cached data (no loading spinner).
2. Kick off the full fetch (including `git fetch`) in the background.
3. When background fetch completes, compare new merge-base + diff. If different, update state and cache. If same, just update timestamp.

```ts
const cached = rangeDiffCache.get(worktreeId);
if (cached) {
  setParsedDiff(cached.parsed);
  setRawDiffString(cached.raw);
  setMergeBase(cached.mergeBase);
  setFileContents(cached.fileContents);
  setLoading(false); // no spinner
}
// Background refresh continues...
```

### 1c. Cache file contents alongside diff
When `fetchFileContents` completes, store results in the cache entry to avoid re-fetching N files on tab switch.

### 1d. Invalidate on relevant events
Mark cache stale when:
- A commit is made (worktree HEAD changes)
- Files are saved (for uncommitted mode)
- User clicks "refresh" explicitly

The stale-while-revalidate approach means cached data always displays immediately; background refresh ensures currency within seconds.

---

## Phase 2: Background fetch + optimistic loading

### 2a. Move `git fetch` out of the critical path
In `fetchRawDiff`, the `git fetch origin` call (line 81-84) blocks everything. Instead:

1. Use the **last known** `origin/<defaultBranch>` ref immediately to compute the diff.
2. Run `git fetch origin` in the background.
3. After fetch completes, check if the merge-base changed. If so, re-fetch the diff silently.

```ts
// Step 1: Compute diff with current local refs (fast)
const mergeBase = await resolveMergeBase(worktreePath, currentBranch, defaultBranch);
const raw = await gitCommands.diffRange(worktreePath, mergeBase);

// Step 2: Background fetch (fire-and-forget with callback)
gitCommands.fetch(worktreePath, "origin").then(async () => {
  const newMergeBase = await resolveMergeBase(...);
  if (newMergeBase !== mergeBase) {
    onRefreshNeeded();
  }
});
```

### 2b. Prefetch on worktree mount
When a worktree is first activated (before navigating to Changes tab), kick off a background `git fetch` + merge-base resolution. Store the result so the Changes tab has it ready.

Add a `prefetchChangesData(worktreeId)` method to the worktree store or as a side effect on worktree load.

---

## Impact

| Change | Effort | Impact |
|--------|--------|--------|
| Range diff cache | Medium | **High** — instant tab switch |
| Background fetch | Medium | **High** — removes network from critical path |
| Prefetch on mount | Small | Medium — proactive loading |
