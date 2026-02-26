# Fix Auto-Scroll Behavior

## Phases

- [x] Simplify auto-scroll in message-list.tsx (remove ResizeObserver, rely on Virtuoso)
- [x] Increase atBottomThreshold from 50px to 300px
- [x] Fix isAtBottom re-engagement on scroll-to-bottom click
- [x] Remove double-rAF scroll-on-mount hack in thread-content.tsx

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Current State (Audit Summary)

The auto-scroll system spans 3 files:

1. **`message-list.tsx`** — Virtuoso list with `followOutput`, `atBottomThreshold`, and a ResizeObserver
2. **`thread-content.tsx`** — double-`requestAnimationFrame` scroll-on-mount hack
3. **`use-trickle-text.ts`** — character-by-character reveal animation that continuously grows DOM height

### How It Works Today

The `<Virtuoso>` component has two built-in auto-scroll mechanisms:
- **`followOutput`** — When new data items are appended OR the last item grows, Virtuoso auto-scrolls if user is "at bottom". Returns `"smooth"` when streaming + at bottom.
- **`atBottomStateChange` + `atBottomThreshold={50}`** — Fires a callback when user crosses the 50px-from-bottom boundary, updating `isAtBottom` state.

On top of Virtuoso's built-in behavior, there's a **manual ResizeObserver** (lines 93-104):
```tsx
useEffect(() => {
  if (!isStreaming || !isAtBottom) return;
  const footer = footerRef.current;
  if (!footer) return;
  const observer = new ResizeObserver(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
  });
  observer.observe(footer);
  return () => observer.disconnect();
}, [isStreaming, isAtBottom]);
```

This ResizeObserver fires `scrollToIndex("LAST")` every time the footer's height changes during streaming. Since trickle-text grows the footer height continuously (every ~16ms), this fires **constantly** during streaming.

### Problems Identified

#### 1. The 50px threshold is way too small
`atBottomThreshold={50}` means the user is only considered "at bottom" within 50px of the scroll end. A single new paragraph or code block can easily push the scroll position beyond 50px from bottom, causing `isAtBottom` to flip to `false` and auto-scroll to disengage. This is the "large message undoes auto-scroll" bug — when a big chunk of content arrives, the DOM grows by more than 50px between scroll updates, and suddenly the user isn't "at bottom" anymore.

#### 2. ResizeObserver fights with Virtuoso's `followOutput`
Both systems try to scroll to bottom independently:
- Virtuoso's `followOutput` scrolls when it detects output growth while at bottom
- The ResizeObserver also scrolls on every footer resize

These create redundant scroll operations. Worse, the ResizeObserver has a **stale closure bug**: the `useEffect` captures `isAtBottom` at the time it runs. If `isAtBottom` changes while the observer is active, the observer keeps firing (or doesn't fire) based on the stale value. The effect only re-runs when `isStreaming` or `isAtBottom` changes, but between those changes, the observer is working with potentially outdated state.

When `isAtBottom` flips to `false` (because the threshold is too small), the ResizeObserver disconnects (effect cleanup), and Virtuoso's `followOutput` also returns `false`. Now **nothing** is auto-scrolling — and the content keeps growing below the viewport. The user sees the scroll-to-bottom button appear even though they never scrolled away.

#### 3. The scroll-to-bottom button click doesn't reliably re-engage auto-scroll
`scrollToBottom` calls `scrollToIndex({ index: "LAST", behavior: "smooth" })`. This smooth-scrolls to the last item. But the smooth scroll animation takes time, and during that animation, the footer is still growing. The scroll may never reach "bottom" because the target keeps moving, so `isAtBottom` never flips back to `true`, and auto-scroll never re-engages.

#### 4. Double-rAF mount scroll is fragile
`thread-content.tsx` uses `requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom()))` to scroll on mount. This is a timing hack that works most of the time but can fail if Virtuoso takes longer than 2 frames to layout.

## Proposed Fix

### Strategy: Trust Virtuoso, increase the threshold, remove the ResizeObserver

Virtuoso's `followOutput` is designed exactly for this use case. The ResizeObserver is redundant and creates race conditions. The real fix is:

### Phase 1: Remove ResizeObserver, rely on Virtuoso
Delete the ResizeObserver effect (lines 93-104 of `message-list.tsx`). Virtuoso's `followOutput` already handles scrolling when the footer content grows — that's what it's for. The footer is a Virtuoso component, so Virtuoso is already aware of its size changes.

Also remove the `footerRef`, `footerRefCallback`, and the `ref={footerRefCallback}` on the footer div, since they exist only for the ResizeObserver.

### Phase 2: Increase atBottomThreshold from 50px to 300px
Change `atBottomThreshold={50}` to `atBottomThreshold={300}`. This means:
- User is considered "at bottom" if within 300px (~4-5 lines of text) of the end
- Large content chunks arriving won't accidentally disengage auto-scroll
- The scroll-to-bottom button only appears when the user has meaningfully scrolled up
- 300px is generous enough to absorb burst content growth between frames

Also update `followOutput` to match — it receives Virtuoso's internal `atBottom` which uses the same threshold, so this should just work.

### Phase 3: Fix scroll-to-bottom button re-engagement
When the user clicks "scroll to bottom", use `behavior: "auto"` (instant) instead of `"smooth"`. Smooth scrolling races with growing content and may never reach bottom. Instant scroll guarantees the viewport reaches the end, which re-triggers `atBottomStateChange(true)`, which re-engages `followOutput`.

```tsx
const scrollToBottom = useCallback(() => {
  virtuosoRef.current?.scrollToIndex({
    index: "LAST",
    behavior: "auto",
  });
}, []);
```

### Phase 4: Remove double-rAF hack
Replace the double-rAF in `thread-content.tsx` with Virtuoso's `initialTopMostItemIndex` which already exists in `message-list.tsx` (line 220). The `initialTopMostItemIndex={turns.length - 1}` already handles showing the last message on mount. The double-rAF is redundant and can be removed entirely along with the `hasScrolledOnMount` ref.

## Files Changed

- `src/components/thread/message-list.tsx` — Remove ResizeObserver, increase threshold, fix scrollToBottom
- `src/components/content-pane/thread-content.tsx` — Remove double-rAF mount scroll hack
