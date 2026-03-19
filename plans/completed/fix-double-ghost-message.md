# Fix double ghost message for queued messages

## Context

After implementing the pinned message flow (queued-message-ui-polish), queued messages have two issues:

1. **Double ghost** — `appendUserMessage()` emits over socket, so the message appears both inline (thread store) AND pinned (queued store)
2. **Ordering on reload** — `appendUserMessageLocal()` fixes the double ghost by skipping socket emit, but on reload from disk the message appears at injection position (where SDK consumed it) instead of at the end (where the ACK placed it during live operation)

## Fix

**Use `appendUserMessageLocal()` (no socket emit) to prevent double ghost.** Then on ACK, dispatch a new `MOVE_MESSAGE_TO_END` reducer action that removes the message from its injection position and re-appends it at the end. This action goes through `dispatch()` (socket emit + disk write), so both state.json and the frontend get the correct final ordering.

Flow:
1. User queues message → pinned ghost appears
2. SDK consumes → `appendUserMessageLocal` writes to state.json only (no socket emit, pinned stays)
3. ACK fires (2 assistant turns later) → agent dispatches `MOVE_MESSAGE_TO_END` (emits over socket + writes to disk) → frontend receives thread_action, moves message to end
4. Frontend ACK handler confirms queued store → pinned disappears
5. On reload: state.json has message at end position (correct)

## Phases

- [x] Add `appendUserMessageLocal()` to `output.ts` (already done)
- [x] Wire `runner.ts` to use `appendUserMessageLocal` (already done)
- [x] Fix PinnedUserMessage styling: remove opacity, add "queued" label (already done)
- [ ] Add `MOVE_MESSAGE_TO_END` action to thread reducer
- [ ] Add `moveMessageToEnd()` to `output.ts` (uses `dispatch` for socket emit + disk write)
- [ ] Call `moveMessageToEnd()` from `QueuedAckManager` on ACK
- [ ] Verify ACK handler on frontend still works (should be no-op for thread store due to dedup)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation details

### 1. `core/lib/thread-reducer.ts` — new action type + handler

Add to `ThreadAction` union:
```typescript
| { type: "MOVE_MESSAGE_TO_END"; payload: { id: string } }
```

Add case in `threadReducer`:
```typescript
case "MOVE_MESSAGE_TO_END": {
  const idx = state.messages.findIndex((m) => m.id === action.payload.id);
  if (idx === -1) return state;
  const msg = state.messages[idx];
  const messages = [...state.messages];
  messages.splice(idx, 1);
  messages.push(msg);
  return { ...state, messages };
}
```

### 2. `agents/src/output.ts` — new function

```typescript
export async function moveMessageToEnd(id: string): Promise<void> {
  dispatch({ type: "MOVE_MESSAGE_TO_END", payload: { id } });
  await writeToDisk();
}
```

### 3. `agents/src/lib/hub/queued-ack-manager.ts` — call moveMessageToEnd on ACK

Add a second callback to the constructor:
```typescript
type MoveMessageToEnd = (id: string) => Promise<void>;

constructor(emitEvent: EmitEvent, moveMessageToEnd: MoveMessageToEnd) {
  this.emitEvent = emitEvent;
  this.moveMessageToEnd = moveMessageToEnd;
}
```

In `onAssistantTurn()`, call it before emitting the ACK event:
```typescript
if (newTurns >= 2) {
  await this.moveMessageToEnd(messageId);
  this.emitEvent("queued-message:ack", { messageId }, "QueuedAckManager:ack");
  // ...
}
```

Note: `onAssistantTurn` needs to become async.

### 4. `agents/src/runners/shared.ts` — pass moveMessageToEnd to QueuedAckManager

```diff
- new QueuedAckManager(emitEvent)
+ new QueuedAckManager(emitEvent, moveMessageToEnd)
```

Import `moveMessageToEnd` from `output.ts`.

### 5. Frontend `agent-service.ts` ACK handler — no change needed

The existing handler dispatches `APPEND_USER_MESSAGE` to the thread store. With `MOVE_MESSAGE_TO_END` arriving first via thread_action, the message is already in the thread store at the correct position. The dedup check in the reducer makes the ACK handler's dispatch a no-op. The `confirmMessage` call removes the pinned copy.
