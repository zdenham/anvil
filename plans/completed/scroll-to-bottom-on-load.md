# Scroll to Bottom on Thread Open

## Problem

When opening a thread, the view should start scrolled to the bottom. Currently it sometimes stops short because:

1. **`useLayoutEffect` pre-scroll** (`use-virtual-list.ts:174`) sets `el.scrollTop = el.scrollHeight`, but `scrollHeight` is based on estimated heights (100px × N). Actual heights differ, so the scroll target is wrong.
2. **100ms setTimeout hack** (`control-panel-window.tsx:415`) calls `scrollToBottom()` using `getScrollTarget("LAST")` — offsets still based on estimates.
3. **No re-scroll after measurement** — ResizeObserver measures actual heights and `totalHeight` changes, but nothing re-scrolls to bottom. `autoScrollOnGrowth` only fires when `isRunning` is true, so idle threads get stuck.

## Approach considered: bottom-anchored scroll (`column-reverse`)

The CSS analogy of `bottom: 1px` maps to `flex-direction: column-reverse` — makes `scrollTop = 0` = "at the bottom", so height changes above the viewport are invisible. But it requires inverting the entire virtualizer coordinate system (offsets, binary search, `isAtBottom`, scroll correction sign, render order, spacer swaps). Full refactor across all three layers for a single use case.

**Not worth it** — the snap approach below is 2 lines in existing callbacks and converges in 1-2 frames (~32ms, imperceptible).

## Fix: re-snap to bottom after measurement batches

The existing ResizeObserver callback and sync measurement `useLayoutEffect` already run after each height batch. We just add 2 lines: `el.scrollTop = el.scrollHeight` + `list.updateScroll(...)` — gated by a ref that clears once heights stabilize.

### Changes

**`src/lib/virtual-list.ts`** — No changes.

**`src/hooks/use-virtual-list.ts`**:
- Add `initialScrollToBottom?: boolean` option
- Track a `pendingScrollToBottom` ref, initialized to `true` when the option is set
- After each measurement batch (both the first-batch fast path at line 272 and the rAF-throttled path at line 292), if `pendingScrollToBottom` is true:
  ```ts
  el.scrollTop = el.scrollHeight;
  list.updateScroll(el.scrollTop, el.clientHeight);
  ```
- Clear `pendingScrollToBottom` when `setItemHeights` returns `0` (no heights changed = stabilized)
- Also clear if user scrolls up (sticky becomes false)

**`src/components/thread/message-list.tsx`**:
- Pass `initialScrollToBottom: true` to `useVirtualList`

**`src/components/thread/message-list.tsx`** (additional):
- Ensure `MessageList` is keyed by `threadId` in the parent so it remounts on thread switch, re-arming `pendingScrollToBottom`. Without this, switching threads wouldn't re-trigger the scroll-to-bottom.

**`src/components/control-panel/control-panel-window.tsx`**:
- Add `key={threadId}` on `<MessageList>` if not already present
- Remove `hasScrolledOnMount` ref, the `useEffect` resetting it on threadId change, and the 100ms `setTimeout` → `scrollToBottom()` (lines 405-419). The virtualizer now handles this internally.

## Side effects considered

1. **Thread switching** — `pendingScrollToBottom` ref won't re-arm unless `MessageList` remounts. Fix: `key={threadId}` on `<MessageList>`.
2. **User scrolls up during ~32ms settle** — Would yank back to bottom. Fix: clear flag when sticky becomes false.
3. **Correction + snap overlap** — Existing `scrollTop += correction` is immediately overwritten by `scrollTop = scrollHeight`. Redundant but harmless (same sync callback).
4. **Streaming overlap** — `initialScrollToBottom` and `autoScrollOnGrowth` both want bottom; no conflict. Once flag clears, sticky takes over.

## Phases

- [x] Add `initialScrollToBottom` to `useVirtualList` — ref + 2-line snap in both measurement paths
- [x] Pass `initialScrollToBottom: true` from `MessageList`, add `key={threadId}` in parent
- [x] Remove setTimeout scroll hack from `control-panel-window.tsx`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Files

| File | Change |
|------|--------|
| `src/hooks/use-virtual-list.ts` | Add `initialScrollToBottom` + re-snap after measurement |
| `src/components/thread/message-list.tsx` | Pass `initialScrollToBottom: true` |
| `src/components/control-panel/control-panel-window.tsx` | Remove setTimeout scroll hack |
