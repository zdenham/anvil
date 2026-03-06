# Fix Thread Scroll Jitter / Non-Native Feel

## Problem

The thread scroller when idle (not running) feels jittery and non-native. The user describes it as a subtle but noticeable degradation vs native scroll.

## Root Cause Analysis

After tracing the full scroll pipeline (`message-list.tsx` → `use-virtual-list.ts` → `virtual-list.ts` → `scroll-coordinator.ts`), I identified **6 contributing factors** ranked by likely impact:

### 1. `overflowAnchor: "auto"` conflicts with virtualizer (HIGH)

**File:** `message-list.tsx:94`
```tsx
style={{ height: "100%", overflow: "auto", overflowAnchor: "auto" }}
```

The browser's built-in scroll anchoring tries to keep visible content stable when DOM changes occur above the viewport. But the virtualizer is *also* managing item positions via absolute positioning + `translate3d`. When a ResizeObserver fires during scroll and updates item heights, the browser's scroll anchoring fights the virtualizer's repositioning — both try to "correct" the scroll position, causing visible micro-jitter.

**Fix:** Set `overflowAnchor: "none"` on the scroll container. The virtualizer already handles scroll anchoring via its own offset calculations.

### 2. Measurement → re-render feedback loop during scroll (HIGH)

**File:** `use-virtual-list.ts:246-282` (ResizeObserver) + `use-virtual-list.ts:299-318` (useLayoutEffect)

When scrolling into unmeasured items (or items remounting after being scrolled off-screen):
1. New items mount → ResizeObserver fires → `setItemHeights()`
2. `setItemHeights()` → `_rebuildOffsetsFrom()` → `_invalidate()` → notify subscribers
3. Subscriber notification triggers React re-render
4. `useLayoutEffect` (no deps!) runs on every render, calling `list.setItemHeights()` again
5. If any height changed, another invalidation/render cycle occurs

This creates a cascade: **scroll → mount → measure → recompute offsets → re-render → positions shift → visual stutter**.

The `useLayoutEffect` at line 299 has **no dependency array**, meaning it runs on every single render:
```tsx
useLayoutEffect(() => {
  // Reads offsetHeight for ALL observed elements every render
  const batch: Array<{ index: number; height: number }> = [];
  for (const [index, el] of observed) {
    const height = Math.round(el.offsetHeight);
    ...
  }
  if (batch.length > 0) {
    list.setItemHeights(batch); // Can trigger another render!
  }
});
```

**Fix:**
- Guard the layout-effect measurement so it only runs when items actually changed (track a `dirtyRef` flag set by `measureItem`)
- Suppress re-notification during the synchronous measurement pass (heights confirmed = no change = no re-render)

### 3. No CSS containment on virtual items (MEDIUM)

**File:** `message-list.tsx:101-111`

Each virtual item wrapper has no CSS containment:
```tsx
<div style={{
  position: "absolute",
  top: 0, left: 0, width: "100%",
  transform: `translate3d(0, ${item.start}px, 0)`,
}}>
```

Without `contain: layout style` (or `content-visibility: auto`), every height change inside any item triggers full layout recalculation up the entire tree. With 10+ items visible and ResizeObserver firing on each, this multiplies the layout work.

**Fix:** Add `contain: layout style paint` to each virtual item wrapper. This tells the browser that size/layout changes inside the item don't affect anything outside it, dramatically reducing layout recalculation scope.

### 4. Index-based virtual item keys (MEDIUM)

**File:** `virtual-list.ts:261` — `key: i` (where `i` is the loop variable = item index)

Virtual items are keyed by their list index. When scrolling, items at the top are removed and new ones added at the bottom (or vice versa). Since keys are plain indices, React can't preserve DOM nodes across these additions/removals — it recreates them, causing:
- More DOM churn (destroy + create vs. just move)
- Full component remount (including markdown re-parse)
- More ResizeObserver mount/unmount thrash

**Fix:** Key items by their data index (the actual turn index), which is already available as `item.index`. This way, when turn #5 scrolls out then back in, React can potentially match the DOM node. The current code already uses `item.index` as `data-index`, just not as `key`.

Actually, looking more closely: `key: i` where `i` iterates from `startIndex` to `endIndex` — so `key` IS the data index already. The issue is that `key` is set to `i` in `_computeItems()`, so item.key = item.index. This means keys are stable per-turn-index, which is correct. **This is NOT an issue** — marking as resolved.

### 5. `useScrolling` hook causes DOM mutation every scroll start (LOW)

**File:** `use-scrolling.ts`

Sets `data-scrolling` attribute on the scroll element on every scroll start, removing it 150ms after scroll stops. This DOM attribute mutation during scroll could trigger a style recalc + paint, though the impact is likely small since it only toggles once per scroll gesture (not per scroll event).

**Fix:** Consider using a CSS class toggle via `classList` instead of `setAttribute` for marginally less work, or move to a CSS-only approach with `:hover` scoping. Low priority.

### 6. ReactMarkdown re-parsing on remount (LOW-MEDIUM)

**File:** `markdown-renderer.tsx`

When items scroll off-screen and back, the full `ReactMarkdown` + `remarkGfm` pipeline re-runs. For large assistant messages with many code blocks, this is non-trivial CPU work during scroll. However, `memo` on the component means re-renders of already-mounted items skip the expensive work.

**Fix:** Could cache parsed markdown ASTs per message content hash, but this is complex and the impact is only on initial mount during scroll. **Out of scope for this plan** — consider only if other fixes don't resolve the jitter.

---

## Code Review Verdicts

### 1. `overflowAnchor: "none"` — PURSUE (one-line fix, clear win)

Confirmed: the virtualizer owns all positioning via absolute + translate3d, and `VirtualList._rebuildOffsetsFrom()` recalculates offsets when heights change. Browser scroll anchoring is redundant and fights the virtualizer. No downside — the virtualizer doesn't rely on browser anchoring at all.

### 2. Guard the every-render `useLayoutEffect` — PURSUE (with corrected diagnosis)

The original analysis overstates the "feedback loop" — `setItemHeights()` already has an `if (!anyChanged) return` guard (`virtual-list.ts:119`), so if heights match what's stored, no invalidation occurs. The loop self-terminates after one extra render.

**The real cost:** the layout effect runs on *every* render and calls `el.offsetHeight` for *every* observed element. This forces a synchronous layout reflow. During scroll, this means every render (triggered by scroll position updates) pays a forced-layout tax even when no heights changed. A `dirtyRef` flag set by `measureItem` would skip the entire loop when nothing was added/remounted.

### 3. CSS `contain` on virtual items — PURSUE `layout style` ONLY (skip `paint`)

`contain: layout style` is safe and beneficial — tells the browser height changes inside an item don't affect siblings. However, `paint` clips overflow, and `inline-diff-header.tsx` uses `<Tooltip>` components inside items. Unless those tooltips use a portal (needs verification), `paint` would clip them. Safer to start with `contain: layout style` and add `paint` only after confirming portals.

### 4. Index-based keys — ALREADY CORRECT (no action needed)

Original plan already noted this: `key: i` where `i` iterates `startIndex..endIndex` in `_computeItems()`, so `item.key === item.index` (the data/turn index). Keys are stable per-turn. No issue.

### 5. `useScrolling` DOM mutation — PURSUE (easy, low-risk)

Slightly worse than described: `setAttribute("data-scrolling", "")` is called on **every scroll event** (not just the first), since the handler fires per event and only the removal is debounced. While browsers may optimize same-value setAttribute, it's still a DOM mutation per scroll frame that can trigger style recalc (the `[data-scrolling]` selector in `index.css` matches against it).

Fix: track a boolean flag, only call `setAttribute` on the first event and `removeAttribute` on timeout. Or use `classList.add/remove` which is explicitly a no-op for already-present classes.

### 6. ReactMarkdown re-parsing — SKIP (out of scope, complex, low ROI)

Agreed with original assessment. `memo` prevents re-renders of mounted items. The cost is only on remount during scroll, which the other fixes (especially #2 and #3) will reduce.

---

## Phases

- [x] Fix `overflowAnchor` conflict — set to `"none"` on scroll container
- [x] Guard the every-render `useLayoutEffect` measurement — add dirty tracking so it only reads DOM when items actually changed
- [x] Add CSS `contain: layout style` to virtual item wrappers (no `paint` — tooltips may not portal)
- [x] Fix `useScrolling` to only mutate DOM on state transitions (not every scroll event)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Files

| File | Role |
|------|------|
| `src/components/thread/message-list.tsx` | Scroll container + virtual item rendering |
| `src/hooks/use-virtual-list.ts` | React adapter: scroll listeners, ResizeObserver, measurement |
| `src/lib/virtual-list.ts` | Pure math engine: heights, offsets, visible range |
| `src/lib/scroll-coordinator.ts` | Auto-scroll / sticky logic |
| `src/hooks/use-scrolling.ts` | `data-scrolling` attribute toggle |
| `src/index.css` | Global scroll/scrollbar styles |
