# Fix: queued messages break sticky scroll

## Problem

When a user sends a message while the agent is running, it appears as a `PinnedUserMessage` in the `pendingMessages` list. This message renders **in-flow** inside the content wrapper (after the virtual list items, line 123-128 of `message-list.tsx`), which increases `scrollHeight` — but nothing notifies the `ScrollCoordinator` that content grew. The scroll position stays put, leaving the queued message below the fold.

### Root cause

The virtual list only tracks `virtualCount = turns.length + workingIndicator`. Queued messages are rendered outside the virtual list's awareness. The two auto-scroll mechanisms don't fire:

1. **`coordinator.onItemAdded()`** — only fires when `virtualCount` increases (`use-virtual-list.ts:124`). Queued messages don't change `virtualCount`.
2. **`coordinator.onContentGrew()`** — only fires on `list.subscribe()` events (`use-virtual-list.ts:259`), gated on `autoScrollOnGrowth` which equals `isRunning`. Queued messages don't trigger virtual list updates regardless.

So the `ScrollCoordinator` never starts its animation loop to chase the new bottom.

### Rendering layout (for context)

```
contentWrapperRef (minHeight: totalHeight + 30)
├── paddingBefore spacer
├── virtual items (tracked by VirtualList)
├── pendingMessages.map(PinnedUserMessage)  ← in-flow, NOT tracked
└── paddingAfter + 30 spacer
```

### Send flow

1. User types message → `sendQueuedMessage()` in `agent-service.ts:1184`
2. `useQueuedMessagesStore.addMessage()` fires optimistically (before socket send)
3. `useQueuedMessagesForThread` hook re-derives → `pendingMessages` array grows
4. `PinnedUserMessage` renders in-flow → `scrollHeight` increases
5. **Nothing notifies ScrollCoordinator** → no auto-scroll → message below fold

## Phases

- [x] Scroll to bottom when queued messages are added

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Scroll to bottom when queued messages are added

**File:** `src/components/thread/message-list.tsx`

Add a `useEffect` that watches `pendingMessages.length`. When it increases, scroll to the true bottom of the scroll container. Since queued messages live outside the virtual list, we use raw `scrollTop` rather than `scrollToIndex`.

```tsx
// After the existing scrollerRef/isAtBottom declarations (~line 38)
const prevPendingCountRef = useRef(pendingMessages.length);

useEffect(() => {
  if (pendingMessages.length > prevPendingCountRef.current) {
    const el = scrollerRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }
  prevPendingCountRef.current = pendingMessages.length;
}, [pendingMessages.length]);
```

**Why this works:**
- The user just sent a message — scrolling to bottom is always correct (you want to see what you just typed)
- `requestAnimationFrame` ensures the new `PinnedUserMessage` has rendered before we read `scrollHeight`
- The `prevPendingCountRef` guard means this only fires on **additions**, not removals (when the agent consumes the queued message, count decreases → no spurious scroll)
- No interference with the virtual list's own scroll correction since we're not touching the coordinator

**Why consumption (queued → real turn) is already handled:**
When the agent consumes a queued message, `pendingMessages.length` decreases and `turns.length` increases simultaneously. The `virtualCount` increase triggers `coordinator.onItemAdded()` which starts the animation loop. The height swap (queued div removed, real turn div added at roughly the same position) should be seamless — but worth a manual verification during testing.
