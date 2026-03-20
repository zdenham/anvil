# Queued Message UI Polish

## Problem

Two UX issues with queued (pending) messages:

1. **Not visually distinct enough** — pending messages use `italic opacity-80` on the text, but the bubble itself looks nearly identical to a confirmed message. Should feel more "ghost-like" to signal it hasn't been processed yet.

2. **Bouncing position** — pending messages sit inside the scrollable message list. As the assistant streams new content, `autoScrollOnGrowth` + `sticky: true` on the virtual list causes the viewport to shift, making the queued message visually "bounce" around. It should feel anchored/stable.

## Phases

- [x] Add transparency styling to queued message bubbles

- [x] Remove eager `APPEND_USER_MESSAGE` for queued messages

- [x] Add pinned pending message rendering

- [x] Append message on ACK and crossfade from pinned to native

- [x] Simplify reconciliation (no more scrub step)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add transparency styling ✅

Applied `opacity-70` + `italic` to pending message bubbles in `user-message.tsx`.

## Phase 2: Remove eager `APPEND_USER_MESSAGE` for queued messages

### Current flow (to change)

In `thread-content.tsx` `handleSubmit`, when `canQueueMessages` is true:

1. `dispatch(APPEND_USER_MESSAGE)` — message enters thread store immediately
2. `sendQueuedMessage()` — adds to queued store + sends via socket

### New flow

When `canQueueMessages` is true:

1. `sendQueuedMessage()` only — message lives exclusively in `useQueuedMessagesStore`
2. **Do NOT dispatch** `APPEND_USER_MESSAGE` — the message has no slot in the thread's messages array yet

**File:** `src/components/content-pane/thread-content.tsx`

In `handleSubmit`, move the `APPEND_USER_MESSAGE` dispatch inside the `canResumeAgent` branch only. The `canQueueMessages` branch should only call `sendQueuedMessage()`.

The `messageId` is still generated upfront and passed to `sendQueuedMessage()` so it can be used for dedup on ACK.

## Phase 3: Add pinned pending message rendering

Render pending messages as `position: sticky; bottom: 0` elements inside the scroller, outside the virtual list.

**File:** `src/components/thread/message-list.tsx`

Add a pinned layer after the contentWrapper:

```tsx
<div ref={scrollerRef}>
  <div ref={contentWrapperRef}>
    {/* ... virtual items ... */}
  </div>

  {/* Pinned pending messages — sticky to viewport bottom */}
  {pendingMessages.length > 0 && (
    <div style={{ position: 'sticky', bottom: 0, zIndex: 10, pointerEvents: 'none' }}>
      {pendingMessages.map(msg => (
        <div key={msg.id} className="px-4 py-2 w-full max-w-[900px] mx-auto pointer-events-auto">
          <PinnedUserMessage content={msg.content} />
        </div>
      ))}
    </div>
  )}
</div>
```

**Data source:** Use `useQueuedMessagesForThread(threadId)` from `queued-messages-store.ts` (already exists, returns sorted `QueuedMessage[]`).

`PinnedUserMessage` is a lightweight component — just the bubble with ghost styling (opacity-70, italic, bg-accent-600/90). No pending timer logic needed since it's always in pending state. Could be a variant of `UserMessage` or a standalone.

**Why** `position: sticky; bottom: 0` **works:**

- The scroller (`scrollerRef`) has `overflow: auto` — sticky positioning anchors relative to the scroll viewport, not the page
- As auto-scroll chases streaming content, the sticky element stays at the viewport bottom
- The element is technically in document flow (contributes to scrollHeight) but visually pinned — this is browser-native behavior, no JS needed

`pointerEvents: none` on the container prevents the sticky overlay from intercepting scroll events. `pointer-events-auto` on individual messages re-enables click if needed (e.g., copy).

## Phase 4: Append message on ACK and crossfade

When ACK arrives, the message should appear in the thread at its **natural position** — i.e., appended to the end of the messages array at the moment of ACK, reflecting where in the conversation the agent actually processed it.

**File:** `src/lib/agent-service.ts` (ACK handler, \~line 267-275)

Currently the ACK handler just calls `confirmMessage(messageId)`. Change to:

```ts
case EventName.QUEUED_MESSAGE_ACK: {
  const ackPayload = payload as { messageId: string };
  const queuedStore = useQueuedMessagesStore.getState();
  const msg = queuedStore.messages[ackPayload.messageId];

  if (msg) {
    // Append to thread at current position (natural ACK slot)
    useThreadStore.getState().dispatch(msg.threadId, {
      type: "THREAD_ACTION",
      action: { type: "APPEND_USER_MESSAGE", payload: { content: msg.content, id: msg.id } },
    });

    // Remove from queued store (pinned copy will unmount)
    queuedStore.confirmMessage(ackPayload.messageId);
  }
  break;
}
```

**Crossfade visual:**

- When `confirmMessage` fires, the queued store removes the message → `useQueuedMessagesForThread` updates → pinned copy unmounts
- Simultaneously, `APPEND_USER_MESSAGE` adds the message to the thread → turns array grows → virtual list renders the new turn at the bottom
- The new turn renders as a normal (non-pending) `UserMessage` — full opacity, no italic
- Net visual effect: ghost bubble at viewport bottom disappears, solid bubble appears at the end of the thread. Since auto-scroll is sticky and chasing the bottom, these positions overlap — seamless transition.

**Optional polish:** Add a brief fade-in on the native copy. In `UserMessage`, detect "just appeared" (e.g., via a `freshMessageIds` set with a short TTL) and apply `animate-in fade-in duration-200`. This smooths the rare case where the native slot position doesn't perfectly overlap with the pinned position.

## Phase 5: Simplify reconciliation

With the new flow, pending messages are never in `state.json`, so the scrub step in reconciliation is unnecessary.

**File:** `src/entities/threads/listeners.ts` (`reconcilePendingMessages`)

Remove the `scrubMessagesFromState` call:

```ts
async function reconcilePendingMessages(threadId: string): Promise<void> {
  const pendingMessages = useQueuedMessagesStore.getState().drainThread(threadId);
  if (pendingMessages.length === 0) return;

  // No scrub needed — messages were never appended to state.json

  const thread = threadService.get(threadId);
  // ... resolve working directory ...

  const first = pendingMessages[0];
  await resumeSimpleAgent(threadId, first.content, workingDirectory);
}
```

If `scrubMessagesFromState` is now unused elsewhere, remove it entirely.

### Edge cases

- **Agent exits before ACK, reconciliation resends:** Works as before — `drainThread` pulls from in-memory store, resends as new turn. No state.json involvement.
- **App crashes between queue and ACK:** Message lost (in-memory store). Same limitation as today. Acceptable for now — could persist queued store to localStorage in future if needed.
- **Multiple queued messages, first ACK'd:** First message gets appended to thread + removed from pinned. Remaining messages stay pinned. Order is preserved because each ACK appends at the current end of messages.
- **User scrolls up during pending:** Sticky pinned message stays at viewport bottom (browser sticky behavior). Doesn't interfere with scroll position.