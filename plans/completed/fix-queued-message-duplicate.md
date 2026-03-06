# Fix Queued Messages Rendering Twice

## Problem

When a user sends a queued message (follow-up while agent is running), the message appears **twice** in the thread. The root cause is a **three-way ID mismatch** across frontend, runner, and output layers.

### Trace of the bug

1. **Frontend** (`thread-content.tsx:298-302`): Generates `messageId = crypto.randomUUID()` (e.g. `"abc-123"`), dispatches `APPEND_USER_MESSAGE { id: "abc-123" }` to thread store, then calls `sendQueuedMessage(threadId, content, "abc-123")`

2. **Frontend** (`agent-service.ts:372-374`): Sends to agent socket: `{ type: "queued_message", payload: { id: "abc-123", content, timestamp } }`

3. **Agent runner** (`runner.ts:233-239`): Receives the message but **ignores `payload.id`** and generates a brand new `crypto.randomUUID()` → `"xyz-789"`. Pushes `messageStream.push("xyz-789", content)`.

4. **Message stream** (`message-stream.ts:83-93`): Emits ACK with `messageId: "xyz-789"` (wrong ID!) and calls `appendUserMessage(content)` — **without any ID**.

5. **Output** (`output.ts:184-185`): `appendUserMessage(content)` generates yet another ID via `nanoid()` → `"qrs-456"`, dispatches `APPEND_USER_MESSAGE { id: "qrs-456", content }` back to frontend.

6. **Frontend thread reducer** (`thread-reducer.ts:52`): Dedup check `state.messages.some(m => m.id === "qrs-456")` → `false` (original was `"abc-123"`). **Message is added again → duplicate rendering.**

7. **ACK failure**: Frontend receives ACK with `messageId: "xyz-789"`, calls `confirmMessage("xyz-789")` on queued store — but the store has the message under `"abc-123"` → **confirmation fails silently**, queued message banner may never clear.

### Three IDs, one message

| Layer | ID Generated | Used For |
|-------|-------------|----------|
| Frontend (`thread-content.tsx`) | `crypto.randomUUID()` → `"abc-123"` | Thread store + queued store |
| Runner (`runner.ts`) | `crypto.randomUUID()` → `"xyz-789"` | Message stream + ACK |
| Output (`output.ts`) | `nanoid()` → `"qrs-456"` | Thread action emitted to frontend |

The thread reducer's dedup guard works correctly — the problem is that **the same message arrives with different IDs**.

## Fix

Thread the frontend's `messageId` through the entire chain so the reducer's dedup correctly identifies the duplicate.

### Changes

1. **`agents/src/lib/hub/types.ts`** — Add `id` to `queued_message` payload type:
   ```typescript
   | { type: "queued_message"; payload: { id: string; content: string } }
   ```

2. **`agents/src/runner.ts:233-239`** — Use `msg.payload.id` instead of generating a new UUID:
   ```typescript
   case "queued_message": {
     const { id, content } = msg.payload;
     logger.info(`[runner] Received queued message, injecting into stream: ${id}`);
     messageStream.push(id, content);
     break;
   }
   ```

3. **`agents/src/lib/hub/message-stream.ts`** — Pass `msg.id` through to `appendUserMessage`:
   - Change `AppendUserMessage` type: `(id: string, content: string) => Promise<void>`
   - Line ~91: `await this.appendUserMessage(msg.id, msg.content);`

4. **`agents/src/output.ts`** — Accept optional `id` parameter:
   ```typescript
   export async function appendUserMessage(id: string, content: string): Promise<void> {
     dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id } });
     await writeToDisk();
   }
   ```

5. **`agents/src/runner.ts:166`** — Update the `setAppendUserMessage` binding to pass through correctly (the function signature change should make this transparent, but verify callsites).

### How the initial message does it correctly (for reference)

The first message already threads the ID end-to-end:
1. Frontend generates `messageId`, dispatches `APPEND_USER_MESSAGE` locally
2. Passes `messageId` as `--message-id` CLI arg to `spawnSimpleAgent`/`resumeSimpleAgent` (`agent-service.ts:742, 912`)
3. `simple-runner-strategy.ts:235` parses it into `config.messageId`
4. `shared.ts:444`: `id: config.messageId ?? crypto.randomUUID()` — uses the frontend's ID in the `INIT` payload

Since `INIT` replaces the full state (including messages array), the same ID is preserved and there's no duplicate. The queued message path just needs to follow this same pattern.

### What already works

- Thread reducer dedup at `thread-reducer.ts:52` — `if (state.messages.some((m) => m.id === action.payload.id)) return state;` — is correct, it just never matches because the IDs differ.
- Frontend `sendQueuedMessageSocket` correctly passes `messageId` in the socket payload.

## Phases

- [x] Fix the ID passthrough chain (types.ts → runner.ts → message-stream.ts → output.ts)
- [x] Add thread-reducer test for APPEND_USER_MESSAGE dedup (currently untested)
- [x] Verify ACK confirmation works with stable IDs (queued store clears correctly)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
