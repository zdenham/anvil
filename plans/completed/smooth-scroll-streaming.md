# Smooth Sticky Scroll During Streaming

## Problem

The `ScrollCoordinator.onContentGrew()` uses `behavior: "auto"` (instant snap) for height-growth scrolling. Each new chunk of streaming text causes the viewport to jump instantly to the new bottom, creating a jerky visual experience.

## Analysis

`scroll-coordinator.ts:48` — `onContentGrew()` schedules `behavior: "auto"` (instant).
`scroll-coordinator.ts:55` — `onItemAdded()` schedules `behavior: "smooth"` (smooth).

During streaming, content growth (existing item height increases) triggers `onContentGrew` → instant scroll. New items trigger `onItemAdded` → smooth. The "last behavior wins" rule (line 84) means if both happen in the same frame, they can conflict.

The instant scroll during content growth is the main source of jerkiness. Each word addition triggers a height measurement → `onContentGrew` → instant snap to bottom.

**Fix**: Change `onContentGrew` to use `"smooth"`. The rAF coalescing already prevents multiple calls per frame. For fast streaming, the browser keeps extending the smooth animation target, creating a fluid feel.

## Phases

- [x] Change scroll coordinator `onContentGrew` to use smooth scrolling
- [ ] Verify smooth scrolling feels fluid during streaming (not laggy), revert to instant if needed

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

**File: `src/lib/scroll-coordinator.ts`**
- Line 48: Change `this._schedule("auto")` to `this._schedule("smooth")` in `onContentGrew()`.
- The rAF batching on line 86 already coalesces multiple scroll requests per frame.
- If smooth scrolling feels slow during fast streaming, consider reducing to a shorter transition or reverting to instant.
