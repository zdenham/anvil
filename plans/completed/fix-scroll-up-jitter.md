# Fix Scroll-Up Jitter (Unmeasured Item Height Compensation)

## Problem

When opening a thread (auto-scrolled to bottom) and scrolling up, visible content jitters. Once you've scrolled to the top and all items have been measured, scrolling in both directions is smooth.

## Root Cause

Items above the viewport are **unmeasured** — they use `estimateHeight: 100`. When you scroll up:

1. New items mount above the viewport → ResizeObserver fires → actual height measured (e.g., 300px)
2. `setItemHeights()` → `_rebuildOffsetsFrom(index)` shifts offsets of ALL items below by the delta (+200px)
3. `scrollTop` stays the same, but the items at `scrollTop` have moved → visible content jumps

**Why it's smooth after reaching the top:** Every item has been measured once. The VirtualList preserves measured heights in `_heights[]`, so subsequent scrolling finds `this._heights[index] === height` → no changes → no offset shifts.

## Why Not Just Adjust scrollTop?

Setting `scrollTop` during active scrolling (especially macOS trackpad inertia) disrupts the browser's scroll momentum — the compositor resets inertia on programmatic scrollTop changes, causing perceptible stutter. This is especially bad on macOS WKWebView (Tauri's engine) where trackpad flicks produce smooth inertial scrolling that would "catch" on every correction.

## Fix: Transform-Based Scroll Compensation

Instead of touching `scrollTop` during active scrolling, apply a CSS `transform` on the inner container to visually counteract the offset shift. Then absorb the correction into `scrollTop` only when scrolling has stopped.

### How It Works

When items above the viewport are measured with different heights:

1. `setItemHeights()` calculates the **anchor offset delta** — how much the first visible item shifted
2. This delta is accumulated as `scrollCorrection` inside VirtualList
3. The inner container renders with `transform: translateY(-scrollCorrection)`, shifting all content back
4. Visual result: items stay at their old screen positions despite having new offset values
5. When scrolling stops (debounced 150ms), correction is absorbed: `scrollTop += correction`, transform removed

**Key property:** The correction is applied in the same React render as the new item positions (both are in the snapshot). The browser paints both changes atomically — no intermediate jitter frame.

### Math Verification

When item 49 grows from estimated 100px to measured 200px (correction = +100):

| Item | Offset (old) | Offset (new) | Visual pos (new - correction) |
|------|-------------|-------------|-------------------------------|
| 49   | 4900        | 4900        | 4900 - 100 = 4800 (grows upward, out of view) |
| 50   | 5000        | 5100        | 5100 - 100 = 5000 ✓ (stable) |
| 51   | 5100        | 5200        | 5200 - 100 = 5100 ✓ (stable) |

### VirtualList changes (`src/lib/virtual-list.ts`)

**New field:**
```typescript
private _scrollCorrection = 0;
```

**Modify `setItemHeights()` to accumulate correction:**
```typescript
setItemHeights(entries: Array<{ index: number; height: number }>): void {
  // 1. Find anchor (first item at or past scrollTop)
  const anchorIndex = this._binarySearchOffset(this._scrollTop);
  const anchorOffsetBefore = this._offsets[anchorIndex];

  // 2. Apply height changes (existing logic — unchanged)
  let minChanged = this._count;
  let anyChanged = false;
  for (const { index, height } of entries) { ... }
  if (!anyChanged) return;
  this._rebuildOffsetsFrom(minChanged);

  // 3. Accumulate correction
  this._scrollCorrection += this._offsets[anchorIndex] - anchorOffsetBefore;

  this._invalidate();
}
```

**New getter for snapshot:**
```typescript
get scrollCorrection(): number {
  return this._scrollCorrection;
}
```

**New method for absorption:**
```typescript
absorbScrollCorrection(): number {
  const correction = this._scrollCorrection;
  if (correction === 0) return 0;
  this._scrollCorrection = 0;
  this._invalidate();
  return correction;
}
```

### Snapshot changes (`use-virtual-list.ts`)

Add `scrollCorrection` to `VirtualSnapshot`:
```typescript
interface VirtualSnapshot {
  items: VirtualItem[];
  totalHeight: number;
  isAtBottom: boolean;
  scrollCorrection: number;  // new
}
```

Include in `getSnapshot()` and `snapshotEqual()`. Return from the hook.

### Absorption on scroll idle (`use-virtual-list.ts`)

Add a debounced absorption timer to the scroll event handler:
```typescript
const absorptionTimerRef = useRef<number | null>(null);

// Inside the scroll event handler:
const onScroll = () => {
  list.updateScroll(el.scrollTop, el.clientHeight);
  // ... existing sticky logic ...

  // Schedule correction absorption when scrolling stops
  if (list.scrollCorrection !== 0 && !coordinator.isSticky) {
    if (absorptionTimerRef.current !== null) {
      clearTimeout(absorptionTimerRef.current);
    }
    absorptionTimerRef.current = window.setTimeout(() => {
      absorptionTimerRef.current = null;
      const correction = list.absorbScrollCorrection();
      if (correction !== 0) {
        el.scrollTop += correction;
      }
    }, 150);
  }
};
```

The 150ms debounce ensures absorption only happens after all scroll events (including inertia ticks) have stopped. On macOS, trackpad inertia fires scroll events continuously — the timer resets on each one.

### message-list.tsx changes

Apply the correction transform on the inner container:
```tsx
const { items, totalHeight, scrollCorrection, ... } = useVirtualList({ ... });

<div style={{
  height: totalHeight,
  position: "relative",
  transform: scrollCorrection !== 0 ? `translateY(${-scrollCorrection}px)` : undefined,
}}>
```

The `transform` only affects compositing (no layout reflow), so it's cheap to apply/remove during scroll.

## Phases

- [x] Add `_scrollCorrection` tracking to VirtualList — anchor-based delta in `setItemHeights()`, getter, and `absorbScrollCorrection()` method
- [x] Add `scrollCorrection` to VirtualSnapshot, return from `useVirtualList`, add debounced absorption in scroll handler
- [x] Apply correction transform in `message-list.tsx` inner container
- [ ] Test: verify scrolling up from bottom no longer jitters, sticky auto-scroll still works, correction absorbs on scroll idle

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Files

| File | Change |
|------|--------|
| `src/lib/virtual-list.ts` | `_scrollCorrection` field, accumulation in `setItemHeights()`, getter, absorb method |
| `src/hooks/use-virtual-list.ts` | `scrollCorrection` in snapshot, debounced absorption on scroll idle |
| `src/components/thread/message-list.tsx` | `transform: translateY(-correction)` on inner container |

## Edge Cases

- **Correction when scrollTop=0**: Anchor is item 0, offsets[0]=0 always → correction=0. Correct.
- **All items already measured**: `setItemHeights` exits early (`!anyChanged`), no correction accumulated.
- **Items in overscan above viewport**: Temporarily shifted by the global correction, but they're not visible and will be correct after absorption.
- **User scrolls back to bottom before absorption**: Sticky mode re-engages → auto-scroll overrides → correction can be absorbed immediately (clear correction when sticky re-engages).
- **Large accumulated correction**: If the user scrolls the entire list from bottom to top, correction could be large. Absorption on scroll idle handles this — each pause absorbs the full accumulated correction.
- **Concurrent measurement + absorption**: If ResizeObserver fires during the absorption timeout, the new correction accumulates normally. The absorption timer resets via debounce.
