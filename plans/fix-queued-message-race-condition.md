# Fix Queued Message Race Condition at Run End

## Problem

Messages queued near the end of an agent run can be silently lost. The user sends a message, the frontend optimistically adds it to the `QueuedMessagesStore`, but the agent process exits before acknowledging it — leaving the message permanently "pending" in the UI with no recovery path.

## Approach

Instead of trying to prevent the race (graceful disconnect, nacks, timeouts), **embrace it and recover automatically**. Use `state.json` as a durable ack — if the message made it into state.json, it was processed. If not, resend it as a regular new message (new turn), not a queued message.

**Idempotency key:** the frontend-generated `messageId` flows through the entire pipeline into `state.json` via `appendUserMessage(msg.id, msg.content)`. Checking `state.json.messages.some(m => m.id === messageId)` is a reliable "was this processed?" check.

## Phases

- [x] Phase 1: Ensure disk write happens before ack emission

- [x] Phase 2: Visual indicator for queued messages in thread view

- [x] Phase 3: Reconcile pending queued messages on `AGENT_COMPLETED` event

- [x] Phase 4: Add tests for the reconciliation logic

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Ensure disk write happens before ack emission

**Files:** `agents/src/lib/hub/message-stream.ts`, `agents/src/runners/message-handler.ts`

Currently ack fires before `appendUserMessage()` writes to disk. Swap the order so state.json is guaranteed to contain the message before the frontend receives confirmation.

**Changes in** `message-stream.ts` **(around lines 80-92):**

1. In the async generator loop, call `this.appendUserMessage(msg.id, msg.content)` BEFORE `this.eventEmitter("queued-message:ack", ...)`
2. This ensures the message is on disk before the ack is emitted — if the ack arrives, the message is durably stored

**Changes in** `message-handler.ts` **(around lines 204-251):**

1. Same reorder: call `appendUserMessage()` before emitting the ack event
2. The ack should only fire after the disk write succeeds

This makes state.json the reliable source of truth: ack received → message is on disk. No ack → check disk to see if it made it anyway.

## Phase 2: Visual indicator for queued messages in thread view

**Files:** `src/components/thread/user-message.tsx` (or equivalent), `src/stores/queued-messages-store.ts`

Currently queued messages only appear in a separate banner (`queued-messages-banner.tsx`) with an amber pulse dot. The actual message content in the thread view has no visual distinction — the user can't tell which message is still pending delivery. Add inline visual treatment so queued messages are clearly distinguishable.

**Visual treatment:**

1. **Italicize** the message text while it's in queued/pending state
2. **Add a "Queued" badge/chip** — small, muted label next to or below the message (e.g., amber text, similar to the banner's pulse indicator style)
3. **Remove the visual treatment** once the message is confirmed (ack received) or reconciled

**Implementation:**

1. In the user message component, check `useQueuedMessagesStore.getState().isMessagePending(messageId)` to determine if this message is still queued
2. Conditionally apply `italic` text style and render a small "Queued" indicator
3. The indicator should automatically disappear when `confirmMessage()` removes the message from the store (reactive via Zustand subscription)

**Design notes:**

- Keep it subtle — italic + small badge, not a full overlay or blocking state
- No spinner/loading — this isn't a network request, it's a queue position
- The existing banner can remain as a summary; the inline indicator gives per-message clarity

## Phase 3: Reconcile pending queued messages on `AGENT_COMPLETED` event

**Files:** `src/entities/threads/listeners.ts`, `src/stores/queued-messages-store.ts`, `src/lib/agent-service.ts`

When the agent exits (via `AGENT_COMPLETED` event), check if any pending queued messages were actually processed (on disk) or lost (need resend). This hooks into the existing `handleAgentCompleted` handler in `listeners.ts:165`.

**Changes in** `listeners.ts` **(**`handleAgentCompleted`**, around line 165):**

1. After refreshing thread state (which loads state.json), check `QueuedMessagesStore` for pending messages on this thread
2. For each pending message:
   - Load the thread's state.json messages array (already available after `loadThreadState`)
   - If `messageId` found in `state.json.messages` → call `confirmMessage(messageId)` — ack was just lost in transit, message was processed
   - If `messageId` NOT found → remove from store, auto-send as a new regular message via the normal send path (starts a new agent turn)
3. Process pending messages in timestamp order so resends maintain the user's intended order

**Changes in** `queued-messages-store.ts`**:**

1. Add `removeMessage(messageId: string)` — removes without treating as confirmed (for the "needs resend" path)
2. Add `drainThread(threadId: string): QueuedMessage[]` — atomically removes and returns all pending messages for a thread (prevents double-processing if the handler fires twice)

**Changes in** `agent-service.ts`**:**

1. Export a `sendNewMessage(threadId: string, content: string)` or equivalent that starts a fresh agent turn — this is what reconciliation calls for unprocessed messages
2. This may already exist as the normal "send message" flow; just ensure it's callable from the listener

**Idempotency guarantees:**

- `drainThread()` is atomic — once drained, calling it again returns empty array
- The messageId check against state.json is deterministic — same input → same decision
- Resending as a new turn with new message ID is safe — the original was never processed

**UI consideration:** When auto-resending, the user's message just appears naturally in the new turn. No toast needed — from the user's perspective, their message was delivered (just to a new turn instead of the ending one).

## Phase 4: Add tests for the reconciliation logic

**Files:** `src/entities/threads/__tests__/reconcile-queued-messages.test.ts` (new), `agents/src/lib/hub/__tests__/message-stream.test.ts` (existing)

1. **Agent-side ordering test:** Verify that `appendUserMessage` is called before ack emission in message-stream.ts
2. **Queued message visual indicator tests:**
   - Pending message renders with italic text and "Queued" badge
   - Confirmed message renders normally (no italic, no badge)
3. **Frontend reconciliation tests:**
   - Pending message found in state.json → confirmed, not resent
   - Pending message NOT in state.json → removed from store, resent as new message
   - Multiple pending messages → processed in timestamp order
   - `drainThread()` is atomic — second call returns empty
   - No pending messages → no-op (doesn't crash)
4. **Integration test:** Full lifecycle — queued message pushed just before agent exit → reconciliation fires → message resent as new turn

## Risk Assessment

- **Phase 1** is low-risk — reorders two existing calls, no new code paths
- **Phase 2** is low-risk — purely additive UI styling, no behavior changes
- **Phase 3** is low-risk — purely additive recovery logic on an existing lifecycle event (`AGENT_COMPLETED`), with atomic drain preventing double-processing
- **Phase 4** is no-risk — test-only