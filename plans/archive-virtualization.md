# Archive View Virtualization

## Problem

The archive view (`src/components/content-pane/archive-view.tsx`) renders all archived threads in a flat `.map()` loop with no virtualization or pagination. As the archive grows, this will degrade performance — every row mounts, hooks fire per-row (`useRelativeTime`), and the entire list lives in the DOM.

## Approach

Use `@tanstack/react-virtual` (already installed) to virtualize the archive list. This is the better fit because:

- Archive rows are **fixed height** (~44px) — no variable-height measurement needed
- `@tanstack/react-virtual` is already used for the same pattern in `logs-page.tsx`
- `react-virtuoso` is overkill here (it's designed for variable-height + auto-scroll-follow)

Sorting by `updatedAt` descending is preserved — the data is sorted once after loading, then the virtualizer just renders a window over the sorted array.

## Phases

- [x] Virtualize the archive list with @tanstack/react-virtual
- [x] Move `useRelativeTime` out of per-row rendering to avoid hook-per-row overhead
- [x] Verify optimistic unarchive still works correctly with virtualized list

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Virtualize the archive list

**File:** `src/components/content-pane/archive-view.tsx`

Replace the current rendering:

```tsx
// Before
<div className="h-full overflow-y-auto">
  <div className="p-3 space-y-0.5">
    {threads.map((thread) => (
      <ArchivedThreadRow ... />
    ))}
  </div>
</div>
```

With `useVirtualizer` from `@tanstack/react-virtual`, following the same pattern as `logs-page.tsx`:

```tsx
const ROW_HEIGHT = 44;
const OVERSCAN = 15;

const scrollRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
  count: threads.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: OVERSCAN,
});
```

Render with the standard virtual container pattern:

```tsx
<div ref={scrollRef} className="h-full overflow-y-auto">
  <div
    className="relative p-3"
    style={{ height: virtualizer.getTotalSize() }}
  >
    {virtualizer.getVirtualItems().map((virtualRow) => {
      const thread = threads[virtualRow.index];
      return (
        <div
          key={thread.id}
          className="absolute left-0 right-0 px-3"
          style={{
            height: virtualRow.size,
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          <ArchivedThreadRow
            thread={thread}
            isUnarchiving={unarchiving.has(thread.id)}
            onUnarchive={handleUnarchive}
          />
        </div>
      );
    })}
  </div>
</div>
```

## Phase 2: Remove per-row `useRelativeTime` hook

**Problem:** `ArchivedThreadRow` calls `useRelativeTime(thread.updatedAt)` which sets up a timer per row. With virtualization, rows mount/unmount frequently — creating and tearing down timers on every scroll.

**Solution:** Replace per-row `useRelativeTime` with a single formatted timestamp computed from a shared "now" value:

1. In `ArchiveView`, keep a single `now` state that ticks every 60s (or use a shared `useNow()` hook if one exists).
2. Pass `now` as a prop to `ArchivedThreadRow`.
3. In the row, compute the relative time string directly from `thread.updatedAt` and `now` using a pure function (extract the formatting logic from `use-relative-time.ts` into a util like `formatRelativeTime(timestamp, now)`).

This avoids N timers for N visible rows and keeps the row component lightweight.

## Phase 3: Verify optimistic unarchive

The current optimistic update filters the thread out of state:

```tsx
setThreads((prev) => prev.filter((t) => t.id !== threadId));
```

This naturally works with the virtualizer since it reads `threads.length` reactively. When a thread is removed:
- `threads` array shrinks
- `virtualizer.count` updates on next render
- Virtual items re-index

Verify:
- Unarchiving a visible row removes it smoothly (no flash/jump)
- Unarchiving the last row doesn't leave a gap
- Failed unarchive (reload) restores the list correctly
- The virtualizer's scroll position stays stable after removal

No code changes expected here — just manual verification that the virtualizer handles array mutations gracefully. If there are issues, we may need `virtualizer.measure()` after state updates.
