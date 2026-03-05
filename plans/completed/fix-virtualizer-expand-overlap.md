# Fix virtualizer overlap on tool block expand/collapse

## Problem

Expanding a tool block in the thread view causes a brief moment of overlap with items below it. The expanded content visually covers the next item(s) for ~80ms before positions correct.

## Root cause

The virtualizer uses **absolute positioning** (`translateY(item.start)`) for each item (message-list.tsx:104-109). When a tool block expands, the DOM height changes immediately, but the virtualizer's offset recalculation is delayed by an **80ms throttle** on the ResizeObserver path.

### The timing gap in detail

1. User clicks expand → Zustand store updates → ToolUseBlock re-renders with content visible
2. DOM height increases immediately (no CSS transition — it's conditional render)
3. ResizeObserver fires → height collected into `pendingHeightsRef`
4. **`setTimeout` waits 80ms** (`RESIZE_THROTTLE_MS = 80` at use-virtual-list.ts:239)
5. After 80ms: `list.setItemHeights()` → prefix-sum offsets rebuilt → subscribers notified → items repositioned

During the 80ms window (steps 3-5), items below the expanding block still have their old `translateY` positions. The expanding item's new content physically overlaps them because nothing has pushed them down yet.

### Why the sync `useLayoutEffect` doesn't help

There's a `useLayoutEffect` (use-virtual-list.ts:298-317) that reads `offsetHeight` synchronously on every render. However, it only fires when the `useVirtualList` host component (MessageList) re-renders. A tool expand happens inside a child component (ToolUseBlock) via Zustand — **MessageList doesn't re-render**, so the sync measurement path never fires. The height change is only caught by the async ResizeObserver → 80ms throttle path.

## Phases

- [x] Replace `setTimeout` throttle with `requestAnimationFrame` for ResizeObserver height flush
- [x] Verify no regressions with streaming content and rapid height changes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Replace `setTimeout` with `requestAnimationFrame`

**File:** `src/hooks/use-virtual-list.ts` (lines 239-281)

The current throttle uses `setTimeout(fn, 80)` which adds an artificial 80ms delay. Replace it with `requestAnimationFrame` which:
- Still batches multiple ResizeObserver entries within the same frame
- Flushes at the **next paint** (~16ms) instead of 80ms later
- Eliminates the visible overlap window since offsets update before the browser paints the stale positions

Change:
```typescript
// Before
const RESIZE_THROTTLE_MS = 80;
const pendingHeightsRef = useRef<Map<number, number>>(new Map());
const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// ... in ResizeObserver callback:
if (resizeTimerRef.current === null) {
  resizeTimerRef.current = setTimeout(() => {
    resizeTimerRef.current = null;
    // ... flush
  }, RESIZE_THROTTLE_MS);
}

// Cleanup:
clearTimeout(resizeTimerRef.current);
```

To:
```typescript
// After
const pendingHeightsRef = useRef<Map<number, number>>(new Map());
const rafIdRef = useRef<number | null>(null);

// ... in ResizeObserver callback:
if (rafIdRef.current === null) {
  rafIdRef.current = requestAnimationFrame(() => {
    rafIdRef.current = null;
    // ... flush (same logic)
  });
}

// Cleanup:
cancelAnimationFrame(rafIdRef.current);
```

This is a minimal, targeted change. The batching behavior is preserved (multiple ResizeObserver entries within a frame still get collected into `pendingHeightsRef` and flushed together), but the flush happens at the next animation frame rather than 80ms later.

### Phase 2: Verify streaming behavior

The 80ms throttle was likely added to batch rapid height changes during streaming (when content grows token-by-token). With `requestAnimationFrame`, we flush once per frame (~60fps = every 16ms) instead of every 80ms. This is ~5x more frequent but:
- ResizeObserver already batches per frame, so we're not doing extra work
- `setItemHeights` is O(n) where n = items after the changed one, but this is fast (<1ms for typical thread sizes)
- The prefix-sum rebuild is the same work either way, just spread across more frames

Confirm during testing that streaming threads don't show jank or excessive re-renders. If needed, can add a frame-skip counter (e.g., flush every 2nd or 3rd frame) but this is unlikely to be necessary.

## Files to modify

- `src/hooks/use-virtual-list.ts` — Replace setTimeout throttle with rAF (lines 239-293)
