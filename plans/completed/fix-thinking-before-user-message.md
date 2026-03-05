# Fix: Thinking Blocks Appearing Before User Message

## Problem

During streaming, thinking blocks from the assistant appear **before** the user message in the thread, creating a jarring visual experience. The user types a message, but the assistant's thinking renders first, with the user message appearing later.

## Diagnosis

### Root Cause: `thread_action` messages are silently dropped

The data flow for committed state (user messages, assistant messages) is broken. Here's the chain:

1. **Agent side** (`agents/src/output.ts:65-73`): `dispatch()` applies a `ThreadAction` via reducer, writes to disk, then sends `thread_action` over the hub socket.

2. **Frontend bridge** (`src/lib/agent-service.ts:239-247`): The `thread_action` case handler **does NOT forward the action**. Instead it emits an `AGENT_STATE_DELTA` with `previousEventId: null` and **no `full` payload**:
   ```typescript
   case "thread_action":
     eventBus.emit(EventName.AGENT_STATE_DELTA, {
       id: `ta-${seq}`,
       previousEventId: null,   // triggers "full sync" branch
       threadId: msg.threadId,
       patches: [],             // no patches
       // NOTE: no `full` field!
     });
   ```

3. **Frontend listener** (`src/entities/threads/listeners.ts:153-165`): The `AGENT_STATE_DELTA` handler sees `previousEventId === null`, looks for a `full` payload, finds none, logs a warning, **resets the chain, and returns** — effectively dropping the event:
   ```typescript
   if (previousEventId === null || !lastAppliedEventId[threadId]) {
     if (full) {
       store.setThreadState(threadId, full);  // never reached
     } else {
       delete lastAppliedEventId[threadId];
       return;  // ← EVENT DROPPED
     }
   }
   ```

4. **Meanwhile**, `stream_delta` messages arrive in real-time (`src/lib/agent-service.ts:249-258`) and are dispatched directly to the `ThreadStateMachine` as `STREAM_DELTA` events. These create a `wipMessage` immediately.

5. **The result**: `ThreadStateMachine.getState()` returns `[...threadState.messages, wipMessage]`. Since no `APPEND_USER_MESSAGE` has been applied (it was dropped), `threadState.messages` is empty or stale. The wipMessage with thinking content appears at the end of an incomplete message list — rendering **before** the user message.

### Key Insight

The `ThreadStateMachine` has a `THREAD_ACTION` event type designed exactly for this:
```typescript
export type TransportEvent =
  | { type: "THREAD_ACTION"; action: ThreadAction; seq: number }
  | { type: "STREAM_DELTA"; payload: MachineStreamDelta }
  | { type: "HYDRATE"; state: ThreadState };
```

The machine's `applyAction()` method applies actions through the shared reducer and handles seq-based gap detection. But **nothing on the frontend dispatches `THREAD_ACTION` events to it**. The bridge in agent-service.ts converts them to AGENT_STATE_DELTA instead, which drops them.

### Why Stream Deltas Work But Actions Don't

Both `thread_action` and `stream_delta` travel over the same ordered socket connection. They arrive in the correct order (user message action BEFORE streaming deltas). But the frontend handles them differently:
- `stream_delta` → dispatched to machine as `STREAM_DELTA` → works
- `thread_action` → bridged to `AGENT_STATE_DELTA` → dropped → doesn't work

## Phases

- [ ] Wire `thread_action` → `THREAD_ACTION` through the state machine
- [ ] Add integration test verifying user message appears before thinking during streaming
- [ ] Remove or simplify the AGENT_STATE_DELTA bridge for thread_action

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Wire thread_action → THREAD_ACTION

In `src/lib/agent-service.ts`, change the `thread_action` case to dispatch directly through the store's machine instead of bridging to AGENT_STATE_DELTA:

```typescript
case "thread_action": {
  const store = useThreadStore.getState();
  if (msg.action) {
    store.dispatch(msg.threadId, {
      type: "THREAD_ACTION",
      action: msg.action,
      seq,  // hub-stamped sequence number for gap detection
    });
  }
  break;
}
```

This ensures:
- `APPEND_USER_MESSAGE` is applied BEFORE stream deltas (same socket ordering)
- `APPEND_ASSISTANT_MESSAGE` correctly clears `wipMessage` (machine line 122-129)
- Seq-based gap detection in the machine triggers HYDRATE recovery when needed

### Phase 2: Verify AGENT_STATE_DELTA Coexistence

The `AGENT_STATE_DELTA` path (periodic full snapshots) should continue to work for recovery. The machine's gap detection handles this: if a seq gap is detected from `THREAD_ACTION` events, the machine sets `hasGap = true`, and the caller can trigger a HYDRATE from disk.

Verify that `THREAD_ACTION` and `HYDRATE` (from AGENT_STATE_DELTA) don't conflict. The machine already handles this — HYDRATE replaces state and resets seq tracking.

## Files to Change

| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Wire `thread_action` → `store.dispatch(THREAD_ACTION)` |
| `src/entities/threads/listeners.ts` | May need to add seq tracking for gap → HYDRATE recovery |
