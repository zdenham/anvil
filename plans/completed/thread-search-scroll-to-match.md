# Fix Thread Search: Scroll to Match Within Long Turns

## Problem

`useThreadSearch` scrolls to the correct **turn** via Virtuoso's `scrollToIndex`, but doesn't scroll to the specific **text** within that turn. For long messages, the match can be off-screen even though the turn is visible.

The DOM-based `useContentSearch` calls `scrollIntoView()` on the matched range's parent element (`use-content-search.ts:57-65`). `useThreadSearch` has no equivalent — it highlights the match via CSS Highlight API but never scrolls to it.

## Phases

- [x] Add scrollIntoView call after highlighting the current match

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

**File:** `src/components/thread/use-thread-search.ts`

### Change 1: `applyHighlights` scrolls to the current range

After line 185 where `currentRange` is set as the current highlight, add a `scrollIntoView` call:

```ts
// Inside applyHighlights, after CSS.highlights.set(HIGHLIGHT_CURRENT, ...)
if (currentRange) {
  CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(currentRange));
  // Scroll the matched text into view within the turn
  const el = currentRange.startContainer.parentElement;
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
```

This mirrors `useContentSearch.scrollToMatch()` exactly (line 57-65).

### Why this works

- `scrollToIndex` ensures the turn is rendered in the DOM (Virtuoso materialization)
- The double-`requestAnimationFrame` in navigation ensures DOM is settled before `applyHighlights` runs
- `applyHighlights` already walks visible DOM and identifies `currentRange` — it just never scrolled to it
- `scrollIntoView` on a child element inside the Virtuoso scroller works because the scroller is a standard overflow container

### Edge case: same-turn navigation

Currently, when consecutive matches are in the same turn, `scrollToIndex` is **skipped** (lines 281-284). The `applyHighlights` call still fires, and the new `scrollIntoView` on `currentRange` will handle positioning — so this case is fixed too without any additional changes.

### Potential concern: double scroll

When the turn *does* change, both `scrollToIndex` (Virtuoso-level) and `scrollIntoView` (element-level) fire. The `scrollToIndex` fires immediately, then after 2 rAF frames `scrollIntoView` fires. Since `scrollIntoView` targets a child within the already-scrolled-to turn, the Virtuoso scroll should be settled by then and `scrollIntoView` just does a fine-grained adjustment. The `behavior: "smooth"` on both prevents jarring jumps. If the double animation feels janky, `scrollIntoView` could use `behavior: "instant"` instead since Virtuoso already did the large scroll.

## Files to modify

- `src/components/thread/use-thread-search.ts` — add 4 lines inside `applyHighlights`
