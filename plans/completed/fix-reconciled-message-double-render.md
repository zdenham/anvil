# Fix Reconciled Message Double Render

## Problem

When a queued message never gets acked (agent exits before the 2-turn threshold), reconciliation resends it as a "normal" message. The message then renders **twice** in the thread.

### Root Cause

A false assumption in `reconcilePendingMessages` — the comment on line 59 of `src/entities/threads/listeners.ts` says:

> Messages were never appended to state.json (they live exclusively in the queued store until ACK), so no scrub step is needed.

**This is wrong.** The agent's `SocketMessageStream.createStream()` (`agents/src/lib/hub/message-stream.ts:72-73`) calls `appendUserMessage(msg.id, msg.content)` for every queued message it processes. This writes the message to state.json on disk for crash-recovery durability.

### Timeline of the Bug

```
T0  User queues message (ID: abc-123) → stored in useQueuedMessagesStore only
T1  Agent receives via socket → appendUserMessage writes {id: "abc-123"} to state.json
T2  Agent exits before 2-turn ack → NACK emitted
T3  AGENT_COMPLETED fires:
      a) loadThreadState() hydrates state.json → abc-123 now in threadState.messages
      b) reconcilePendingMessages():
           - drainThread() removes from queued store (pinned ghost disappears)
           - resumeSimpleAgent(threadId, content, workDir) — NO messageId passed!
T4  New agent reads state.json as history (abc-123 already there)
T5  Agent adds prompt as new user message with NEW ID (xyz-789, same content)
T6  state.json now has BOTH abc-123 AND xyz-789 with identical content
T7  Frontend hydrates → two messages, different IDs → dedup in thread reducer doesn't catch it
```

### Three layers of the problem

1. **No scrub** — Reconciliation doesn't remove the old copy from state.json before resending
2. **No messageId passthrough** — `resumeSimpleAgent` is called without the original `messageId`, so the new agent generates a fresh ID (bypassing the thread reducer's ID-based dedup)
3. **Transient double** — Between `loadThreadState` (message appears in virtual list from state.json) and `drainThread` (pinned ghost removed), both copies briefly render simultaneously

## Phases

- [x] Scrub unconfirmed message from state.json and pass messageId through reconciliation
- [x] Add test for scrub + messageId passthrough in reconciliation
- [ ] (Optional) Filter virtual list to exclude messages still in queued store

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Scrub + messageId passthrough

**File:** `src/entities/threads/listeners.ts` — `reconcilePendingMessages` (line 62)

### Changes

```typescript
async function reconcilePendingMessages(threadId: string): Promise<void> {
  const pendingMessages = useQueuedMessagesStore.getState().drainThread(threadId);
  if (pendingMessages.length === 0) return;

  logger.info(`[ThreadListener] Reconciling ${pendingMessages.length} unconfirmed message(s) for ${threadId}`);

  const thread = threadService.get(threadId) as ThreadMetadata | undefined;
  if (!thread) {
    logger.warn(`[ThreadListener] Cannot resend for ${threadId}: thread not found`);
    return;
  }

  const workingDirectory = await resolveWorkingDirectoryForThread(thread);
  if (!workingDirectory) {
    logger.warn(`[ThreadListener] Cannot resend for ${threadId}: no working directory`);
    return;
  }

  // Scrub unconfirmed messages from state.json before resending.
  // The agent writes queued messages to disk (message-stream.ts:72) for durability,
  // but reconciliation treats them as undelivered. Leaving the old copy would cause
  // the resent message to appear twice (old ID + new turn).
  const scrubIds = new Set(pendingMessages.map((m) => m.id));
  await threadService.scrubMessagesFromState(threadId, scrubIds);

  // Send first message as new turn, passing the original messageId so the
  // thread reducer's ID-based dedup can catch any remaining duplicates.
  const first = pendingMessages[0];
  try {
    logger.info(`[ThreadListener] Auto-resending message as new turn for ${threadId}`);
    await resumeSimpleAgent(threadId, first.content, workingDirectory, first.id);
  } catch (err) {
    logger.error(`[ThreadListener] Failed to resend queued message for ${threadId}:`, err);
  }
}
```

Also fix the comment block above the function (lines 55-60) to reflect reality:

```typescript
/**
 * Reconcile pending queued messages after an agent exits.
 *
 * All pending messages are treated as undelivered — the 2-turn deferred ack
 * is the only reliable confirmation, and it didn't arrive before exit.
 * Messages may have been written to state.json by the agent's message stream
 * (for crash-recovery durability), so we scrub them before resending.
 */
```

### Why this works

- `scrubMessagesFromState` already exists (`src/entities/threads/service.ts:897`) — removes messages by ID from state.json's messages array
- `resumeSimpleAgent` already accepts an optional `messageId` parameter (line 924) — threads it through as `--message-id` CLI arg
- The agent runner uses this ID instead of generating a new one, so the thread reducer's dedup guard (`core/lib/thread-reducer.ts:53`) catches any duplicate

### Why scrub + messageId (belt and suspenders)

- **Scrub alone** fixes the persistent double but doesn't prevent a race if `loadThreadState` re-hydrates between scrub and resend
- **messageId alone** fixes dedup in the reducer but leaves a stale copy in state.json history that the model will see as prior context
- **Both together** cleanly remove the old copy AND ensure the new copy has the same ID

## Phase 2: Test

**File:** `src/entities/threads/__tests__/reconcile-queued-messages.test.ts`

Add a test case:

```typescript
it("scrubs message from state.json and passes messageId when resending", async () => {
  const threadId = "thread-scrub";
  const messageId = "msg-in-state";
  const thread = createThreadMetadata({ id: threadId });

  // Message was written to state.json by agent AND is still pending in queued store
  useQueuedMessagesStore.getState().addMessage(threadId, messageId, "Unacked msg");

  useThreadStore.setState({
    ...useThreadStore.getState(),
    activeThreadId: threadId,
    threadStates: {
      [threadId]: {
        messages: [{ id: messageId, role: "user", content: "Unacked msg" }],
        fileChanges: [],
        workingDirectory: "/projects/test",
        status: "completed",
        timestamp: Date.now(),
        toolStates: {},
      },
    },
  });

  vi.mocked(threadService.get).mockReturnValue(thread);

  triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Should scrub from state.json
  expect(threadService.scrubMessagesFromState).toHaveBeenCalledWith(
    threadId,
    new Set([messageId]),
  );

  // Should resend with original messageId (4th arg)
  expect(mockResumeSimpleAgent).toHaveBeenCalledWith(
    threadId,
    "Unacked msg",
    "/projects/test",
    messageId,
  );
});
```

Also add `scrubMessagesFromState: vi.fn()` to the `threadService` mock at the top of the file.

## Phase 3 (Optional): Rendering dedup for transient flash

Between `loadThreadState` and `drainThread`, there's a brief window where the message exists in **both** `threadState.messages` (from state.json hydration) and `useQueuedMessagesStore` (still pinned). This causes a sub-100ms flash of double rendering.

**File:** `src/components/thread/thread-view.tsx` or the parent `thread-content.tsx` (line 235)

Filter out messages that are still pending in the queued store before passing to `groupMessagesIntoTurns`:

```typescript
const pendingIds = useQueuedMessagesStore(
  useShallow((state) => new Set(
    Object.values(state.messages)
      .filter((m) => m.threadId === threadId)
      .map((m) => m.id)
  ))
);

const filteredMessages = useMemo(
  () => messages.filter((m) => !pendingIds.has(m.id)),
  [messages, pendingIds]
);

// Use filteredMessages instead of messages for turns
const turns = useMemo(() => groupMessagesIntoTurns(filteredMessages), [filteredMessages]);
```

This ensures a message renders in exactly one place: either as a pinned ghost (from queued store) OR in the virtual list (from thread state), never both.

**Note:** This is optional because the flash is very brief (React batching typically coalesces the two state updates). But it's a good defensive measure.
