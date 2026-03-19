# Fix Queued Message Race Condition at Run End

## Problem

Messages queued near the end of an agent run can be silently lost. There are two failure modes:

1. **Original problem:** Agent exits before acknowledging the message — leaving it permanently "pending."
2. **SDK bug (new):** Even when a queued message is ingested into state.json and consumed by the SDK, the SDK sometimes does not actually include it in the next API call to the LLM. The message appears processed but the model never sees it.

The original approach used `state.json` as proof of processing. This is insufficient — a message in state.json only proves the SDK *received* it, not that the LLM *saw* it.

## Approach

**Conservative deferred ack:** Don't confirm a queued message until **2 assistant messages** have been received after it was injected. Anecdotally, if the model produces 2 full turns (with tool calls, text, etc.) after injection, the message was reliably included in the API context.

If the agent exits before the 2-turn threshold is met, treat the message as undelivered and re-queue it automatically as a new turn.

**Visual anchoring:** The queued message stays pinned as the **last item in the thread view** until confirmed. Assistant messages that arrive before the 2-turn ack render *above* the pending message, not below it. This makes it visually obvious that those responses are not yet responding to the queued message. Once confirmed, the message settles into its natural chronological position.

## Phases

- [x] Phase 1: Ensure disk write happens before ack emission *(original, already shipped)*

- [x] Phase 2: Visual indicator for queued messages in thread view *(original, already shipped)*

- [x] Phase 3: Reconcile pending queued messages on `AGENT_COMPLETED` event *(original, already shipped)*

- [x] Phase 4: Add tests for the reconciliation logic *(original, already shipped)*

- [x] Phase 5: Deferred ack — emit after 2 assistant turns (agent-side)

- [x] Phase 6: Update reconciliation to always re-queue unconfirmed messages

- [x] Phase 7: Pin pending queued messages at bottom of thread view

- [x] Phase 8: Tests for deferred ack and pinned rendering

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 5: Deferred ack — emit after 2 assistant turns (agent-side)

**Files:** `agents/src/runners/message-handler.ts`, `agents/src/lib/hub/message-stream.ts`

The current ack fires in two places — `withAckOnConsume` (when SDK pulls the next message from the generator) and `MessageHandler.handleUser` (after disk write). Both are too early. Replace them with a single deferred ack that fires after 2 assistant turns.

### Changes in `message-handler.ts`

1. **Add pending ack tracking** — new private field:

   ```ts
   private pendingAcks: Map<string, { insertedAtTurn: number }> = new Map();
   ```

2. **In** `handleUser()` **(line \~227):** When processing a queued message (`isSynthetic === false` with `msg.uuid`):

   - Still call `appendUserMessage()` for durability (crash recovery needs this on disk)
   - **Remove** the immediate `emitEvent("queued-message:ack", ...)` call
   - Instead, register the message: `this.pendingAcks.set(msg.uuid, { insertedAtTurn: this.turnIndex })`
   - Log that the message is pending deferred ack

3. **In** `handleAssistant()` **(line \~139):** After incrementing `this.turnIndex` (line 171), check all pending acks:

   ```ts
   for (const [messageId, info] of this.pendingAcks) {
     const turnsSinceInsert = this.turnIndex - info.insertedAtTurn;
     if (turnsSinceInsert >= 2) {
       emitEvent("queued-message:ack", { messageId }, "MessageHandler:deferred-ack");
       this.pendingAcks.delete(messageId);
       logger.info(`[MessageHandler] Deferred ack for ${messageId} after ${turnsSinceInsert} turns`);
     }
   }
   ```

4. **In** `handleResult()` **(line \~254):** When the agent run completes, emit `queued-message:nack` for any remaining unconfirmed messages:

   ```ts
   for (const [messageId] of this.pendingAcks) {
     emitEvent("queued-message:nack", { messageId }, "MessageHandler:nack-on-exit");
     logger.warn(`[MessageHandler] Nack for ${messageId} — agent exited before 2-turn threshold`);
   }
   this.pendingAcks.clear();
   ```

### Changes in `message-stream.ts`

1. **Remove ack from** `withAckOnConsume` — this wrapper currently emits ack when the SDK pulls the next message. Remove the ack emission entirely (or remove the wrapper if it serves no other purpose). The ack responsibility now lives solely in `MessageHandler.handleAssistant`.

2. **Remove ack from** `createWrappedStream` — the `emitAck` callback passed to `withAckOnConsume` should be removed.

### New event: `queued-message:nack`

This is a new event emitted when the agent exits before confirming a queued message. The frontend listens for this to trigger immediate re-queue (without waiting for `AGENT_COMPLETED` reconciliation — though reconciliation remains as a safety net).

**Payload:** `{ messageId: string }`

## Phase 6: Update reconciliation to always re-queue unconfirmed messages

**Files:** `src/entities/threads/listeners.ts`, `src/stores/queued-messages-store.ts`, `src/lib/agent-service.ts`

The current reconciliation checks state.json to decide confirm vs. resend. With the SDK bug, state.json presence is no longer proof of ingestion. Simplify: **any message still pending when the agent exits → re-queue.**

### Changes in `listeners.ts` (`reconcilePendingMessages`, line \~61)

Replace the state.json check logic:

```ts
async function reconcilePendingMessages(threadId: string): Promise<void> {
  const pendingMessages = useQueuedMessagesStore.getState().drainThread(threadId);
  if (pendingMessages.length === 0) return;

  logger.info(`[ThreadListener] Reconciling ${pendingMessages.length} unconfirmed message(s) for ${threadId}`);

  // All pending messages are treated as undelivered — the 2-turn ack is
  // the only reliable confirmation, and it didn't arrive before exit.
  const thread = threadService.get(threadId);
  const workingDirectory = await resolveWorkingDirectoryForThread(thread);
  if (!thread || !workingDirectory) {
    logger.warn(`[ThreadListener] Cannot resend for ${threadId}: missing thread/workdir`);
    return;
  }

  // Scrub unconfirmed messages from state.json before resending.
  // They may have been written to disk by appendUserMessage() but the
  // model never saw them — leaving them would create ghost context.
  const scrubIds = new Set(pendingMessages.map(m => m.id));
  await threadService.scrubMessagesFromState(threadId, scrubIds);

  // Resend first message as new turn; rest will be queued once agent runs
  const first = pendingMessages[0];
  await resumeSimpleAgent(threadId, first.content, workingDirectory);
}
```

### Changes in `queued-messages-store.ts`

1. **Add nack handler:** When `queued-message:nack` arrives, the message stays in the store (it's already pending). The nack is informational — it tells the frontend "this message will need re-queue." The actual re-queue happens via `drainThread` in reconciliation.

### Changes in `agent-service.ts`

1. **Handle** `queued-message:nack` **event:** Listen for nack events from the agent process. No store mutation needed (message is already pending), but log it for observability.

### New method: `threadService.scrubMessagesFromState(threadId, messageIds)`

Removes messages from the thread's `state.json` messages array by ID. This prevents ghost context — messages that exist on disk but were never seen by the LLM shouldn't appear as part of the conversation history when a new turn starts.

**Files:** `src/entities/threads/thread-service.ts` or equivalent state management layer.

## Phase 7: Pin pending queued messages at bottom of thread view

**Files:** `src/components/thread/thread-view.tsx` (or equivalent message list component), `src/components/thread/user-message.tsx`

Currently, queued messages are written to state.json immediately and rendered at their chronological position in the thread. Assistant messages that arrive after injection render *below* the queued message — even though those responses may not be about the queued message (SDK bug). This is confusing.

### Rendering approach

1. **In the thread message list component:** When building the render list, partition messages:

   - **Confirmed messages:** All messages from state.json whose IDs are NOT in QueuedMessagesStore → render in order
   - **Pending messages:** Messages whose IDs ARE still pending in QueuedMessagesStore → extract from their chronological position and append at the very bottom of the list

2. **In** `user-message.tsx`**:** The existing `isPending` visual treatment (italic + opacity) already works. No changes needed to the component itself — just its position in the list.

3. **Transition on confirmation:** When the deferred ack arrives (2 assistant turns), `confirmMessage()` removes the ID from the store. The message re-renders at its natural chronological position in state.json (now sandwiched between the context it was injected into). This is a smooth transition — the message "settles into place" once confirmed.

### Implementation detail

The thread view likely maps over `threadState.messages` to render turns. Add a filter+append step:

```tsx
const pendingIds = useQueuedMessagesStore(s =>
  new Set(s.getMessagesForThread(threadId).map(m => m.id))
);

const confirmedMessages = messages.filter(m => !pendingIds.has(m.id));
const pendingMessages = messages.filter(m => pendingIds.has(m.id));
const renderOrder = [...confirmedMessages, ...pendingMessages];
```

This keeps pending messages at the bottom. As soon as the ack arrives and `pendingIds` updates, the message moves to its natural position via re-render.

### Edge case: message not yet in state.json

If the agent hasn't written to state.json yet (message was just sent), it won't be in `messages` at all. The QueuedMessagesStore still has it. Render these as standalone pending bubbles at the bottom of the thread — the `queued-messages-banner.tsx` or an inline equivalent already handles this case.

## Phase 8: Tests for deferred ack and pinned rendering

**Files:** `agents/src/lib/hub/__tests__/message-handler-deferred-ack.test.ts` (new), `src/entities/threads/__tests__/reconcile-queued-messages.test.ts` (update), `src/components/thread/__tests__/user-message-pinning.test.ts` (new)

### Agent-side tests (message-handler)

1. **Deferred ack fires after 2 assistant turns:** Inject queued message → 1 assistant turn → no ack → 2nd assistant turn → ack emitted
2. **No ack on single turn:** Inject queued message → 1 assistant turn → result (agent exits) → nack emitted, no ack
3. **Multiple queued messages:** Each tracked independently, acked at their own 2-turn mark
4. **Nack on exit:** Inject queued message → 0 assistant turns → result → nack emitted
5. **Turn counting is relative:** Queued message injected at turn 5 → ack fires at turn 7, not turn 2

### Reconciliation tests (update existing)

1. **Always re-queues:** Pending message in state.json → still re-queued (state.json presence is not confirmation)
2. **Scrubs from state.json:** Unconfirmed message is removed from state.json before resend
3. **Nack + reconciliation:** Nack arrives → message stays pending → AGENT_COMPLETED fires → drain + resend
4. **Empty drain after nack is safe:** No double-processing

### Frontend rendering tests

1. **Pending message renders at bottom:** Thread with messages \[A, B(pending), C\] renders as \[A, C, B(pending)\]
2. **Confirmed message renders in order:** After ack, \[A, B, C\] renders normally
3. **Multiple pending messages maintain relative order:** \[A, B(pending), C, D(pending)\] → \[A, C, B(pending), D(pending)\]
4. **Pending visual treatment persists until 2-turn ack:** Italic + opacity-80 style present while pending

## Risk Assessment

- **Phase 5** is moderate-risk — changes the ack semantics for queued messages. The `pendingAcks` map is simple state, but the turn counting must be correct. Key risk: turn counter increments at the right time (after usage, before ack check). Mitigation: unit tests for exact turn thresholds.
- **Phase 6** is low-risk — simplifies reconciliation (removes the state.json check, adds scrub). The scrub operation is new but straightforward. Mitigation: scrub is idempotent.
- **Phase 7** is low-risk — purely rendering concern. The message data doesn't change, only its position in the render list. Mitigation: confirmed messages are unaffected; only pending messages are repositioned.
- **Phase 8** is no-risk — test-only.