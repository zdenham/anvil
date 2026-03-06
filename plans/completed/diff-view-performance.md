# Diff View Performance Improvements

Two independent workstreams: scroll performance and diff fetch caching.

## Problem Analysis

### Scroll Lag

The changes pane virtualizes at the **file-card level** (`ChangesDiffContent` uses `useVirtualList`), but within each `InlineDiffBlock`, every line renders as a real DOM node. A 500-line file produces 500+ `AnnotatedLineRow` components, each with 4 spans + N token spans from Shiki highlighting. With overscan of 400px, multiple large files can be mounted simultaneously, creating thousands of DOM nodes.

Key contributing factors:
1. **No line-level virtualization** — all lines in a visible file card are in the DOM
2. **Token span explosion** — Shiki tokens create 5-15 `<span>` per line (2,500-7,500 for a 500-line file)
3. **Comment infra per line** — `DiffContentWithComments` renders `InlineCommentDisplay` for every line even when empty
4. **Highlight-triggered full re-render** — when `useDiffHighlight` resolves async, it replaces all line objects, re-rendering the entire file card
5. **No CSS containment** — browsers can't optimize layout/paint for off-screen lines

### Slow Diff Loading

Current data flow in `changes-diff-fetcher.ts` / `use-changes-data.ts`:
1. `git fetch origin` — **network call on every mount** (line 81-84 of `changes-diff-fetcher.ts`)
2. `resolveMergeBase()` — git command
3. `git diff <mergeBase>` — diff computation
4. `parseDiff()` — parsing
5. `fetchFileContents()` — N parallel `git show` calls for highlighting

Only single-commit diffs are cached (`commitDiffCache`). The common "all changes" path (range diff) re-fetches everything including the network call every time the tab is opened.

---

## Phases

- [ ] Phase 1: CSS containment + line rendering optimization
- [ ] Phase 2: Reduce unnecessary re-renders from highlighting
- [ ] Phase 3: Range diff caching (stale-while-revalidate)
- [ ] Phase 4: Background fetch + optimistic loading

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: CSS containment + line rendering optimization

**Goal**: Reduce layout/paint cost for lines already in the DOM.

### 1a. Add CSS `contain` to line rows
In `annotated-line-row.tsx`, add `contain-intrinsic-size` and `content-visibility: auto` to each line div. This lets the browser skip layout/paint for off-screen lines within a file card:

```tsx
// annotated-line-row.tsx — add to the outer div className
style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 24px' }}
```

This is a single-line change with huge impact — the browser will skip rendering for lines scrolled out of the viewport even though they're in the DOM.

### 1b. Skip rendering empty `InlineCommentDisplay`
In `inline-diff-block.tsx` `DiffContentWithComments`, only render `<InlineCommentDisplay>` when `lineComments.length > 0`:

```tsx
// Before (line ~392):
<InlineCommentDisplay comments={lineComments} />

// After:
{lineComments.length > 0 && <InlineCommentDisplay comments={lineComments} />}
```

### 1c. Flatten token spans for unchanged lines
For `type === "unchanged"` lines (which are the majority), consider rendering the content as a single `textContent` string instead of individual token spans when scrolling is detected (use the existing `data-scrolling` attribute from `useScrolling`). This is a conditional optimization — during scroll, show plain text; when idle, show tokenized.

**Alternative (simpler)**: Set a max token count. If a line has >30 tokens, merge adjacent same-color tokens to reduce span count. This is a pure render optimization in `TokenizedContent`.

---

## Phase 2: Reduce unnecessary re-renders from highlighting

**Goal**: Prevent the async highlight completion from triggering a full file-card re-render.

### 2a. Stabilize `useDiffHighlight` output identity
Currently when highlighting resolves, `setHighlighted(...)` creates a brand-new array, causing every `AnnotatedLineRow` to receive new props (even though `memo` catches content equality, the line *object* reference changes).

Fix: In `applyTokensByLineNumber` and `applyPerHunkTokens`, reuse the original `AnnotatedLine` object when no tokens were applied (i.e., when `tokens` is undefined for that line). Only create a new object for lines that actually got tokens.

This is already mostly correct but the spread `{ ...line, tokens }` in `applyTokensByLineNumber` always creates a new object even when `tokens` is undefined. Add a guard:

```ts
if (!tokens) return line; // already present, good
return { ...line, tokens }; // only for lines that got tokens
```

Verify this is consistent across both `applyTokensByLineNumber` and `applyPerHunkTokens`.

### 2b. Split highlight into batches (optional, if Phase 1 isn't enough)
Instead of highlighting all lines at once and doing one big `setHighlighted(allLines)`, highlight in chunks (e.g., 50 lines at a time) using `requestIdleCallback`. This spreads the re-render cost across frames.

---

## Phase 3: Range diff caching (stale-while-revalidate)

**Goal**: Show the previous diff instantly when the Changes tab is opened, then refresh in the background.

### 3a. Cache range diffs by worktree + merge-base
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

### 3b. Stale-while-revalidate pattern in `useChangesData`
Modify `loadDiff` in `use-changes-data.ts`:

1. On mount, check `rangeDiffCache` for the worktree. If found, immediately set state with cached data (no loading spinner).
2. Still kick off the full fetch (including `git fetch`) in the background.
3. When background fetch completes, compare the new merge-base + diff. If different, update state and cache. If same, just update timestamp.

```ts
// Pseudocode for the stale-while-revalidate flow:
const cached = rangeDiffCache.get(worktreeId);
if (cached) {
  // Instant display
  setParsedDiff(cached.parsed);
  setRawDiffString(cached.raw);
  setMergeBase(cached.mergeBase);
  setFileContents(cached.fileContents);
  setLoading(false); // no spinner!
}
// Background refresh...
```

### 3c. Cache file contents alongside diff
When `fetchFileContents` completes, store the results in the cache entry. This avoids re-fetching N files on tab switch.

### 3d. Invalidate on relevant events
Cache should be invalidated (or marked stale) when:
- A commit is made (worktree HEAD changes)
- Files are saved (for uncommitted mode)
- User clicks "refresh" explicitly

For now, the stale-while-revalidate approach means the cache is always used immediately but the background refresh ensures data is current within seconds.

---

## Phase 4: Background fetch + optimistic loading

**Goal**: Decouple `git fetch` from the critical path.

### 4a. Move `git fetch` out of the critical path
In `fetchRawDiff`, the `git fetch origin` call (line 81-84) blocks everything. Instead:

1. Use the **last known** `origin/<defaultBranch>` ref immediately to compute the diff.
2. Run `git fetch origin` in the background.
3. After fetch completes, check if the merge-base changed. If so, re-fetch the diff silently.

This means the first render uses potentially stale remote refs, but the diff is computed against the local ref which is usually close enough. The background fetch corrects it within seconds.

```ts
// In fetchRawDiff, "all changes" mode:
// Step 1: Compute diff with current local refs (fast)
const mergeBase = await resolveMergeBase(worktreePath, currentBranch, defaultBranch);
const raw = await gitCommands.diffRange(worktreePath, mergeBase);

// Step 2: Background fetch (fire-and-forget with callback)
gitCommands.fetch(worktreePath, "origin").then(async () => {
  const newMergeBase = await resolveMergeBase(...);
  if (newMergeBase !== mergeBase) {
    // Re-fetch diff with updated refs
    onRefreshNeeded();
  }
});
```

### 4b. Prefetch on worktree mount
When a worktree is first activated (before the user navigates to Changes tab), kick off a background `git fetch` + merge-base resolution. Store the result so the Changes tab has it ready.

This could be done in the worktree store or as a side effect when the worktree loads. Since we already have `useRepoWorktreeLookupStore`, add a `prefetchChangesData(worktreeId)` method.

---

## Impact Estimates

| Phase | Effort | Scroll Impact | Load Impact |
|-------|--------|---------------|-------------|
| 1a: CSS containment | Small | **High** — browser skips off-screen lines | — |
| 1b: Skip empty comments | Trivial | Medium — fewer DOM nodes | — |
| 1c: Token merging | Medium | Medium — fewer spans | — |
| 2a: Stable highlight refs | Small | Medium — fewer re-renders | — |
| 3a-c: Range diff cache | Medium | — | **High** — instant tab switch |
| 4a: Background fetch | Medium | — | **High** — removes network from critical path |
| 4b: Prefetch | Small | — | Medium — proactive loading |

Recommended order: 1a → 3a-c → 4a → 1b → 2a → 1c → 4b
