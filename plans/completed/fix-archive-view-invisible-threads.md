# Fix: Archived threads not visible in ArchiveView

## Problem

The archive view shows "232 archived threads" in the header but renders zero rows. Data is fetched correctly — this is purely a rendering bug.

## Root Cause

`ArchiveView` (`src/components/content-pane/archive-view.tsx`) has early returns for `loading` (line 120) and empty states (line 128) that prevent the scroll container `<div ref={scrollRef}>` from mounting during initial load.

The `useVirtualList` hook (`src/hooks/use-virtual-list.ts`) attaches its scroll listener + ResizeObserver via `useLayoutEffect` (line 170) and `useEffect` (line 229), both gated on `opts.getScrollElement`. On first render, `getScrollElement()` returns `null` (the div doesn't exist yet). Since `getScrollElement` is a stable `useCallback(() => scrollRef.current, [])`, these effects never re-run when the div finally appears.

Result: `VirtualList._viewportHeight` stays `0`, so `_computeItems()` (line 253 of `virtual-list.ts`) returns `[]` — no rows render.

## Fix

Restructure `ArchiveView` so the scroll container `<div ref={scrollRef}>` is **always rendered**, with loading/empty states shown inside it instead of as early returns. This ensures `scrollRef.current` is non-null when `useLayoutEffect` runs on mount.

## Phases

- [x] Restructure ArchiveView to always render the scroll container

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

In `src/components/content-pane/archive-view.tsx`, replace the early-return pattern:

```tsx
// BEFORE (broken):
if (loading) {
  return (<div className="..."><Loader2 .../></div>);
}
if (threads.length === 0) {
  return (<div className="..."><p>No archived threads</p></div>);
}
return (
  <div className="flex flex-col h-full">
    <div className="...header...">{total} archived threads</div>
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      ...virtualizer rows...
    </div>
  </div>
);
```

With a single return that always mounts the scroll container:

```tsx
// AFTER (fixed):
return (
  <div data-testid="archive-view" className="flex flex-col h-full">
    {!loading && threads.length > 0 && (
      <div className="px-4 py-2 text-xs text-surface-500 border-b border-surface-800">
        {total.toLocaleString()} archived threads
      </div>
    )}
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center h-full text-surface-500">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : threads.length === 0 ? (
        <div className="flex items-center justify-center h-full text-surface-500">
          <p className="text-sm">No archived threads</p>
        </div>
      ) : (
        <>
          <div className="relative p-3" style={{ height: totalHeight }}>
            {items.map((item) => {
              const thread = threads[item.index];
              return (
                <div
                  key={thread.id}
                  className="absolute left-0 right-0 px-3"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <ArchivedThreadRow ... />
                </div>
              );
            })}
          </div>
          {loadingMore && (
            <div className="flex justify-center py-3">
              <Loader2 size={16} className="animate-spin text-surface-500" />
            </div>
          )}
        </>
      )}
    </div>
  </div>
);
```

This is the only file that needs to change. The scroll container exists from mount, so `useVirtualList` attaches correctly on the first render pass.
