# Refactor Queued Message Ack Pipeline

## Problem

The deferred ack system is broken. The ack registration lives in `MessageHandler.handleUser()` (line 248), but the **SDK never emits injected user messages back through its output iterator**. The `for await` loop in `shared.ts:1513` only sees messages the SDK emits — assistant, tool results, system, result. So `handleUser` with `isSynthetic === false` is dead code, `pendingAcks` is never populated, and acks never fire.

Additionally, `appendUserMessage` is called in both the stream (`message-stream.ts:72`) and the dead handler branch (`message-handler.ts:244`) — if the handler ever did fire, messages would be appended twice.

The generator wrapper from the original plan (`createWrappedStream`) was reduced to a passthrough and the ack logic was moved to MessageHandler — which turned out to be the wrong place since the SDK doesn't emit input user messages.

## Solution: QueuedAckManager + Generator Wrapper

Two components, each with a single responsibility:

1. **Generator wrapper** — intercepts `.next()` calls on the async generator. When the SDK calls `.next()`, it proves it consumed the previous yield. At that point, register the consumed message's ID with the ack manager.

2. **QueuedAckManager** — owns the turn-counting lifecycle. Tracks a `Map<messageId, turnsSeen>`. On each assistant turn, increments all counters. When any entry reaches 2, emits `queued-message:ack`. On agent exit, emits `queued-message:nack` for anything that didn't reach the threshold.

```
                    Generator Wrapper                    QueuedAckManager
                    ────────────────                     ────────────────
SDK calls .next() ──→ register(messageId) ──────────────→ pendingAcks.set(id, 0)
                                                                │
MessageHandler sees assistant msg ──→ onAssistantTurn() ──→ pendingAcks[id]++
                                                                │
                                                         if turns >= 2 ──→ emit ack
                                                                │
Agent exits (result msg) ──→ drainNacks() ──────────────→ emit nack for remaining
```

### Message lifecycle

```
push() → waitForMessage() → disk write → yield → SDK .next() → register(id)
                                                       │
                                          ┌────────────┘
                                          ▼
                                   QueuedAckManager
                                   pendingAcks: { id: 0 }
                                          │
                          assistant turn → pendingAcks: { id: 1 }
                          assistant turn → pendingAcks: { id: 2 } → ACK!
```

## Phases

- [x] Create QueuedAckManager class

- [x] Implement generator wrapper in SocketMessageStream

- [x] Wire up in shared.ts / runAgentLoop

- [x] Remove dead code from MessageHandler

- [x] Update and add tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Create QueuedAckManager

**New file:** `agents/src/lib/hub/queued-ack-manager.ts`

```typescript
import { logger } from "../logger.js";

type EmitEvent = (name: string, payload: Record<string, unknown>, source?: string) => void;

/**
 * Manages the deferred ack lifecycle for queued messages.
 *
 * A queued message is only acked after 2 assistant turns have passed
 * since SDK consumption — proving the LLM actually processed it.
 * Messages that don't reach the threshold before agent exit get nacked.
 */
export class QueuedAckManager {
  private pendingAcks = new Map<string, number>(); // messageId → turns seen
  private emitEvent: EmitEvent;

  constructor(emitEvent: EmitEvent) {
    this.emitEvent = emitEvent;
  }

  /** Register a message as consumed by the SDK, starting turn counting. */
  register(messageId: string): void {
    this.pendingAcks.set(messageId, 0);
    logger.info(`[QueuedAckManager] Registered: ${messageId}`);
  }

  /**
   * Called on each assistant turn (from MessageHandler.handleAssistant).
   * Increments counters and emits acks for messages that hit the threshold.
   */
  onAssistantTurn(): void {
    for (const [messageId, turns] of this.pendingAcks) {
      const newTurns = turns + 1;
      if (newTurns >= 2) {
        this.emitEvent("queued-message:ack", { messageId }, "QueuedAckManager:ack");
        this.pendingAcks.delete(messageId);
        logger.info(`[QueuedAckManager] Acked ${messageId} after ${newTurns} turns`);
      } else {
        this.pendingAcks.set(messageId, newTurns);
      }
    }
  }

  /**
   * Called on agent exit (from MessageHandler.handleResult).
   * Nacks any messages that didn't reach the 2-turn threshold.
   */
  drainNacks(): void {
    for (const [messageId] of this.pendingAcks) {
      this.emitEvent("queued-message:nack", { messageId }, "QueuedAckManager:nack");
      logger.warn(`[QueuedAckManager] Nack for ${messageId} — agent exited before threshold`);
    }
    this.pendingAcks.clear();
  }

  /** Number of messages awaiting ack (for testing). */
  get size(): number {
    return this.pendingAcks.size;
  }
}
```

## Phase 2: Implement generator wrapper in SocketMessageStream

**File:** `agents/src/lib/hub/message-stream.ts`

Restore the real generator wrapper. Instead of emitting acks directly, call `ackManager.register()`.

Changes to `createWrappedStream`:

```typescript
/**
 * Returns the stream wrapped so consumed messages are registered
 * with the ack manager for deferred ack after 2 assistant turns.
 */
createWrappedStream(
  initialPrompt: string,
  ackManager: QueuedAckManager,
): AsyncGenerator<SDKUserMessage> {
  const inner = this.createStream(initialPrompt);
  return withAckOnConsume(inner, (messageId) => {
    ackManager.register(messageId);
  });
}
```

The `withAckOnConsume` wrapper (same structure as the original plan, but calling `register` instead of emitting ack):

```typescript
function withAckOnConsume(
  inner: AsyncGenerator<SDKUserMessage>,
  onConsumed: (messageId: string) => void,
): AsyncGenerator<SDKUserMessage> {
  let pendingId: string | null = null;

  const wrapper: AsyncGenerator<SDKUserMessage> = {
    async next(...args: [] | [unknown]) {
      // SDK calling .next() proves it consumed the previous yield
      if (pendingId) {
        onConsumed(pendingId);
        pendingId = null;
      }
      const result = await inner.next(...args);
      if (!result.done && result.value.uuid) {
        pendingId = result.value.uuid;
      }
      return result;
    },

    async return(value?: unknown) {
      // Generator closing — register last consumed message
      if (pendingId) {
        onConsumed(pendingId);
        pendingId = null;
      }
      return inner.return(value);
    },

    async throw(err?: unknown) {
      pendingId = null; // Don't register on error
      return inner.throw(err);
    },

    [Symbol.asyncIterator]() { return wrapper; },
  };

  return wrapper;
}
```

Also remove the `appendUserMessage` call from inside `createStream` — it's already handled there but we need to keep it since the SDK doesn't emit these messages back. (This is the ONLY place user messages get written to state for queued messages.) No change to createStream itself.

## Phase 3: Wire up in shared.ts / runAgentLoop

**File:** `agents/src/runners/shared.ts`

1. Create `QueuedAckManager` before the query loop, passing `emitEvent`
2. Pass it to `createWrappedStream`
3. Pass it to `MessageHandler` (or call it directly from the handler)

```typescript
// Before query()
const ackManager = options.messageStream
  ? new QueuedAckManager(emitEvent)
  : undefined;

// When creating prompt
if (options.messageStream && ackManager) {
  prompt = options.messageStream.createWrappedStream(config.prompt, ackManager);
}

// Pass to handler
const handler = new MessageHandler(config.anvilDir, accumulator, drainManager, 200_000, ackManager);
```

## Phase 4: Remove dead code from MessageHandler

**File:** `agents/src/runners/message-handler.ts`

1. Remove `pendingAcks` map and `checkDeferredAcks()` method
2. Remove the `isSynthetic === false` branch in `handleUser` (lines 235-253) — this is dead code since the SDK never emits these messages
3. Remove `appendUserMessage` import (only used in the dead branch)
4. Accept `QueuedAckManager` as optional constructor param
5. In `handleAssistant`, replace `this.checkDeferredAcks()` with `this.ackManager?.onAssistantTurn()`
6. In `handleResult`, replace `pendingAcks` nack loop with `this.ackManager?.drainNacks()`

The handler becomes a thin integration point — it just calls `ackManager.onAssistantTurn()` on assistant turns and `ackManager.drainNacks()` on exit. All ack state and logic lives in `QueuedAckManager`.

## Phase 5: Update and add tests

### New: `agents/src/lib/hub/__tests__/queued-ack-manager.test.ts`

1. `register` + 2x `onAssistantTurn` → emits ack
2. `register` + 1x `onAssistantTurn` + `drainNacks` → emits nack
3. Multiple messages tracked independently (register at different points)
4. `drainNacks` with empty map → no events
5. `size` reflects pending count accurately

### Update: `agents/src/runners/message-handler.test.ts`

1. Remove the "deferred queued message ack" describe block (lines 487-716) — this tested dead code
2. Add new tests verifying `handleAssistant` calls `ackManager.onAssistantTurn()` and `handleResult` calls `ackManager.drainNacks()`

### Update: `agents/src/lib/hub/__tests__/message-stream.test.ts` (if exists)

1. Test `createWrappedStream` calls `ackManager.register()` on SDK `.next()`, not on yield
2. Test wrapper `.return()` registers last consumed message
3. Test wrapper `.throw()` does not register

## Edge Cases

| Scenario | Wrapper | AckManager | Frontend |
| --- | --- | --- | --- |
| Happy path: 2+ assistant turns after queued msg | `.next()` → register | turns → 2 → ack | Clears pending |
| 1 tool call (2 assistant msgs): tool_use + final text | `.next()` → register | turn 1, turn 2 → ack | Clears pending |
| 2 tool calls in 1 assistant msg + final response | `.next()` → register | turn 1 (batch), turn 2 (final) → ack | Clears pending |
| Agent exits after 1 turn | `.next()` → register | turn 1, drainNacks → nack | Stays pending, resends |
| Agent crashes before `.next()` | No register | Nothing | Stays pending, resends |
| Agent crash after `.next()` but before 2 turns | register | drainNacks never called (crash) | Stays pending, resends |
