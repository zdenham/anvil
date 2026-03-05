# Fix tab-switch scroll jank

## Problem

When clicking on a tab, the thread content remounts (`key={threadId}` in `thread-content.tsx:376`). The scroll element initializes with `scrollTop = 0`, so VirtualList computes items from the top. Only after `useEffect` fires does ScrollCoordinator scroll to the bottom. The user sees a flash of content at the top before it snaps to the bottom.

## Root Cause

The scroll attachment effect in `use-virtual-list.ts:163` uses `useEffect`, which runs **after** the browser paints. Timeline:

1. First render: `scrollTop = 0`, `viewportHeight = 0` → items = `[]`, but inner div has `height = totalHeight` (estimated)
2. Browser paints empty/top content
3. `useEffect` fires → `list.updateScroll(0, clientHeight)` → items computed for top → re-render
4. ScrollCoordinator's `onContentGrew()` fires → RAF schedules `scrollTo(bottom)`
5. Browser paints bottom content

Steps 2-4 produce visible jank.

## Solution

Change the scroll attachment effect from `useEffect` to `useLayoutEffect`, and pre-set `scrollTop = scrollHeight` when sticky mode is active before calling `list.updateScroll()`.

`useLayoutEffect` runs after DOM mutations but **before** the browser paints. Combined with `useSyncExternalStore` forcing a synchronous re-render when the snapshot changes during a layout effect, the user sees the bottom content on the very first paint.

## Phases

- [x] Change scroll attachment effect to useLayoutEffect with pre-scroll
- [x] Verify no regressions with the other effects remaining as useEffect

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Changes

### `src/hooks/use-virtual-list.ts`

1. Add `useLayoutEffect` to the import from React (line 1)
2. Change the scroll attachment effect at line 163 from `useEffect` to `useLayoutEffect`
3. Inside the effect, when `opts.sticky` is true and `el.scrollHeight > el.clientHeight`, set `el.scrollTop = el.scrollHeight` before calling `list.updateScroll()`:

```ts
useLayoutEffect(() => {
  const el = opts.getScrollElement();
  if (!el) return;

  coordinator.attach(el);

  // Pre-scroll to bottom on mount when sticky, before first paint
  if (opts.sticky && el.scrollHeight > el.clientHeight) {
    el.scrollTop = el.scrollHeight;
  }

  list.updateScroll(el.scrollTop, el.clientHeight);

  // ... rest unchanged (scroll listener, wheel/pointer listeners, cleanup)
}, [list, coordinator, opts.getScrollElement, opts.sticky]);
```

This is a single-line addition (`el.scrollTop = el.scrollHeight`) plus changing `useEffect` → `useLayoutEffect`. The other effects (content growth subscriber at line 207, viewport ResizeObserver at line 216) remain as `useEffect` since they don't affect first-paint scroll position.

## Why this works

- The inner container div always has `height: totalHeight` (sum of estimated/measured heights), so `el.scrollHeight` is valid even before items render
- Setting `scrollTop` in `useLayoutEffect` means the browser will paint with scroll already at bottom
- `list.updateScroll()` with the bottom scrollTop causes `useSyncExternalStore` to detect a changed snapshot and force a synchronous re-render with the correct bottom items — all before the browser paints
- For threads that fit in the viewport (`scrollHeight <= clientHeight`), the condition is skipped and nothing changes
