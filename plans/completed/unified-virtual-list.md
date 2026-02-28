# Unified Virtual List — Replace react-virtuoso + @tanstack/react-virtual

## Goal

Replace both `react-virtuoso` (~92KB) and `@tanstack/react-virtual` (~14KB) with a single in-house `VirtualList` class + thin `useVirtualList` hook (~5-8KB) that covers all 6 call sites in the codebase.

## Phases

- [x] Build `VirtualList` class with fixed-height mode + `useVirtualList` hook adapter
- [x] Add variable-height mode with ResizeObserver
- [x] Add `followOutput` / streaming scroll-follow
- [x] Migrate the 4 fixed-height consumers (tanstack)
- [x] Migrate the 2 variable-height consumers (virtuoso)
- [x] Remove both dependencies, verify bundle reduction
- [x] Write tests for VirtualList class (pure unit tests, no React)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

### Core: `VirtualList` class

**File:** `src/lib/virtual-list.ts`

Framework-agnostic. Owns all the math, height caching, and scroll logic. No React imports.

```ts
interface VirtualListOptions {
  /** Total item count */
  count: number;
  /** Fixed height — skips ResizeObserver entirely */
  itemHeight?: number | ((index: number) => number);
  /** Estimated height — enables measurement mode */
  estimateHeight?: number;
  /** Extra pixels to render above/below viewport */
  overscan?: number;
  /** Distance from bottom to count as "at bottom" */
  atBottomThreshold?: number;
}

interface VirtualItem {
  index: number;
  start: number;   // translateY offset
  size: number;     // measured or fixed height
  key: number;
}

interface ScrollToOptions {
  index: number | "LAST";
  align?: "start" | "center" | "end";
  behavior?: ScrollBehavior;
}

class VirtualList {
  constructor(opts: VirtualListOptions)

  // --- Inputs (call these to feed state in) ---

  /** Call on scroll events */
  updateScroll(scrollTop: number, viewportHeight: number): void
  /** Call when item count changes */
  setCount(count: number): void
  /** Call when an item's measured height changes (variable-height mode) */
  setItemHeight(index: number, height: number): void
  /** Batch update multiple item heights at once */
  setItemHeights(entries: Array<{ index: number; height: number }>): void
  /** Update options (overscan, threshold, etc.) */
  setOptions(opts: Partial<VirtualListOptions>): void

  // --- Outputs (read computed state) ---

  /** Items in the current render window */
  get items(): VirtualItem[]
  /** Total scrollable height */
  get totalHeight(): number
  /** Whether the scroll position is at the bottom */
  get isAtBottom(): boolean

  /** Compute the scrollTo position for an index. Does NOT perform the scroll — the caller (hook) owns the DOM. */
  getScrollTarget(opts: ScrollToOptions): { top: number; behavior: ScrollBehavior }

  // --- Subscriptions ---

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(cb: () => void): () => void
}
```

Key design: The class never touches the DOM. It receives scroll position and measured heights as inputs, and emits computed virtual items as output. The React adapter owns all DOM interaction (scroll listeners, ResizeObserver, scrollTo calls).

### React adapter: `useVirtualList` hook

**File:** `src/hooks/use-virtual-list.ts`

Thin wiring layer. Responsibilities:
1. Create and hold a `VirtualList` instance in a ref
2. Attach scroll listener on `getScrollElement()` → calls `list.updateScroll()`
3. Attach ResizeObserver on scroll container for viewport size changes
4. In variable-height mode: attach ResizeObserver on item container via `measureRef`, walk children by `data-index`, call `list.setItemHeights()`
5. Sync `list.setCount()` when count prop changes
6. Subscribe via `useSyncExternalStore(list.subscribe, () => list.items)`
7. Expose `scrollToIndex()` that calls `list.getScrollTarget()` then `element.scrollTo()`
8. Wire `followOutput` and `onAtBottomChange` callbacks

```ts
interface UseVirtualListOptions {
  count: number;
  getScrollElement: () => HTMLElement | null;
  itemHeight?: number | ((index: number) => number);
  estimateHeight?: number;
  overscan?: number;
  onAtBottomChange?: (atBottom: boolean) => void;
  atBottomThreshold?: number;
  followOutput?: (atBottom: boolean) => ScrollBehavior | false;
}

interface UseVirtualListResult {
  items: VirtualItem[];
  totalHeight: number;
  scrollToIndex: (opts: ScrollToOptions) => void;
  /** Ref callback — attach to the item container div (variable-height mode only) */
  measureRef: (el: HTMLElement | null) => void;
  isAtBottom: boolean;
  /** The VirtualList instance, for escape hatches */
  list: VirtualList;
}
```

### Usage — Fixed Height (logs, archive, search, diff viewer)

```tsx
const { items, totalHeight, scrollToIndex } = useVirtualList({
  count: logs.length,
  getScrollElement: () => scrollRef.current,
  itemHeight: 24,
  overscan: 10,
});

return (
  <div ref={scrollRef} className="overflow-auto h-full">
    <div style={{ height: totalHeight, position: "relative" }}>
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: item.size,
            transform: `translateY(${item.start}px)`,
          }}
        >
          <LogRow log={logs[item.index]} />
        </div>
      ))}
    </div>
  </div>
);
```

### Usage — Variable Height with Streaming (message list)

```tsx
const { items, totalHeight, scrollToIndex, measureRef, isAtBottom } = useVirtualList({
  count: turns.length,
  getScrollElement: () => scrollerRef.current,
  estimateHeight: 100,
  overscan: 200,
  atBottomThreshold: 300,
  onAtBottomChange: setIsAtBottom,
  followOutput: (atBottom) => (isStreaming && atBottom ? "smooth" : false),
});

return (
  <div ref={scrollerRef} className="overflow-auto h-full">
    <div ref={measureRef} style={{ height: totalHeight, position: "relative" }}>
      {items.map((item) => (
        <div key={item.key} data-index={item.index} style={{ ... }}>
          <TurnRenderer turn={turns[item.index]} />
        </div>
      ))}
    </div>
    {/* Footer rendered after the spacer, outside the virtual list */}
    <Footer />
  </div>
);
```

Footer lives outside the virtual container as a sibling after the spacer div. Simpler than virtuoso's `components.Footer` and achieves the same result.

---

## Implementation Details

### Phase 1: VirtualList class — fixed-height mode

**File:** `src/lib/virtual-list.ts`

Core math for fixed heights:

```
startIndex = max(0, floor(scrollTop / itemHeight) - overscanItems)
endIndex   = min(count - 1, ceil((scrollTop + viewportHeight) / itemHeight) + overscanItems)
```

Where `overscanItems = ceil(overscanPx / itemHeight)`.

For the `itemHeight: (index) => number` variant (search results with 22/24px rows), compute prefix sums on construction and when count changes. Binary search for the start index.

Internal state:
- `scrollTop: number`
- `viewportHeight: number`
- `count: number`
- `heights: number[]` — per-item heights (or computed from fixed)
- `offsets: number[]` — prefix sums (offset[i] = sum of heights[0..i-1])
- `listeners: Set<() => void>` — for `subscribe()`

`getScrollTarget()`: look up `offsets[index]`, apply alignment math (`start` = offset, `center` = offset - viewportHeight/2 + size/2, `end` = offset - viewportHeight + size), return `{ top, behavior }`.

**Also in this phase:** `src/hooks/use-virtual-list.ts` — the React adapter. Wire scroll listener and viewport ResizeObserver. Use `useSyncExternalStore` for subscription.

### Phase 2: Variable-height mode with ResizeObserver

Steal virtuoso's pattern: **one ResizeObserver on the item container**, not per-item.

In the hook adapter:
1. `measureRef` callback stores the container element
2. Attach a single `ResizeObserver` to that container
3. On resize callback, walk `container.children`, read each child's `offsetHeight`
4. Compare against cached heights by `data-index` attribute
5. Call `list.setItemHeights(changedEntries)` with only the items that changed
6. `VirtualList.setItemHeights()` updates `heights[]`, recomputes `offsets[]` from the first changed index forward, notifies subscribers

Height cache in the class: plain `number[]` indexed by item index. Default to `estimateHeight` for unmeasured items. Prefix sum array for O(1) offset lookup, partial rebuild from first changed index when heights update.

**Avoid layout thrashing:** ResizeObserver fires asynchronously after layout. We read heights, update state, React re-renders, browser re-layouts. One read + one write cycle. Wrap in `requestAnimationFrame` by default (configurable — streaming may want immediate).

### Phase 3: followOutput / streaming scroll-follow

Implemented in the hook adapter (not the class — it requires DOM scrolling):

1. Track `isAtBottom` in the class (already computed from scroll state)
2. Hook watches for count increases or height changes via subscription
3. When items are added/grow and `isAtBottom` was true before the change:
   - Call `followOutput(true)` — if it returns a `ScrollBehavior`, call `scrollElement.scrollTo({ top: list.totalHeight, behavior })`
4. Wire `onAtBottomChange` callback to fire when `list.isAtBottom` transitions

**Scroll compensation during item growth:** When an item at the bottom grows (streaming tokens), we're already following — just scroll to bottom. When an item *above* the viewport grows, `scrollTop` stays the same but offsets shift — the viewport content appears to jump down. Virtuoso compensates by adjusting `scrollTop`. For our chat use case, above-viewport resizes are rare (messages don't change after render). Defer this to a follow-up if needed.

### Phase 4: Migrate fixed-height consumers

Straightforward 1:1 replacements:

| File | `itemHeight` | `overscan` | Notes |
|------|-------------|------------|-------|
| `logs-page.tsx` | `24` | `10` | Uses `scrollToIndex` for auto-scroll |
| `archive-view.tsx` | `44` | `15` | Basic render only |
| `virtualized-results.tsx` | `(i) => isHeader(i) ? 24 : 22` | `15` | Function-based height |
| `virtualized-file-content.tsx` | `24` | `20` | Basic render only |

Each migration:
1. Replace `useVirtualizer` import with `useVirtualList`
2. Map `virtualizer.getVirtualItems()` → `items`
3. Map `virtualizer.getTotalSize()` → `totalHeight`
4. Map `virtualizer.scrollToIndex(i, opts)` → `scrollToIndex({ index: i, ...opts })`
5. `estimateSize` → `itemHeight`

### Phase 5: Migrate variable-height consumers

**`message-list.tsx`:**
- Replace `Virtuoso` component with hook + div structure
- `scrollerRef` callback → use `getScrollElement` ref directly
- `followOutput` → same prop, same callback shape
- `atBottomStateChange` → `onAtBottomChange`
- `components.Footer` → render as sibling after the spacer div
- `initialTopMostItemIndex` → call `scrollToIndex` in a `useLayoutEffect` on mount
- Add `data-index` attribute on each item div (needed for ResizeObserver measurement)
- Add `measureRef` to the item container div

**`changes-diff-content.tsx`:**
- Replace `Virtuoso` component with hook + div structure
- `increaseViewportBy={400}` → `overscan: 400`
- `components.Footer` → render as sibling after spacer
- Simpler than message-list — no streaming, no follow
- Add `data-index` + `measureRef`

### Phase 6: Remove dependencies

```bash
pnpm remove react-virtuoso @tanstack/react-virtual
```

Verify no remaining imports. Check bundle size delta.

### Phase 7: Tests for VirtualList class

**File:** `src/lib/__tests__/virtual-list.test.ts`

Pure unit tests — no React, no DOM mocking needed for the class itself:

- Fixed-height: correct item range for given scrollTop/viewportHeight
- Fixed-height with function: prefix-sum binary search yields correct range
- `getScrollTarget` with start/center/end alignment
- `getScrollTarget({ index: "LAST" })` returns correct offset
- `isAtBottom` state transitions
- `setCount` resizes internal arrays, preserves measured heights
- `setItemHeights`: updates offsets, notifies subscribers
- `subscribe`/unsubscribe lifecycle

The hook adapter is thin enough that manual testing covers it. If we want automated hook tests later, they're a separate concern.

---

## Risk Mitigation

**Biggest risk: streaming scroll jank in message-list.** If the replacement has any perceptible difference in scroll behavior during streaming, it'll be immediately noticeable. Mitigation:
- Build phase 3 (followOutput) and phase 5 (message-list migration) as a pair
- Test side-by-side with a long streaming conversation before removing virtuoso
- Keep `react-virtuoso` in the dependency list until the message-list migration is validated

**Second risk: ResizeObserver timing.** If measurement is delayed by a frame, the list may briefly show items at estimated positions then jump. Virtuoso handles this by deferring to rAF. We do the same. The `followOutput` scroll-to-bottom masks this for streaming since the user is always at the bottom anyway.

---

## What We're NOT Building

- Grid/horizontal mode
- Grouped/sticky headers
- Table mode
- Prepend/shift (reverse infinite scroll)
- Window scroller (nested scroll containers)
- Scroll compensation for above-viewport resizes (defer unless needed)

This keeps scope tight. If any of these become needed later, they can be added incrementally.
