# Fix Scroll-Up Jitter v2 — Flow-Based Layout

## The Deep Problem

The virtualizer uses **absolute positioning** (`position: absolute` + `transform: translate3d`) for each item. This is architecturally wrong for variable-height lists with scroll-up behavior.

**Why absolute positioning causes jitter:**

1. Items are pulled out of document flow — the browser has no idea how they relate
2. JS owns ALL positioning via calculated offsets. When any height changes, `_rebuildOffsetsFrom()` recalculates offsets for every item below, triggering a React re-render with new transform values
3. `overflowAnchor: "none"` had to be set because browser scroll anchoring *fights* absolute positioning — but scroll anchoring is the exact mechanism designed to solve this
4. Every height correction is a JS → React render → repaint cycle, which is inherently visible during active scrolling

**The hook already computes `paddingBefore` and `paddingAfter`** (`use-virtual-list.ts:373-376`) but `message-list.tsx` ignores them and uses absolute positioning. The flow-based infrastructure is half-built.

## Previous Attempt (Reverted)

`fix-scroll-up-jitter.md` tried transform-based scroll compensation on top of absolute positioning — accumulating deltas, applying a counter-transform, then absorbing into scrollTop. This layered a hack on top of the fundamental problem. The absorption step caused a visible jolt.

## Fix: Switch to Flow-Based Layout

Items render in **normal document flow**, sandwiched between padding spacers. No absolute positioning, no transform-based positioning, no manual offset management for layout.

### How It Works

```
┌─ scroll container ──────────────────┐
│ <div style="height: paddingBefore"> │  ← spacer for items above render range
│ <Item index=5 />                    │  ← normal flow, natural height
│ <Item index=6 />                    │
│ <Item index=7 />  ← viewport ──────│
│ <Item index=8 />                    │
│ <Item index=9 />                    │
│ <div style="height: paddingAfter">  │  ← spacer for items below render range
└─────────────────────────────────────┘
```

When scrolling up and a new item mounts with a different height than estimated:
- The browser's layout engine naturally pushes siblings down/up
- scrollTop stays the same, but the content at scrollTop shifts (same problem as before)
- **BUT**: we can apply a scrollTop correction synchronously in the ResizeObserver callback, before the browser paints
- The correction is simpler because we're working with the browser's layout engine, not fighting a parallel positioning system

### WebKit `overflow-anchor` Caveat

On Chromium, `overflow-anchor: auto` would handle this automatically — the browser adjusts scrollTop when content above the anchor changes. But **WebKit (Tauri's WKWebView on macOS) does not support `overflow-anchor`**. So we still need manual correction — but it's much cleaner with flow layout.

### message-list.tsx Changes

**Before (absolute positioning):**
```tsx
<div style={{ height: totalHeight + 30, position: "relative" }}>
  {items.map((item) => (
    <div
      key={item.key}
      ref={measureItem}
      data-index={item.index}
      style={{
        position: "absolute",
        top: 0, left: 0, width: "100%",
        contain: "layout style",
        transform: `translate3d(0, ${item.start}px, 0)`,
      }}
    >
      ...
    </div>
  ))}
</div>
```

**After (flow layout with padding spacers):**
```tsx
<div>
  <div style={{ height: paddingBefore }} />
  {items.map((item) => (
    <div
      key={item.key}
      ref={measureItem}
      data-index={item.index}
      style={{ contain: "layout style" }}
    >
      ...
    </div>
  ))}
  <div style={{ height: paddingAfter + 30 }} />
</div>
```

No `position: absolute`, no `transform`, no `totalHeight` container. Just padding spacers + normal flow. The `paddingBefore`/`paddingAfter` values are already computed by the hook.

### Scroll Correction for WebKit

Since WebKit lacks `overflow-anchor`, we need manual correction when items above the viewport change height. This happens in the ResizeObserver callback — synchronous, pre-paint:

**VirtualList changes:**

```typescript
// setItemHeights returns the correction delta for the caller
setItemHeights(entries: Array<{ index: number; height: number }>): number {
  // 1. Find anchor (first item at or past scrollTop)
  const anchorIndex = this._binarySearchOffset(this._scrollTop);
  const anchorOffsetBefore = this._offsets[anchorIndex];

  // 2. Apply height changes (existing logic)
  let minChanged = this._count;
  let anyChanged = false;
  for (const { index, height } of entries) { ... }
  if (!anyChanged) return 0;
  this._rebuildOffsetsFrom(minChanged);

  // 3. Calculate correction (how much the anchor shifted)
  const correction = this._offsets[anchorIndex] - anchorOffsetBefore;

  this._invalidate();
  return correction;
}
```

**Hook changes (ResizeObserver callback):**

```typescript
// Inside the ResizeObserver callback, after building the batch:
const correction = list.setItemHeights(batch);
if (correction !== 0) {
  const el = opts.getScrollElement();
  if (el) {
    el.scrollTop += correction;
    list.updateScroll(el.scrollTop, el.clientHeight);
  }
}
```

This is applied pre-paint inside the ResizeObserver callback — the browser hasn't rendered the frame yet, so the scrollTop adjustment is invisible. No transform accumulation, no debounced absorption, no jolt.

### Why This Avoids v1's Jolt

| v1 (Transform Compensation) | v2 (Flow + Immediate Correction) |
|---|---|
| Accumulates correction in a transform | Applies correction immediately in ResizeObserver |
| Debounced absorption sets scrollTop + removes transform | No absorption step — scrollTop adjustment is the only step |
| Absorption fires during trackpad inertia → jolt | Correction is per-item, small, pre-paint → invisible |
| Two-phase (transform then absorb) requires both to land in same paint | Single-phase (just scrollTop) — atomic |

### Other Virtualizer Consumers

Only `message-list.tsx` uses variable-height mode and has this problem. The fixed-height consumers (logs, archive, search results, diff viewer) can stay with absolute positioning — they don't have measurement-induced jitter because heights are known upfront.

If we want consistency, those can migrate to flow layout too, but it's not necessary for correctness.

## Phases

- [ ] Switch message-list.tsx from absolute positioning to flow layout with paddingBefore/paddingAfter spacers
- [ ] Change `setItemHeights()` to return the anchor correction delta
- [ ] Apply immediate scrollTop correction in the ResizeObserver callback in use-virtual-list.ts
- [ ] Re-enable `overflowAnchor: "auto"` on scroll container (helps on Chromium-based Tauri targets, no-op on WebKit)
- [ ] Verify: scroll up from bottom of long thread — no jitter, no jolt, sticky auto-scroll still works

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Files

| File | Change |
|------|--------|
| `src/components/thread/message-list.tsx` | Replace absolute-positioned items with flow layout + padding spacers |
| `src/lib/virtual-list.ts` | `setItemHeights()` returns correction delta |
| `src/hooks/use-virtual-list.ts` | Apply scrollTop correction in ResizeObserver callback |

## Sticky Headers Are Preserved

`InlineDiffHeader` (`inline-diff-header.tsx:61`) uses `sticky top-0 z-10` to pin file headers while scrolling through long diffs. This works identically with flow layout.

`position: sticky` depends on two things:
1. **Nearest scrolling ancestor** — the `overflow: auto` scroll container (unchanged)
2. **Containing block bounds** — the parent item div constrains when the header unsticks (same natural content height in both layouts)

With absolute positioning, the parent's height comes from its content. With flow layout, same thing. The sticky behavior is identical. In fact, Virtuoso (the library this virtualizer replaced) used flow-based layout and supported sticky headers natively.

No changes needed to `InlineDiffHeader`, `InlineDiffBlock`, or `useIsSticky`.

## Risks & Mitigations

**Risk: Flow layout reflow cost with many visible items**
Items already have `contain: layout style`, which limits reflow scope. With 10-30 visible items (typical for a chat), the cost is negligible. The fixed-height consumers (which can have hundreds of items) keep absolute positioning.

**Risk: scrollTop adjustment during trackpad inertia**
The correction is per-item (typically one item at a time as you scroll up) and small (difference between estimated 100px and actual height). Unlike v1 which accumulated large corrections, each individual correction is small enough to be imperceptible. If still noticeable, we can add a pre-measurement layer as a follow-up.

**Risk: `paddingBefore` accuracy when items unmount**
When items scroll out of the render range, their measured height is already cached in VirtualList's `_heights[]` array. The paddingBefore calculation uses these cached heights, so it remains accurate.
