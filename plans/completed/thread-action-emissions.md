# Shared reducer: one accumulator for agent + client

## Problem

State accumulation is duplicated. The agent (`output.ts`) hand-rolls imperative mutations (`state.messages.push(...)`, `state.toolStates[id] = {...}`, etc.) while the client has a pure `threadReducer(state, action) → state` in `core/lib/thread-reducer.ts` that encodes the same logic. Any behavior change requires updating both — and they can drift.

Additionally, `output.ts` emits full `ThreadState` snapshots via `hubClient.sendState(snapshot)`, which the client doesn't even handle (no `case "state"` branch — hits `default` and logs unknown message type).

## Goal

**One reducer, two consumers.** Both the agent and client dispatch `ThreadAction`s through `threadReducer` from `core/`. The agent also sends each action over the socket so the client can apply the same reducer to stay in sync.

## Phases

- [x] Refactor `output.ts` to dispatch through `threadReducer`
- [x] Emit `ThreadAction` messages over socket (replace full snapshots)
- [x] Remove `sendState` dead code from HubClient
- [x] Run tests and fix failures

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Refactor `output.ts` to dispatch through `threadReducer`

Import and use the shared reducer instead of direct mutations.

### Core change

```ts
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
```

Replace the module-level `let state: ThreadState` with a pattern where every mutation dispatches an action:

```ts
function dispatch(action: ThreadAction): void {
  state = threadReducer(state, action);
}
```

Then each function becomes a thin wrapper:

| Function | Before (imperative) | After (dispatch) |
|---|---|---|
| `initState()` | `state = { messages, fileChanges, ... }` | `dispatch({ type: "INIT", payload: { ... } })` |
| `appendUserMessage()` | `state.messages.push(...)` | `dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id } })` |
| `appendAssistantMessage()` | `state.messages.push(message)` | `dispatch({ type: "APPEND_ASSISTANT_MESSAGE", payload: { message } })` |
| `markToolRunning()` | `state.toolStates[id] = {...}` | `dispatch({ type: "MARK_TOOL_RUNNING", payload: { toolUseId, toolName } })` |
| `markToolComplete()` | `state.toolStates[id] = {...}` | `dispatch({ type: "MARK_TOOL_COMPLETE", payload: { toolUseId, result, isError } })` |
| `updateFileChange()` | find/splice in `state.fileChanges` | `dispatch({ type: "UPDATE_FILE_CHANGE", payload: { change } })` |
| `setSessionId()` | `state.sessionId = id` | `dispatch({ type: "SET_SESSION_ID", payload: { sessionId } })` |
| `updateUsage()` | mutate `lastCallUsage` + `cumulativeUsage` | `dispatch({ type: "UPDATE_USAGE", payload: { usage } })` |
| `complete()` | `markOrphanedToolsAsError()` + set status | `dispatch({ type: "COMPLETE", payload: { metrics } })` |
| `error()` | `markOrphanedToolsAsError()` + set status | `dispatch({ type: "ERROR", payload: { message } })` |
| `cancelled()` | `markOrphanedToolsAsError()` + set status | `dispatch({ type: "CANCELLED" })` |

Key details:
- `markOrphanedToolsAsError()` is already handled inside the reducer's `applyComplete`, `applyError`, and `applyCancelled` helpers — delete the local copy from `output.ts`
- `appendUserMessage` needs to generate an `id` (nanoid) since the reducer's `APPEND_USER_MESSAGE` expects one
- `complete()` still needs to merge `lastCallUsage` into metrics before dispatching — the reducer already does this via `applyComplete`, so the local logic can be removed
- `updateUsage` metadata side-write stays (that's agent-only I/O, not state logic)

### `initState` special case

`initState` sets up paths, threadWriter, etc. in addition to initializing state. Keep the I/O setup, but replace the state construction:

```ts
export async function initState(...): Promise<void> {
  statePath = join(threadPath, "state.json");
  metadataPath = join(threadPath, "metadata.json");
  threadWriter = writer ?? null;

  // Initialize via reducer — same logic client uses on HYDRATE/INIT
  dispatch({
    type: "INIT",
    payload: {
      workingDirectory,
      messages: priorMessages,
      sessionId: priorSessionId,
      toolStates: priorToolStates,
      lastCallUsage: priorLastCallUsage,
      cumulativeUsage: priorCumulativeUsage,
      fileChanges: priorFileChanges,
    },
  });
  await emitState();
}
```

Note: The reducer's `applyInit` sets `timestamp: 0` — we need to reconcile this since `output.ts` currently sets `timestamp: Date.now()`. The `emitState()` call that follows sets `state.timestamp = Date.now()` anyway, so the reducer's `0` is fine — it gets overwritten before disk write.

### Reducer compatibility check

The reducer currently returns new objects (spread-based immutability). This is fine — `dispatch` just reassigns `state`. The only concern is `state.timestamp` — the reducer doesn't set it, but `emitState()` already handles that before writing.

## Phase 2: Emit `ThreadAction` messages over socket

Replace `hubClient.sendState(snapshot)` with targeted action emissions.

### New helper

```ts
function emitAction(action: ThreadAction): void {
  emitViaSocket(() => hubClient?.send({ type: "thread_action", action }));
}
```

### Updated dispatch

```ts
function dispatch(action: ThreadAction): void {
  state = threadReducer(state, action);
  emitAction(action);
}
```

Now every state change automatically sends the corresponding action to the client.

### `emitState()` becomes HYDRATE-only

The `emitState()` function is still needed for reconnection/cold-start, but it now emits a `HYDRATE` action instead of a raw state blob:

```ts
export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const snapshot = structuredClone(state);
  await writeStateToDisk(snapshot);
  emitAction({ type: "HYDRATE", payload: { state: snapshot } });
}
```

### Each mutation function

Each function calls `dispatch(action)` (which runs reducer + emits action), then calls disk write. The pattern:

```ts
export async function appendUserMessage(content: string): Promise<void> {
  const id = nanoid();
  dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id } });
  state.timestamp = Date.now();
  await writeStateToDisk(structuredClone(state));
}
```

Or if we want to keep `emitState()` as the standard disk+timestamp path, each function just does:

```ts
export async function appendUserMessage(content: string): Promise<void> {
  const id = nanoid();
  dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id } });
  await writeToDisk(); // timestamp + disk write, no socket (dispatch already emitted)
}
```

Either way, `dispatch` handles reducer + socket, and a separate call handles disk. The key change from before: socket emission moves from `emitState()` into `dispatch()`.

## Phase 3: Remove `sendState` dead code

After migration, `HubClient.sendState()` is unused. Remove:
- `sendState()` method from `agents/src/lib/hub/client.ts`
- `StateMessage` type from `agents/src/lib/hub/types.ts` (if it exists)
- Any re-exports of `StateMessage`

## Phase 4: Run tests and fix failures

- Run `cd agents && pnpm test`
- Tests in `output.test.ts` should align with new dispatch pattern
- The client-side routing already handles `thread_action` messages — verify end-to-end
