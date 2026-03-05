# Fix thread panel layout shifts

## Problem

When a completed thread renders (e.g. on tab switch or app launch), the spacing between blocks appears initially larger, then condenses — the whole layout "snaps" tighter after a frame. This happens even with simple, non-scrolling threads containing just markdown, a thinking block, and a Read tool block.

**What the user sees:** Blocks (text, thinking, tool result) render with too much vertical space between them, then after ~80-100ms the gaps shrink and everything shifts up. It looks like the layout is "settling."

## Root Causes

Three systems conspire to produce a two-frame layout:

### 1. Estimated heights paint first, measurements arrive 80ms later

The virtual list uses `estimateHeight: 100` for all items (`message-list.tsx:53`). ResizeObserver measures actual heights, but measurements are **throttled to 80ms** (`use-virtual-list.ts:239`). Timeline:

1. **Frame 1:** Items render at estimated positions (3 items × 100px = 300px total). Browser paints.
2. **+80ms:** ResizeObserver batch fires → actual heights differ (e.g. 60px, 45px, 180px) → `totalHeight` changes → items shift to new `translateY` positions.
3. **Frame 2:** Browser paints correct layout. User sees the shift.

For short threads where all content fits in the viewport, the shift is especially noticeable because items move up (estimates are too high for simple text/thinking blocks) and the total scroll container shrinks. **This is the primary cause of the "spacing condenses" symptom** — the virtual list positions each turn via `translateY(item.start)`, and when estimated heights shrink to actual heights, turns shift upward, visually closing the gaps between them.

Note: The `space-y-1.5` gap between blocks *within* a single turn (`assistant-message.tsx:45`) is static CSS and does not change. The shifting is at the virtual list level (between turns), not within a turn.

### 2. Code syntax highlighting is async with 100ms debounce

`useCodeHighlight` (`use-code-highlight.ts:51`) debounces 100ms then runs async `highlightCode()`. During this window:
- CodeBlock renders unstyled `<pre>{code}</pre>` (plain monospace text)
- After highlighting completes, it re-renders with `<HighlightedCode tokens={...} />`  (individual `<span>` elements per token)

The two renderings can produce different heights due to different DOM structure (single `<pre>` vs. many `<div>` lines with `<span>` tokens). This causes a second ResizeObserver measurement, producing another layout shift ~100-200ms after first paint.

### 3. No initial measurement before first paint

The ResizeObserver is the *only* measurement path. There's no synchronous measurement pass in `useLayoutEffect` for initially-visible items. This means the first paint is *always* wrong for variable-height items — even when all items are visible and their DOM elements exist.

## Phases

- [x] Flush initial ResizeObserver measurements synchronously in useLayoutEffect
- [x] Eliminate code highlight height shift for completed (non-streaming) content

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Flush initial ResizeObserver measurements synchronously

**Goal:** Make the first paint use measured heights, not estimates.

### Approach

Add a `useLayoutEffect` in `use-virtual-list.ts` that runs after mount (when DOM elements exist but before the browser paints). It reads `offsetHeight` for all currently-observed elements and calls `list.setItemHeights()` synchronously.

### Changes in `src/hooks/use-virtual-list.ts`

After the ResizeObserver setup (around line 270), add a layout effect that performs an initial synchronous measurement:

```ts
// Synchronous initial measurement — read heights before first paint
// so the browser never shows estimated-height positions.
useLayoutEffect(() => {
  const observed = observedRef.current;
  if (observed.size === 0) return;

  const batch: Array<{ index: number; height: number }> = [];
  for (const [index, el] of observed) {
    const height = Math.round(el.offsetHeight);
    if (height > 0) {
      batch.push({ index, height });
    }
  }

  if (batch.length > 0) {
    // Clear any pending async measurements for these items
    for (const { index } of batch) {
      pendingHeightsRef.current.delete(index);
    }
    list.setItemHeights(batch);
  }
});
```

This runs on every render (no deps array), which is fine because `setItemHeights` is a no-op when heights haven't changed. The critical path is the initial render: items mount → `measureItem` ref callback fires → elements are observed → this layout effect reads their actual heights → `useSyncExternalStore` forces a synchronous re-render with correct positions → browser paints correct layout on the first frame.

**Why this works:** `useLayoutEffect` with no deps fires after every render, but `measureItem` ref callbacks fire *during* render (before layout effects). So by the time this layout effect runs, `observedRef.current` already contains the newly-mounted elements.

**Cost:** One synchronous `offsetHeight` read per visible item per render. For a typical thread (5-20 visible items), this is ~5-20 layout reads — negligible. The reads are batched (read-only loop followed by a single write via `setItemHeights`), so there's no layout thrashing.

### Also: skip the 80ms throttle for the very first ResizeObserver batch

Add a flag `hasInitialMeasurement` that starts `false`. On the first ResizeObserver callback, flush immediately (skip the `setTimeout`). After that, use the normal 80ms throttle. This handles the case where ResizeObserver fires before our layout effect (shouldn't normally happen, but provides a safety net).

```ts
const hasInitialMeasurementRef = useRef(false);

// In ResizeObserver callback:
if (!hasInitialMeasurementRef.current) {
  // First measurement batch — flush immediately
  hasInitialMeasurementRef.current = true;
  const batch = Array.from(pendingHeightsRef.current.entries())
    .map(([index, height]) => ({ index, height }));
  pendingHeightsRef.current.clear();
  if (batch.length > 0) list.setItemHeights(batch);
  return;
}
// ... existing throttle logic
```

## Phase 2: Eliminate code highlight height shift

**Goal:** For non-streaming content, ensure CodeBlock renders with its final height on the first paint.

### Problem detail

The height shift comes from the DOM structure difference between the loading fallback and the highlighted output:

- **Loading:** Single `<pre className="whitespace-pre">{code}</pre>` — one block element
- **Highlighted:** Multiple `<div className="whitespace-pre">` per line, each containing `<span>` tokens

Even with identical text content, these produce different heights because the highlighted version uses `<div>` per line (explicit line breaks) while the fallback uses a single `<pre>` (implicit line breaks via newlines in text). Line-height, margin, and padding differences between `<pre>` and a series of `<div>` elements cause the mismatch.

### Approach

Make the loading fallback structurally match the highlighted output. Instead of a single `<pre>{code}</pre>`, render the same `<div>` per-line structure with plain unstyled text:

### Changes in `src/components/thread/code-block.tsx`

Replace the loading fallback (line 179):

```tsx
{isLoading || !tokens ? (
  <pre className="text-zinc-300 whitespace-pre">{code}</pre>
) : (
  <HighlightedCode tokens={tokens} />
)}
```

With a structurally-identical fallback:

```tsx
{isLoading || !tokens ? (
  <PlainCode code={code} />
) : (
  <HighlightedCode tokens={tokens} />
)}
```

Where `PlainCode` mirrors `HighlightedCode`'s DOM structure:

```tsx
const PlainCode = memo(function PlainCode({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line.length === 0 ? <span>&nbsp;</span> : <span className="text-zinc-300">{line}</span>}
        </div>
      ))}
    </>
  );
});
```

This ensures the fallback and highlighted renderings produce identical heights, eliminating the layout shift when syntax highlighting completes.

**Note:** `PlainCode` is memoized because it only needs to render once (before tokens arrive). The `code.split("\n")` runs once per code block, which is acceptable.
