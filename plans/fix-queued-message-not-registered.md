# Fix Queued Messages Not Registered by Claude

## Problem

When a user sends a queued message while the agent is running, the message gets acked (visual indicator shows briefly) but Claude never responds to it. The message appears in the thread but is effectively ignored.

## Root Cause

The ack fires too early — before the SDK has actually consumed the message. The current flow in `SocketMessageStream.createStream()` is:

1. `appendUserMessage()` — disk write
2. `emitEvent("queued-message:ack")` — tells frontend "message received"
3. `yield` to SDK — SDK may or may not consume this

If the agent exits between steps 2 and 3 (or after yield but before the SDK's internal `.next()` resolves), the message is on disk and acked but Claude never saw it. Reconciliation then finds it in `state.json` and confirms it — a false positive, since **"written to state.json" ≠ "processed by Claude."**

The SDK provides **no ingestion confirmation mechanism** — `query()` accepts an `AsyncIterable<SDKUserMessage>` and the JS async generator protocol has no return value from `yield`. There's no callback, event, or promise. The V2 SDK preview has `send()` returning `Promise<void>` but it's unstable ([ref](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)).

## Solution: Defer ack until SDK consumption (generator wrapper)

The key insight: when the SDK calls `.next()` on our generator, that **proves** it consumed the previous yield. We wrap the generator to intercept `.next()` calls and emit the ack at that point instead of before the yield.

If the ack never fires (agent crash, exit before consumption), the frontend never clears the pending state — so it resends on reconnect. No reconciliation changes needed.

## Phases

- [x] Fix visual indicator minimum display duration (already done)

- [ ] Implement generator wrapper to defer ack until SDK consumption

- [ ] Update tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix visual indicator minimum display duration

**Already completed.** `user-message.tsx` now holds the pending state for at least 800ms even if the ack arrives instantly.

## Phase 2: Implement generator wrapper to defer ack until SDK consumption

**File:** `agents/src/lib/hub/message-stream.ts`

The wrapper intercepts the SDK's `.next()` calls on the async generator. When the SDK asks for the next message, we know it consumed the previous one — that's our ack signal.

**New function** (add to `message-stream.ts` or a new `ack-on-consume-wrapper.ts`):

```typescript
/**
 * Wraps an async generator to defer ack emission until the SDK
 * actually consumes each yielded message (by calling .next() again).
 *
 * JS async generator contract: execution after a `yield` only resumes
 * when the consumer calls `.next()`. So when we enter `.next()` for
 * message N+1, we know message N was consumed.
 */
function withAckOnConsume(
  inner: AsyncGenerator<SDKUserMessage>,
  emitAck: (messageId: string) => void,
): AsyncGenerator<SDKUserMessage> {
  let pendingAckId: string | null = null;

  const wrapper: AsyncGenerator<SDKUserMessage> = {
    async next(...args: [] | [unknown]) {
      // SDK is pulling next message → it consumed the previous one
      if (pendingAckId) {
        emitAck(pendingAckId);
        pendingAckId = null;
      }

      const result = await inner.next(...args);

      if (!result.done && result.value.uuid) {
        // Track this message's ID for acking on the NEXT .next() call
        pendingAckId = result.value.uuid;
      }

      return result;
    },

    async return(value?: unknown) {
      // Generator closing (agent exit, stream end)
      // Ack the last message if SDK consumed it before closing
      if (pendingAckId) {
        emitAck(pendingAckId);
        pendingAckId = null;
      }
      return inner.return(value);
    },

    async throw(err?: unknown) {
      pendingAckId = null; // Don't ack on error
      return inner.throw(err);
    },

    [Symbol.asyncIterator]() {
      return wrapper;
    },
  };

  return wrapper;
}
```

**Changes to** `createStream()` — remove the ack emission from inside the generator:

```typescript
async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
  yield this.formatUserMessage(initialPrompt, true);

  try {
    while (!this.closed) {
      const msg = await this.waitForMessage();
      if (msg === null) break;

      // Disk write still happens before yield (needed for crash recovery)
      if (this.appendUserMessage) {
        await this.appendUserMessage(msg.id, msg.content);
      }

      // *** REMOVED: ack emission no longer happens here ***
      // It now fires in the wrapper when the SDK calls .next()

      yield this.formatUserMessage(msg.content, false, msg.id);
    }
  } finally {
    this.close();
  }
}
```

**New public method** on `SocketMessageStream`:

```typescript
/** Returns the stream wrapped so acks fire on SDK consumption, not on yield. */
createWrappedStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
  const inner = this.createStream(initialPrompt);
  return withAckOnConsume(inner, (messageId) => {
    if (this.eventEmitter) {
      this.eventEmitter("queued-message:ack", { messageId });
    }
  });
}
```

**Update** `shared.ts` (\~line 1378) to call `createWrappedStream()` instead of `createStream()`:

```typescript
if (options.messageStream) {
  prompt = options.messageStream.createWrappedStream(config.prompt);
}
```

### Ack timing diagram (before vs after)

```
BEFORE (broken):
  push() → waitForMessage() → disk write → ACK → yield → ???
                                             ↑
                                       ack fires here
                                       (SDK hasn't consumed yet)

AFTER (fixed):
  push() → waitForMessage() → disk write → yield → SDK calls .next() → ACK
                                                                         ↑
                                                                   ack fires here
                                                                   (SDK consumed it)
```

## Phase 3: Update tests

### Generator wrapper tests

**File:** `agents/src/lib/hub/__tests__/ack-on-consume-wrapper.test.ts` (new)

1. **Ack fires on next** `.next()` **call, not on yield** — create a mock generator yielding messages with UUIDs, wrap it, verify ack callback fires only when the wrapper's `.next()` is called for the subsequent message
2. **Ack fires on** `.return()` — verify the last message gets acked when the generator is closed
3. **No ack on** `.throw()` — verify errors don't trigger acks
4. **Initial synthetic message (no UUID) is skipped** — verify no ack for the first yield
5. **Multiple messages in sequence** — verify each gets acked in order

## Risk Assessment

- **Phase 2** (wrapper) is medium-risk — changes the ack timing for all queued messages. The wrapper is purely additive (intercepts `.next()` calls) and doesn't modify the SDK or the inner generator. If the wrapper has a bug, worst case is acks are delayed or lost — frontend keeps message pending and resends on reconnect.
- **Phase 3** is no-risk — test-only.

## Edge Cases

| Scenario | Wrapper behavior | Frontend behavior |
| --- | --- | --- |
| Happy path (message consumed, agent continues) | Ack fires on next `.next()` | Clears pending state |
| Agent exits right after consuming last message | Ack fires via `.return()` | Clears pending state if ack delivered; resends if not |
| Agent crashes before consuming yield | No ack (correct!) | Message stays pending, resends on reconnect |
| Agent crashes after consuming but before `.return()` | No ack (wrapper never ran) | Message stays pending, resends on reconnect (harmless duplicate) |
