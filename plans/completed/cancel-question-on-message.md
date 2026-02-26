# Cancel AskUserQuestion When User Sends a Message

## Problem

When an AskUserQuestion is live (pending), the user can type and send a new message in the input. Currently, the queued message is sent to the agent **and** the question remains visible and pending. This creates a confusing UX:

1. The user clearly intends to override/bypass the question by typing their own message
2. Both the question UI and the queued message coexist awkwardly
3. If the user later clicks a question option, *both* responses hit the agent

The expected behavior: sending a message while a question is pending should **cancel the question** and treat the user's typed message as the answer/override.

## Current Flow (and why the queued message is stuck)

1. Agent calls `AskUserQuestion` → PreToolUse hook fires → `QuestionGate.waitForAnswer()` blocks (`shared.ts:510`)
2. **While `waitForAnswer()` blocks, the SDK's `query()` async iterator is suspended** — it can't advance to the next turn until the current tool call resolves
3. Frontend receives `QUESTION_REQUEST` event → adds to `questionStore` → renders `LiveAskUserQuestionBlock`
4. User types a message → `handleSubmit()` in `thread-content.tsx` → `sendQueuedMessage()` → pushed into `SocketMessageStream.messageQueue`
5. **The queued message is stuck**: it's sitting in the stream's internal queue, but the SDK can't consume it because it's still waiting for the AskUserQuestion tool call to complete
6. **Nothing cancels the question** — it stays visible until AGENT_COMPLETED/AGENT_ERROR, and the queued message won't be processed until the 1-hour hook timeout expires

The core problem: **we must resolve (unblock) `waitForAnswer()` to free the SDK to process the queued message.** Cancelling the question on the frontend alone isn't enough — the agent-side hook is the bottleneck.

## Solution

When the user sends a message while a question is pending for that thread, auto-cancel the question:

### Frontend (3 changes)

**1. `thread-content.tsx` — Cancel pending questions on submit**

In `handleSubmit`, before calling `sendQueuedMessage`, check for pending questions on this thread and cancel them:

```ts
// If there are pending questions, cancel them — user is overriding with their message
const pendingQuestions = useQuestionStore.getState().getPendingForThread(threadId);
if (pendingQuestions.length > 0) {
  for (const req of pendingQuestions) {
    questionService.cancel(threadId, req.requestId);
  }
}
```

**2. `question-store.ts` — Add `getPendingForThread` selector + `markCancelled` action**

- `getPendingForThread(threadId)`: returns all pending requests for a thread
- `markCancelled(requestId)`: sets status to `"cancelled"` so the UI can distinguish cancelled from answered

**3. `question-service.ts` — Add `cancel()` method**

```ts
async cancel(threadId: string, requestId: string): Promise<void> {
  useQuestionStore.getState().markCancelled(requestId);
  await sendToAgent(threadId, {
    type: "question_cancelled",
    payload: { requestId },
  });
}
```

### Agent side (2 changes)

**4. `runner.ts` — Handle `question_cancelled` message type**

Add a new case in the hub message handler:

```ts
case "question_cancelled": {
  const { requestId } = msg.payload;
  logger.info(`[runner] Received question cancelled: ${requestId}`);
  questionGate.cancel(requestId);
  break;
}
```

**5. `question-gate.ts` — Add `cancel()` method**

This is the critical piece — it **unblocks the PreToolUse hook** so the SDK can advance:

```ts
cancel(requestId: string): void {
  const pending = this.pending.get(requestId);
  if (!pending) return;
  this.pending.delete(requestId);
  logger.info(`[QuestionGate] Cancelled ${requestId}`);
  pending.resolve("timeout");
}
```

**Why this unblocks the queued message:**
1. `cancel()` resolves the promise → `waitForAnswer()` returns `"timeout"` (`shared.ts:510`)
2. The hook sees `"timeout"` → returns `permissionDecision: "deny"` (`shared.ts:521-528`)
3. SDK receives the deny → AskUserQuestion tool call is rejected (agent sees "Question cancelled by user")
4. SDK advances to the next iteration of `query()` → pulls the queued message from `SocketMessageStream`
5. Agent processes the user's typed message as the next turn

Resolving with `"timeout"` reuses the existing deny path. We should update the deny reason to distinguish cancellation from actual timeout:

**5b. `shared.ts` — Update deny reason for cancelled questions**

Change the deny handler to be more descriptive:

```ts
if (response === "timeout" || signal.aborted) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: signal.aborted
        ? "Question timed out"
        : "Question cancelled — user sent a message instead",
    },
  };
}
```

(Optional refinement — the existing "timed out" message works fine functionally, but this gives the agent clearer context about what happened.)

### Types (1 change)

**6. `hub/types.ts` — Add `question_cancelled` to `TauriToAgentMessage` union**

Add the new message type so TypeScript is happy:

```ts
| { type: "question_cancelled"; payload: { requestId: string } }
```

### UI feedback

**7. `live-ask-user-question.tsx` — Show cancelled state**

When the question's status is `"cancelled"`, render a subtle dismissal instead of the interactive question UI (e.g., a muted "Question dismissed" label, or just hide it entirely). This is a minor visual polish — hiding is simplest.

## Phases

- [x] Add `question_cancelled` message type to hub types and wire agent-side handling (steps 4, 5, 5b, 6)
- [x] Add store helpers and cancel service method on frontend (steps 2, 3)
- [x] Wire cancellation into `handleSubmit` and update question UI (steps 1, 7)
- [ ] Test end-to-end: send a message while question is pending, verify question disappears and agent processes the message

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- **No new events needed** — we reuse the existing socket message pattern (`sendToAgent`)
- **"timeout" resolution unblocks the SDK** — this is the critical path. The hook blocks the entire `query()` iterator; resolving with "timeout" triggers a deny, which completes the tool call, which frees the SDK to consume the queued message from `SocketMessageStream`
- **Race condition safety** — if the user clicks an answer at the exact same moment they hit Enter, the first one to resolve the promise wins (Map delete + resolve is atomic per JS event loop tick). The second call will find no pending entry and no-op
- **Question store status** — adding `"cancelled"` to the status union (`"pending" | "answered" | "cancelled"`) lets the UI distinguish all three states cleanly
