# Fix Child Thread Messages: Parity with Parent Thread Event/Reducer Pipeline

## Problem

Child threads bypass the parent thread's `dispatch()` → `threadReducer()` → socket pipeline entirely. Instead, `handleForChildThread` mutates a raw JS object, writes it to disk, and sends individual hub actions — many of which are incomplete or missing. This causes:

- "Repeat user messages" rendering bug (no message IDs → React key collisions)
- No live streaming text (stream_event messages are dropped)
- Missing user/tool-result messages in the conversation
- No terminal state actions (COMPLETE/ERROR/CANCELLED)

## Audit: All Child ↔ Parent Divergences

### 1. No message IDs on child thread messages

**Parent** (`message-handler.ts:184-189`): `id: nanoid()`, `anthropicId: msg.message.id`
**Child** (`message-handler.ts:614-617`): No `id`, no `anthropicId`
**PostToolUse** (`shared.ts:1145-1148`): Final appended response also lacks `id`/`anthropicId`
**Initial user message** (`shared.ts:800-804`): No `id`

### 2. No streaming deltas for child threads

**Parent**: `stream_event` → `StreamAccumulator.handleDelta()` → `hub.send({ type: "stream_delta" })` → client `STREAM_DELTA` reducer → live text
**Child**: `stream_event` hits the `default` branch in `handleForChildThread` switch/case (line 677-681) and is logged as "ignoring"

`SDKPartialAssistantMessage` DOES carry `parent_tool_use_id`, so streaming is routable — but `getParentToolUseId()` (line 505-515) only handles `assistant`, `user`, and `tool_progress` types, not `stream_event`. So stream events never reach `handleForChildThread` in the first place.

### 3. No `APPEND_USER_MESSAGE` for child thread tool results

**Parent** (`handleUser`): `appendUserMessage()` → `dispatch({ type: "APPEND_USER_MESSAGE" })` → socket
**Child** (`handleForChildThread` case "user"): Only updates `toolStates` + calls `emitChildThreadState`. **Never appends user message to `state.messages`**, never sends `APPEND_USER_MESSAGE` action.

Result: child messages array is `[user, assistant, assistant, assistant, ...]` instead of `[user, assistant, user, assistant, ...]`.

### 4. No `COMPLETE`/`ERROR`/`CANCELLED` reducer actions

**Parent**: `handleResult()` → `complete()` / `error()` / `cancelled()` → `dispatch(...)` → socket
**Child**: PostToolUse (`shared.ts:1150`) sets `state.status = "complete"` directly on the disk JSON and emits `THREAD_STATUS_CHANGED`, but never dispatches a `COMPLETE` action. `markOrphanedTools` never fires for child threads, leaving tools stuck as "running".

No `AGENT_COMPLETED` event is emitted for child threads either — only `THREAD_STATUS_CHANGED`.

### 5. No streaming accumulator for child threads

**Parent**: `StreamAccumulator` is constructed per-agent, processes `stream_event` messages, and emits `stream_delta` socket messages with the parent's `threadId`.
**Child**: There is no `StreamAccumulator` instance scoped to the child thread's `threadId`. Even if we route `stream_event` to `handleForChildThread`, there's no accumulator to process them.

### 6. Child thread mutates state directly, bypasses reducer

**Parent**: ALL mutations go through `dispatch()` → `threadReducer()` → disk write. Immutable, deduplication built-in.
**Child**: `handleForChildThread` mutates a raw JS object (`state.messages.push(...)`, `state.toolStates[id] = ...`), then writes via `emitChildThreadState()`. Reducer is bypassed entirely — no deduplication, no WIP map handling.

### 7. No `INIT`/`HYDRATE` action for child thread creation

**Parent**: `initState()` → `dispatch({ type: "INIT" })` + disk write. On reconnect, `emitState()` sends `HYDRATE`.
**Child**: Initial state written as raw JSON (`shared.ts:799-815`). No `INIT` dispatched, no `HYDRATE` sent. If user is viewing a child thread when it starts, there's no initial state in the client reducer.

### Not applicable for child threads

- **`SET_SESSION_ID`**: The SDK doesn't support resuming sub-agent sessions. Not relevant.
- **`UPDATE_FILE_CHANGE`**: Child tool executions happen inside the SDK subprocess. The parent only receives `assistant`/`user` messages — PostToolUse hooks for child tools fire in the child process, not here. This is an SDK architectural boundary, not something fixable from the parent side.

---

## Fix Strategy

The root fix is: **child threads should use the same event/reducer pattern as parent threads**, not a parallel hand-rolled implementation.

### Phase 1: Add IDs to all child thread messages + initialize wipMap/blockIdMap (quick fix for render bug)

**Files:** `agents/src/runners/message-handler.ts`, `agents/src/runners/shared.ts`

1. **Initial user message** (`shared.ts:~800`): Add `id: crypto.randomUUID()`
2. **Assistant messages** (`message-handler.ts:~614`): Add `id: nanoid()`, `anthropicId: msg.message.id`
3. **PostToolUse final response** (`shared.ts:~1145`): Add `id: nanoid()` to the appended assistant message
4. Ensure the `APPEND_ASSISTANT_MESSAGE` hub action payload includes the `id`/`anthropicId` fields
5. **Add `wipMap: {}` and `blockIdMap: {}` to child initial state** (`shared.ts:~799`): The client-side reducer needs these maps to handle streaming → committed message replacement. Without them, `STREAM_DELTA` → `APPEND_ASSISTANT_MESSAGE` transitions won't replace WIP messages in-place — they'll either error or create duplicates.

### Phase 2: Append user (tool-result) messages to child state

**File:** `agents/src/runners/message-handler.ts`

In the `case "user"` branch of `handleForChildThread` (~line 636), after updating `toolStates`, also:
1. Append the user message to `state.messages` (with `id: nanoid()`)
2. Send `APPEND_USER_MESSAGE` action via `hub.sendActionForThread`

This restores the proper `[user, assistant, user, assistant, ...]` conversation structure.

### Phase 3: Add streaming support for child threads

**Files:** `agents/src/runners/message-handler.ts`

1. Extend `getParentToolUseId()` to also handle `stream_event` messages (they carry `parent_tool_use_id`)
2. Create a per-child `StreamAccumulator` (keyed by `childThreadId`) when the first `stream_event` arrives
3. Handle `stream_event` in `handleForChildThread` — route to the child's accumulator
4. The accumulator already parameterizes by `threadId` — it just needs to use `childThreadId`
5. On `message_stop`, flush + reset as parent does
6. **Maintain `wipMap`/`blockIdMap` on disk state:** When `handleForChildThread` sends `STREAM_START`/`STREAM_DELTA` actions via hub, the client reducer will update its `wipMap`/`blockIdMap`. But the disk state (mutated directly) must also track these maps so that HYDRATE on reconnect produces a consistent snapshot. When the committed `APPEND_ASSISTANT_MESSAGE` arrives, consume the wipMap entry on the disk state too (mirroring the reducer logic).

### Phase 4: Dispatch terminal state actions for child threads

**Files:** `agents/src/runners/shared.ts`

1. In PostToolUse:SubAgent completion (`shared.ts:~1150`), send a `COMPLETE` action via `hub.sendActionForThread(childThreadId, { type: "COMPLETE", payload: { metrics } })`
2. In PostToolUseFailure:SubAgent (`shared.ts:~1217`), send an `ERROR` action via hub
3. Emit `AGENT_COMPLETED` event (not just `THREAD_STATUS_CHANGED`) so the listener in `listeners.ts:159` fires — this triggers `loadThreadState` for visible threads and marks them unread

### Phase 5: Send HYDRATE on child thread creation

**File:** `agents/src/runners/shared.ts`

After writing initial `state.json` (~line 815), send a `HYDRATE` action via `hub.sendActionForThread(childThreadId, { type: "HYDRATE", payload: { state: initialState } })` so the client-side reducer has the initial state if the user is already viewing the thread.

### Phase 6: Tests

1. Unit test: `handleForChildThread` assistant messages include `id`/`anthropicId`
2. Unit test: `handleForChildThread` user messages are appended to `state.messages` with `id`
3. Unit test: streaming `stream_event` messages create child accumulator and emit `stream_delta`
4. Unit test: PostToolUse completion sends `COMPLETE` action and `AGENT_COMPLETED` event
5. Verify existing integration tests pass

## Phases

- [ ] Add `id` fields to all child thread messages (message-handler.ts, shared.ts)
- [ ] Append user/tool-result messages to child state + send APPEND_USER_MESSAGE action
- [ ] Add streaming support via per-child StreamAccumulator
- [ ] Dispatch COMPLETE/ERROR actions + emit AGENT_COMPLETED for child threads
- [ ] Send HYDRATE action on child thread creation
- [ ] Add/update tests, verify integration tests pass

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to modify

| File | Change |
|------|--------|
| `agents/src/runners/message-handler.ts` | Add `id`/`anthropicId` to child messages; append user messages; extend `getParentToolUseId` for `stream_event`; handle streaming with per-child accumulator |
| `agents/src/runners/shared.ts` | Add `id` to initial user message; add `id` to PostToolUse final response; send COMPLETE/ERROR actions + AGENT_COMPLETED; send HYDRATE on creation |
| `agents/src/runners/message-handler.test.ts` | Tests for all new child thread behaviors |
