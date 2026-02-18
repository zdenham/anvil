# Fix Auto-Scroll Behavior

Two scroll issues reported:
1. **Auto-scroll doesn't follow streaming output** — content grows but viewport stays put
2. **Opening a thread doesn't snap to the last message** — requires manual scroll-down every time

## Phases

- [x] Fix streaming auto-scroll (Virtuoso `followOutput` + Footer interaction)
- [x] Fix scroll-to-bottom on thread open
- [x] Verify both fixes work together

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Diagnosis

### Issue 1: Streaming auto-scroll is broken

**Root cause: Virtuoso's `followOutput` only tracks item count changes, not Footer height changes.**

In `message-list.tsx:191`:
```tsx
followOutput={isStreaming && isAtBottom ? "smooth" : false}
```

The conditions `isStreaming && isAtBottom` are correct in principle — but `followOutput` in react-virtuoso triggers scrolling when **the data array length changes** (i.e., a new turn is appended to `turns`). It does NOT trigger when the **Footer component** grows in height.

Streaming content is rendered inside a `Footer` component (`message-list.tsx:150-176`), which lives *outside* the virtualized item list. As the `StreamingContent` component receives new text blocks from `useStreamingStore`, the Footer grows taller — but Virtuoso doesn't detect this as a data change, so `followOutput` never fires.

The streaming content only gets promoted into the `turns` array when a full `AGENT_STATE` event arrives (persisting the message). Between those events, all incremental text is in the Footer, invisible to `followOutput`.

**Evidence:** The `data` prop is `turns`, and turns only update when `activeState.messages` changes (via store). Streaming blocks update the Footer via a separate store (`useStreamingStore`), completely bypassing Virtuoso's change detection.

### Issue 2: Opening a thread doesn't scroll to bottom

**Root cause: Broken `useEffect` dependency + `key={threadId}` remounting race condition.**

In `thread-content.tsx:476-489`:
```tsx
useEffect(() => {
  if (!hasScrolledOnMount.current && messages.length > 0 && messageListRef.current) {
    hasScrolledOnMount.current = true;
    const timer = setTimeout(() => {
      messageListRef.current?.scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }
}, [messages.length > 0]);  // ← boolean dependency
```

Two problems:

1. **Boolean dependency `[messages.length > 0]`** — This evaluates to `true` or `false`. When switching from one thread-with-messages to another thread-with-messages, the value stays `true` → the effect doesn't re-run → no scroll.

2. **`key={threadId}` on ThreadView (line 506) causes a full remount** of the `MessageList`, which destroys the old `virtuosoRef`. The `hasScrolledOnMount` ref is reset by the effect at line 408, but by the time the scroll effect runs (100ms later), the new `MessageList` may not have finished its Virtuoso initialization. The 100ms timeout is a guess that may be too short for threads with many messages.

Additionally, Virtuoso's own `initialTopMostItemIndex` prop is not set, so on mount it defaults to showing the top of the list (index 0) rather than the bottom.

---

## Proposed Fixes

### Fix 1: Streaming auto-scroll

**Option A (Recommended): Use Virtuoso's `autoscrollToBottom` or manual scroll on Footer growth**

Add an effect in `MessageList` that detects Footer content changes and manually scrolls:

```tsx
// In message-list.tsx
const prevStreamingRef = useRef(false);

useEffect(() => {
  // When streaming starts or content updates while at bottom, scroll down
  if (isStreaming && isAtBottom && hasStreamingContent) {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
    });
  }
}, [isStreaming, isAtBottom, hasStreamingContent]);
```

However, this only fires on discrete changes to `hasStreamingContent` (boolean), not on every text chunk. A more robust approach:

**Option B: Use `scrollerRef` + `ResizeObserver` on the Footer**

Wrap the Footer in a ref and observe its height. When it grows, if `isAtBottom`, scroll down:

```tsx
// In message-list.tsx, add a ref to the footer wrapper
const footerRef = useRef<HTMLDivElement>(null);

// ResizeObserver to detect footer height changes
useEffect(() => {
  if (!isStreaming || !isAtBottom) return;
  const footer = footerRef.current;
  if (!footer) return;

  const observer = new ResizeObserver(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" });
  });
  observer.observe(footer);
  return () => observer.disconnect();
}, [isStreaming, isAtBottom]);

// Update Footer to wrap in ref
const Footer = useCallback(() => {
  if (hasStreamingContent) {
    return (
      <div ref={footerRef} className="...">
        <StreamingContent ... />
      </div>
    );
  }
  // ...
}, [hasStreamingContent, ...]);
```

**Concern with Option B:** Assigning a ref inside a `useCallback` Footer component is tricky because Virtuoso manages the Footer lifecycle. The ref may not persist correctly.

**Option C (Simplest, likely best): Use Virtuoso's `followOutput` as a function**

Virtuoso's `followOutput` can accept a **callback function** instead of a string. The callback fires whenever the list content changes (including footer). Change:

```tsx
followOutput={isStreaming && isAtBottom ? () => "smooth" : false}
```

Actually, the real fix is simpler. The `followOutput` prop does support Footer changes but only when it returns `"smooth"` or `"auto"` from a **function**. According to Virtuoso docs, passing a function instead of a static value enables the "follow" behavior on *any* scroll-relevant change including footer resizing. Let's try:

```tsx
followOutput={(isAtBottom) => {
  if (isStreaming && isAtBottom) return "smooth";
  return false;
}}
```

Wait — `followOutput` as a function receives `isAtBottom` as its argument. But the actual Virtuoso behavior for Footer tracking needs investigation. The safest approach combines options:

**Recommended implementation:**

1. Set `initialTopMostItemIndex` to `"LAST"` (fixes initial position)
2. Use `followOutput` as a function callback
3. Add a `ResizeObserver`-based scroll-kick for Footer growth during streaming, as a safety net

### Fix 2: Scroll-to-bottom on thread open

**Replace the broken effect with Virtuoso's `initialTopMostItemIndex`:**

In `message-list.tsx`, add the prop:
```tsx
<Virtuoso
  initialTopMostItemIndex={turns.length > 0 ? turns.length - 1 : 0}
  // ... rest of props
/>
```

This tells Virtuoso to render from the bottom on mount, which is exactly what we want when opening a thread. No `setTimeout` hack needed.

**Also fix the dependency array** in `thread-content.tsx` as a belt-and-suspenders:

```diff
- }, [messages.length > 0]);
+ }, [messages.length]);
```

This ensures the effect re-fires when message count changes (not just the 0→N transition).

And increase the timeout or use `requestAnimationFrame` chaining:
```tsx
useEffect(() => {
  if (!hasScrolledOnMount.current && messages.length > 0 && messageListRef.current) {
    hasScrolledOnMount.current = true;
    // Use rAF to wait for Virtuoso to finish layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messageListRef.current?.scrollToBottom();
      });
    });
  }
}, [messages.length]);
```

---

## Summary of Changes

| File | Change |
|---|---|
| `src/components/thread/message-list.tsx` | Add `initialTopMostItemIndex={turns.length - 1}` to Virtuoso. Add ResizeObserver on footer for streaming scroll-kick. Change `followOutput` to function form. |
| `src/components/content-pane/thread-content.tsx` | Fix dependency array from `[messages.length > 0]` to `[messages.length]`. Replace `setTimeout(100)` with double-rAF for more reliable timing. |
