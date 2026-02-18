# Fix Find Bar: Disable on Thread + Fix Existing Issues

## Diagnosis

The current `useContentSearch` hook walks the live DOM to find text nodes, but the thread view uses Virtuoso (react-virtuoso) which only renders items within a ~200px overscan buffer. This creates cascading failures: incomplete results, position resets on every scroll, scrollIntoView fighting Virtuoso, and stale Range objects. See git history for full breakdown.

The DOM-walking approach works fine for **non-virtualized views** (plan, file, logs). Thread is the only virtualized content pane.

## Approach

1. **Disable search on thread views** — thread search needs a fundamentally different approach (search source data, scroll via Virtuoso API). That's a separate effort.
2. **Fix the existing bugs** for views where search does work (plan, file, logs):
   - MutationObserver resets match position on every DOM change
   - Input width shifts when match count appears/disappears
3. **Revert the stale-closure change** from previous attempt (it wasn't the root cause)

## Phases

- [x] Exclude `thread` from searchable views in `content-pane.tsx`
- [x] Fix MutationObserver resetting `currentMatch` — pass `preservePosition` flag
- [x] Fix input width shifting in FindBar
- Skipped: Revert functional updater — it's marginally more correct, keeping it

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Disable search on thread views

In `content-pane.tsx` line 80-81, add `thread` to the exclusion list:

```ts
const isSearchable =
  view.type !== "empty" && view.type !== "terminal" && view.type !== "settings" && view.type !== "thread";
```

Cmd+F will simply not activate on thread views. Thread-specific search can be built separately with a data-driven approach + Virtuoso `scrollToIndex()`.

### Phase 2: Fix MutationObserver position reset

In `use-content-search.ts`:

1. Change `runSearch` to accept `preservePosition?: boolean`
2. When `preservePosition` is true and there are matches:
   - Use `setCurrentMatch(prev => Math.min(prev, ranges.length) || 1)` instead of resetting to 1
   - Still update the current highlight for the clamped position
3. MutationObserver callback: `runSearch(true)` — preserves navigation position
4. Debounced search (user typing): `runSearch()` — resets to 1 (new query = start from top)

### Phase 3: Fix input width

In `find-bar.tsx`:

1. Always render the match count span (remove conditional)
2. Add `min-w-[4.5rem] text-right` so the counter reserves space
3. Show empty string when no query, "No results" when no matches

### Phase 4: Revert functional updater

The `goToNext`/`goToPrevious` change to use `setCurrentMatch((prev) => ...)` was addressing the wrong root cause. With the MutationObserver fix in phase 2, the simpler direct form works fine. Revert to the original style for readability, but keep `currentMatch` out of the dependency array since we read it via the updater.

Actually — the functional updater is fine and marginally more correct. Skip this phase, keep the current form.
