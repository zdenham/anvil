# Fix: Closing Find does not unhighlight items

## Problem

Both `useContentSearch.clear()` and `useThreadSearch.clear()` do NOT call `clearHighlights()` directly. They set `setQuery("")` and rely on the debounced search `useEffect` to detect `query === ""` and call `clearHighlights()`.

This creates a race condition: the `clear()` function is called synchronously (on close button click or Escape), but `clearHighlights()` only fires in the next React effect cycle. During the gap, highlights remain visible.

More critically, if the effect cleanup or re-run gets interrupted (e.g., by a fast component update or React batching), the CSS highlights persist indefinitely since `CSS.highlights` is a global registry that outlives component renders.

## Files to Change

- `src/components/content-pane/use-content-search.ts`
- `src/components/thread/use-thread-search.ts`

## Approach

Call `clearHighlights()` directly in both `clear()` functions, making cleanup synchronous and deterministic. Add `clearHighlights` to the dependency array.

### `use-content-search.ts`:

```typescript
const clear = useCallback(() => {
  queryRef.current = "";
  if (debounceRef.current) clearTimeout(debounceRef.current);
  clearHighlights();  // <-- add this
  setQuery("");
  setMatchCount(0);
  setCurrentMatch(0);
  rangesRef.current = [];
}, [clearHighlights]);  // <-- add dep
```

### `use-thread-search.ts`:

```typescript
const clear = useCallback(() => {
  queryRef.current = "";
  if (debounceRef.current) clearTimeout(debounceRef.current);
  clearHighlights();  // <-- add this
  setQuery("");
  setMatchCount(0);
  setCurrentMatch(0);
  matchesRef.current = [];
}, [clearHighlights]);  // <-- add dep
```

## Phases

- [x] Add `clearHighlights()` call to `useContentSearch.clear()`

- [x] Add `clearHighlights()` call to `useThreadSearch.clear()`

- [x] Verify highlights are removed immediately on close

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---