# Fix: Closing FindBar does not clear highlights

## Bug

When using the FindBar (`Cmd+F`), searching for a term, then closing the bar (Escape or close button), the CSS Highlight API highlights remain visible on the page.

## Root Cause

`clear()` in both `use-content-search.ts` and `use-thread-search.ts` calls `clearHighlights()` synchronously, then `setQuery("")` which is batched by React. The FindBar unmount causes a DOM mutation, which fires the MutationObserver while it's still connected. The observer checks `queryRef.current` — which still holds the old query — and re-applies highlights.

Highlights are already a reactive side effect of `query` via the debounced `useEffect`. The synchronous `clearHighlights()` call in `clear()` is what creates the visible bug: highlights flash off (sync clear) → on (observer re-applies) → off (effect finally runs). Without the imperative clear, the observer would just refresh existing highlights, and the effect would clean up in one pass.

## Phases

- [x] Make `clear()` purely reactive — just set state, let the effect handle highlights
- [x] Verify MutationObserver cannot re-apply after clear

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Make `clear()` purely reactive

Remove the imperative `clearHighlights()` from `clear()`. Sync `queryRef` so the MutationObserver sees the empty query immediately and skips re-applying. Let the existing `useEffect` on `query` handle highlight cleanup reactively.

**`use-content-search.ts`** — update `clear()`:
```ts
const clear = useCallback(() => {
  queryRef.current = "";                                      // sync ref so observer skips
  if (debounceRef.current) clearTimeout(debounceRef.current); // cancel pending search
  setQuery("");
  setMatchCount(0);
  setCurrentMatch(0);
  rangesRef.current = [];
}, []);
```

**`use-thread-search.ts`** — update `clear()`:
```ts
const clear = useCallback(() => {
  queryRef.current = "";                                      // sync ref so observer skips
  if (debounceRef.current) clearTimeout(debounceRef.current); // cancel pending search
  setQuery("");
  setMatchCount(0);
  setCurrentMatch(0);
  matchesRef.current = [];
}, []);
```

No `clearHighlights()` call — the `useEffect` watching `query` already handles it:
```ts
useEffect(() => {
  if (!query) {
    clearHighlights();  // ← this is the single source of truth for cleanup
    // ...
    return;
  }
  // ...
}, [query, ...]);
```

### Phase 2: Verify observer guard

The MutationObserver in `use-content-search.ts` checks:
```ts
if (queryRef.current) runSearch(true);
```

With `queryRef.current = ""` set synchronously in `clear()`, the guard prevents re-application even before React re-renders and disconnects the observer.

The observer in `use-thread-search.ts` additionally checks `matchesRef.current.length > 0`, which is also cleared synchronously — doubly protected.

## Files to modify

1. `src/components/content-pane/use-content-search.ts` — fix `clear()`
2. `src/components/thread/use-thread-search.ts` — fix `clear()`
