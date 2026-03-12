# Fix scroll position after collapsing diff panel card

## Problem

When a diff card is collapsed in the Changes pane, the viewport jumps several files away instead of showing the collapsed card at the top. This is jarring and disorienting.

## Root Cause

The virtual list (`use-virtual-list.ts`) uses an anchor-based scroll correction system. When a card's height changes (via `ResizeObserver` → `VirtualList.setItemHeights()`), it finds the "anchor" item (first item at `scrollTop`) and adjusts `scrollTop` to keep that anchor visually stable.

When a diff card collapses from \~1000px to \~40px (just the header), the correction keeps the anchor stable — but the massive height reduction causes the viewport to suddenly show content far below the collapsed card. The user loses their place.

## Desired Behavior

After collapsing a card, the scroll position should snap so the collapsed card's header is at the top of the viewport.

## Solution

Modify `ChangesDiffContent` to scroll to the collapsed card after the height change settles.

## Phases

- [x] Add scroll-to-collapsed-card logic in `changes-diff-content.tsx`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation

**File:** `src/components/changes/changes-diff-content.tsx`

1. Add a `useRef<number | null>(null)` to track the index of the card that was just collapsed
2. In `toggleCollapsed`, when adding to the collapsed set (i.e., collapsing), store the index in the ref
3. Add a `useEffect` watching `collapsedFiles` that, when a pending collapse is recorded:
   - Clears the ref
   - Waits two `requestAnimationFrame` ticks (to ensure the ResizeObserver has fired and the virtual list's scroll correction has been applied)
   - Calls `scrollToIndex({ index, align: 'start', behavior: 'instant' })` to snap the collapsed card to the viewport top

The double-RAF is needed because:

- Frame 1: React has committed the DOM update (card content hidden), ResizeObserver fires
- Frame 2: The RAF in the ResizeObserver callback runs `list.setItemHeights()` and applies correction
- Our scroll override then runs, snapping to the correct position

`scrollToIndex` with `align: 'start'` computes `offsets[index]` — since the collapsed card's offset doesn't change (only items below it shift), this is accurate even during the transition.

### Sketch

```typescript
const pendingCollapseRef = useRef<number | null>(null);

const toggleCollapsed = useCallback((index: number) => {
  setCollapsedFiles((prev) => {
    const next = new Set(prev);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
      pendingCollapseRef.current = index;
    }
    return next;
  });
}, []);

useEffect(() => {
  const index = pendingCollapseRef.current;
  if (index === null) return;
  pendingCollapseRef.current = null;

  // Wait for ResizeObserver + correction to settle, then override scroll
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToIndex({ index, align: "start", behavior: "instant" });
    });
  });
}, [collapsedFiles, scrollToIndex]);
```

### Edge Cases

- **Expanding** a card: no scroll adjustment needed (ref stays `null`)
- **Card already at viewport top**: `scrollToIndex` is a no-op since scrollTop already equals the card's offset
- **Momentum scrolling active**: the double-RAF ensures we override after the transform-based correction is applied; `behavior: 'instant'` avoids competing with smooth scroll animations