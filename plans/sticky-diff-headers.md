# Sticky Diff File Headers

Make file diff headers stick to the top of the scroll container while scrolling through long diffs, so you always know which file you're looking at.

## Context

The `FileHeader` already has `sticky top-0 z-10` in its class list, but it doesn't work for two reasons:

1. **Card wrapper has `overflow: hidden`** — This creates a new scroll context that prevents sticky from propagating to the outer scroll container. Present in both `DiffFileCard` (`rounded-lg overflow-hidden border`) and `InlineDiffBlock` (`rounded-lg border border-surface-700 overflow-hidden`).

2. **Virtualizer uses absolute positioning** — In the Changes Pane (`changes-diff-content.tsx`), file cards are rendered inside `position: absolute` + `translateY()` wrappers. Sticky only works in normal document flow.

## Approach

Two changes, both required:

### 1. Switch the Changes Pane virtualizer to padding-based flow layout

Instead of positioning each virtual item with `position: absolute` + `translateY`, render items in **normal document flow** with padding above and below to maintain correct scroll height:

```
Current (absolute):
┌─ scroll container ──────────────────┐
│ ┌─ height: totalHeight, relative ─┐ │
│ │  [abs, translateY(100)] Item A   │ │
│ │  [abs, translateY(500)] Item B   │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘

New (flow):
┌─ scroll container ──────────────────┐
│ ┌─ paddingTop: 100px ─────────────┐ │
│ │  Item A  (normal flow)           │ │
│ │  Item B  (normal flow)           │ │
│ └─ paddingBottom: remaining ───────┘ │
└──────────────────────────────────────┘
```

Items in normal flow can use `position: sticky`. The `VirtualList` engine itself doesn't change — it still computes items with `start`/`size`. Only the rendering layer changes.

**Add helpers to `useVirtualList`** — expose `paddingBefore` and `paddingAfter` computed from the items array:

```ts
const paddingBefore = items[0]?.start ?? 0;
const paddingAfter = Math.max(0, totalHeight - (lastItem.start + lastItem.size));
```

### 2. Remove `overflow: hidden` from card wrappers

`overflow: hidden` on a parent kills `position: sticky` for all descendants. The overflow-hidden is only there to clip children to the card's rounded corners — it's not actually containing any overflow.

**Fix**: Remove `overflow-hidden` from the card wrapper and apply border-radius directly to the header (top) and content (bottom) elements. The header already has `rounded-t-lg`. Add `rounded-b-lg` to the content/last-child.

## Phases

- [x] Add `paddingBefore`/`paddingAfter` to `useVirtualList` return value
- [x] Switch `changes-diff-content.tsx` from absolute positioning to flow layout
- [x] Remove `overflow-hidden` from `InlineDiffBlock` card wrapper, apply radius to children
- [x] Add `sticky top-0 z-10` to `InlineDiffHeader`
- [x] Remove `overflow-hidden` from `DiffFileCard` card wrapper, apply radius to children
- [x] Verify `FileHeader` sticky works (already has the classes)
- [x] Add subtle drop shadow to headers when stuck (polish)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## File Changes

### `src/hooks/use-virtual-list.ts`
- Add `paddingBefore` and `paddingAfter` to `UseVirtualListResult`
- Compute from the snapshot's items array

### `src/components/changes/changes-diff-content.tsx`
- Replace absolute-positioned item wrappers with flow layout
- Use `paddingBefore`/`paddingAfter` on the inner container
- Remove `position: relative` and `height: totalHeight` from container
- Items no longer need `position: absolute` / `transform: translateY`

Before:
```tsx
<div style={{ height: totalHeight, position: "relative" }}>
  {items.map((item) => (
    <div style={{ position: "absolute", transform: `translateY(${item.start}px)` }}>
      <InlineDiffBlock ... />
    </div>
  ))}
</div>
```

After:
```tsx
<div style={{ paddingTop: paddingBefore, paddingBottom: paddingAfter }}>
  {items.map((item) => (
    <div ref={measureItem} data-index={item.index}>
      <InlineDiffBlock ... />
    </div>
  ))}
</div>
```

### `src/components/thread/inline-diff-block.tsx`
- Line 181: Remove `overflow-hidden` from `rounded-lg border border-surface-700 overflow-hidden`
- Add `rounded-b-lg` to the content container elements (`DiffContent`, `CollapsibleOutputBlock`)

### `src/components/thread/inline-diff-header.tsx`
- Add `sticky top-0 z-10` to the header's class list (line 57)
- Add conditional `rounded-b-lg` when `isFileCollapsed` is true (header becomes the last child)

### `src/components/diff-viewer/diff-file-card.tsx`
- Lines 54, 73, 208: Remove `overflow-hidden` from `rounded-lg overflow-hidden border border-surface-700`
- Add `rounded-b-lg` to the diff content containers

### `src/components/diff-viewer/file-header.tsx`
- Already has `sticky top-0 z-10` — no changes needed for basic functionality
- Add conditional `rounded-b-lg` when `isCollapsed` is true (header becomes the last child)
- Optional: add a `shadow-md` that activates when stuck

### `src/components/diff-viewer/diff-viewer.tsx`
- This renders `DiffFileCard` in a `flex flex-col gap-4` (normal flow, no virtualization)
- Sticky should work here automatically once `overflow-hidden` is removed from cards

## Edge Cases

- **Z-index**: Headers have `z-10`, ensuring they render above sibling diff content. When file B's header scrolls up to push file A's header, it naturally takes precedence since it comes later in the DOM.
- **Horizontal scroll**: Diff content uses `overflow-x-auto` for long lines. This is on the content div (sibling of the header), not the card wrapper, so it doesn't affect vertical sticky behavior.
- **Collapsed files**: When a file is collapsed, the header is essentially the entire card. Sticky still works — it just won't stick for long since there's no content to scroll through.
- **`measureItem` still works**: The flow layout still uses `data-index` and `ref={measureItem}` for height measurement. The `ResizeObserver` in the hook doesn't care about positioning mode.
