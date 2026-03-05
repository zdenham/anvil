# Phase 1: Shared Thread Reducer

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-1-threadstatemachine)

## Goal

Create a **shared pure reducer** in `core/` that defines all `ThreadState` transitions. Both the agent process and the client import and use this same reducer. One source of truth for how state changes — no drift possible.

The reducer also replaces JSON Patch diffs as the emission model. Instead of computing patches between states, the agent sends **actions** over the socket. The client feeds actions through the same reducer to reconstruct state. Actions ARE the wire format. This eliminates `structuredClone` + `fast-json-patch.compare()` on every emit and guarantees agent/client consistency by construction.

## Why Shared

`output.ts` currently has 9 imperative mutation functions that directly mutate a module-level `ThreadState`. The original plan would have created a separate `ThreadStateMachine` in `src/lib/` that independently re-implemented the same logic. Two accumulators = inevitable drift. Instead:

1. **`core/lib/thread-reducer.ts`** — pure `(state, action) → state`, zero side effects
2. **`agents/src/output.ts`** — refactored to `dispatch(action)`: reducer → disk write → send action over socket
3. **`src/lib/thread-state-machine.ts`** — client wrapper that receives actions, feeds to same reducer, adds gap detection

## Dependencies

- **Phase 0** must be complete (chain tracking removed, types simplified, StoredMessage added)

## Phases

- [x] Define `ThreadAction` type and `threadReducer` function in `core/lib/thread-reducer.ts`
- [x] Write unit tests for the reducer in `core/lib/__tests__/thread-reducer.test.ts`
- [x] Refactor `agents/src/output.ts` — replace mutations with `dispatch()`, emit actions instead of patches
- [x] Create client-side `ThreadStateMachine` in `src/lib/thread-state-machine.ts` using the shared reducer
- [x] Write client-side tests in `src/lib/__tests__/thread-state-machine.test.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

```
core/lib/thread-reducer.ts          ← pure (state, action) → state
       ↑                      ↑
       │                      │
agents/src/output.ts      src/lib/thread-state-machine.ts
  dispatch(action):         apply(action):
  1. reducer(state, action)   1. reducer(state, action)
  2. write state to disk      2. update Zustand store
  3. send action over socket  (receives actions from socket)
```

The reducer owns **what** changes. The consumers own **when** and **how** (side effects).

**Wire format change:** The agent sends `ThreadAction` objects over the socket instead of JSON Patch diffs. The client applies them through the same reducer. Gap recovery reads full state from disk — no patches needed.

---

## Part 1: Shared Reducer (`core/lib/thread-reducer.ts`)

### `ThreadAction` — discriminated union

Maps 1:1 to the mutation functions in `output.ts`:

```ts
import type { StoredMessage } from "../types/events.js";

export type ThreadAction =
  | { type: "INIT"; payload: InitPayload }
  | { type: "APPEND_USER_MESSAGE"; payload: { content: string; id: string } }
  | { type: "APPEND_ASSISTANT_MESSAGE"; payload: { message: StoredMessage } }
  | { type: "MARK_TOOL_RUNNING"; payload: { toolUseId: string; toolName: string } }
  | { type: "MARK_TOOL_COMPLETE"; payload: { toolUseId: string; result: string; isError: boolean } }
  | { type: "UPDATE_FILE_CHANGE"; payload: { change: FileChange } }
  | { type: "SET_SESSION_ID"; payload: { sessionId: string } }
  | { type: "UPDATE_USAGE"; payload: { usage: TokenUsage } }
  | { type: "COMPLETE"; payload: { metrics: ResultMetrics } }
  | { type: "ERROR"; payload: { message: string } }
  | { type: "CANCELLED" }
  | { type: "HYDRATE"; payload: { state: ThreadState } };

interface InitPayload {
  workingDirectory: string;
  messages?: StoredMessage[];
  sessionId?: string;
  toolStates?: Record<string, ToolExecutionState>;
  lastCallUsage?: TokenUsage;
  cumulativeUsage?: TokenUsage;
  fileChanges?: FileChange[];
}
```

Note: `APPEND_USER_MESSAGE` includes `id` in the payload. The caller generates the ID (via `nanoid()`), not the reducer — the reducer is pure and deterministic.

### `threadReducer` — the pure function

```ts
export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "INIT":
      return applyInit(action.payload);
    case "APPEND_USER_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, {
          role: "user" as const,
          content: action.payload.content,
          id: action.payload.id,
        }],
      };
    case "APPEND_ASSISTANT_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.payload.message],
      };
    case "MARK_TOOL_RUNNING":
      return {
        ...state,
        toolStates: {
          ...state.toolStates,
          [action.payload.toolUseId]: {
            status: "running",
            toolName: action.payload.toolName,
          },
        },
      };
    case "MARK_TOOL_COMPLETE":
      return applyMarkToolComplete(state, action.payload);
    case "UPDATE_FILE_CHANGE":
      return applyUpdateFileChange(state, action.payload);
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.payload.sessionId };
    case "UPDATE_USAGE":
      return applyUpdateUsage(state, action.payload);
    case "COMPLETE":
      return applyComplete(state, action.payload);
    case "ERROR":
      return applyError(state, action.payload);
    case "CANCELLED":
      return applyCancelled(state);
    case "HYDRATE":
      return { ...action.payload.state };
  }
}
```

### Helper functions (all pure, private-scope)

Same as original plan: `applyInit`, `applyMarkToolComplete`, `applyUpdateFileChange`, `applyUpdateUsage`, `applyComplete`, `applyError`, `applyCancelled`, `markOrphanedTools`. See original plan for implementations — they're unchanged.

### Export from core

```ts
// core/lib/index.ts
export { threadReducer, type ThreadAction } from "./thread-reducer.js";
```

---

## Part 2: Reducer Tests (`core/lib/__tests__/thread-reducer.test.ts`)

Same test categories as original plan:

1. **INIT** — creates running state with defaults, preserves prior messages/toolStates/usage
2. **APPEND_USER_MESSAGE** — appends with `id`, immutable (new array reference)
3. **APPEND_ASSISTANT_MESSAGE** — appends `StoredMessage`, preserves other fields
4. **MARK_TOOL_RUNNING** — adds to toolStates
5. **MARK_TOOL_COMPLETE** — preserves toolName from running state
6. **UPDATE_FILE_CHANGE** — insert new, upsert existing by path
7. **SET_SESSION_ID** — sets sessionId
8. **UPDATE_USAGE** — sets lastCallUsage, accumulates cumulativeUsage
9. **COMPLETE** — marks orphaned tools, sets metrics + status
10. **ERROR** — marks orphaned tools, sets error + status
11. **CANCELLED** — marks orphaned tools, sets status
12. **HYDRATE** — full state replacement
13. **Immutability** — every action returns new object reference
14. **Sequence replay** — `replayActions(actions)` twice produces identical output

---

## Part 3: Agent Refactor (`agents/src/output.ts`)

This is the biggest change. The 9 mutation functions become thin wrappers around a central `dispatch()`. The entire emission pipeline (patches, `emitViaSocket`, `previousEmittedState`) is replaced.

### New `dispatch()` function

Replaces `emitState()`, `emitViaSocket()`, and all patch computation:

```ts
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";

let state: ThreadState = { /* initial */ };
let hubClient: HubClient | null = null;

async function dispatch(action: ThreadAction): Promise<void> {
  state = threadReducer(state, action);
  state.timestamp = Date.now();

  // Disk write first — disk is truth
  await writeStateToDisk(state);

  // Send action over socket — HubClient stamps seq, drops when disconnected
  hubClient?.send({
    type: "thread_action",
    threadId: state.workingDirectory, // or however threadId is determined
    action,
  });
}
```

### What gets deleted from output.ts

| Deleted | Why |
|---------|-----|
| `previousEmittedState` | No patch diffing — actions ARE the wire format |
| `emitViaSocket()` | No connection-state checking — `send()` drops when not connected (Phase 0) |
| `emitState()` | Replaced by `dispatch()` |
| `fast-json-patch` import | No more patch computation |
| `structuredClone()` calls | No more snapshot-for-diff |

### Mutation functions become one-liners

```ts
export async function appendUserMessage(content: string): Promise<void> {
  await dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id: nanoid() } });
}

export async function appendAssistantMessage(message: StoredMessage): Promise<void> {
  await dispatch({ type: "APPEND_ASSISTANT_MESSAGE", payload: { message } });
}

export async function markToolRunning(toolUseId: string, toolName: string): Promise<void> {
  await dispatch({ type: "MARK_TOOL_RUNNING", payload: { toolUseId, toolName } });
}

export async function markToolComplete(toolUseId: string, result: string, isError: boolean): Promise<void> {
  await dispatch({ type: "MARK_TOOL_COMPLETE", payload: { toolUseId, result, isError } });
}

// ... same pattern for all 9 functions
```

Side effects that stay in the wrappers (not in the reducer):
- `writeUsageToMetadata()` in `updateUsage()` (metadata.json side-write)
- `normalizeToRelativePath()` before `UPDATE_FILE_CHANGE` dispatch
- Consecutive assistant message warning log in `appendAssistantMessage()`

### `initState()` special case

`initState` both dispatches an INIT action AND resets module-level bookkeeping:

```ts
export async function initState(
  workingDirectory: string,
  priorMessages: StoredMessage[],
  // ... other params
): Promise<void> {
  await dispatch({
    type: "INIT",
    payload: { workingDirectory, messages: priorMessages, ... },
  });
}
```

No `previousEmittedState = null` needed — there's no patch diffing.

### First emit behavior

Currently, the first emit sends `full: snapshot` because `previousEmittedState` is null. With actions, every emit is self-describing — the client applies the action through the reducer. The first action the client receives is typically INIT (with full prior state). No special "full snapshot" logic needed.

For **client cold start / reconnect**, the client reads `state.json` from disk (HYDRATE action), then applies subsequent actions. This replaces the `full` field on `StateEvent`.

---

## Part 4: Client State Machine (`src/lib/thread-state-machine.ts`)

Simplified compared to original plan. The machine just applies actions through the shared reducer and manages gap detection via seq numbers. Stream deltas remain a separate channel (not part of the reducer).

### Class

```ts
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type { ThreadState } from "@core/types/events.js";

interface ThreadRenderState {
  // From shared reducer — messages may include a WIP assistant message
  // with isStreaming: true on its content blocks during streaming
  messages: ThreadState["messages"];
  toolStates: ThreadState["toolStates"];
  status: ThreadState["status"];
  fileChanges: ThreadState["fileChanges"];
  metrics?: ThreadState["metrics"];
  error?: string;
}

/**
 * Events received from the socket transport layer.
 * thread_action carries a ThreadAction from the agent.
 * stream_delta carries ephemeral streaming content.
 */
type TransportEvent =
  | { type: "THREAD_ACTION"; action: ThreadAction; seq: number }
  | { type: "STREAM_DELTA"; payload: StreamDeltaPayload }
  | { type: "HYDRATE"; state: ThreadState };

class ThreadStateMachine {
  private threadState: ThreadState;
  private lastSeq: number | null = null;
  /** Stable ID of the WIP assistant message inserted during streaming. */
  private wipMessageId: string | null = null;

  constructor(initial?: ThreadState) {
    this.threadState = initial ?? {
      messages: [], fileChanges: [], workingDirectory: "",
      status: "running", timestamp: 0, toolStates: {},
    };
  }

  getState(): ThreadRenderState {
    return {
      messages: this.threadState.messages,
      toolStates: this.threadState.toolStates,
      status: this.threadState.status,
      fileChanges: this.threadState.fileChanges,
      metrics: this.threadState.metrics,
      error: this.threadState.error,
    };
  }

  apply(event: TransportEvent): ThreadRenderState {
    switch (event.type) {
      case "THREAD_ACTION":
        return this.applyAction(event);
      case "STREAM_DELTA":
        return this.applyStreamDelta(event.payload);
      case "HYDRATE":
        return this.applyHydrate(event.state);
    }
  }

  private applyAction(event: { action: ThreadAction; seq: number }): ThreadRenderState {
    // Gap detection via seq
    if (this.lastSeq !== null && event.seq !== this.lastSeq + 1) {
      this.lastSeq = null;
      return this.getState();
    }
    this.lastSeq = event.seq;

    // Apply through shared reducer — this replaces the WIP message
    // with the final committed content (no isStreaming flags)
    this.threadState = threadReducer(this.threadState, event.action);

    // Clear WIP tracking when message is committed
    if (event.action.type === "APPEND_ASSISTANT_MESSAGE" ||
        event.action.type === "COMPLETE" ||
        event.action.type === "ERROR" ||
        event.action.type === "CANCELLED") {
      this.wipMessageId = null;
    }

    return this.getState();
  }

  private applyStreamDelta(payload: StreamDeltaPayload): ThreadRenderState {
    // Find or create the WIP assistant message in the messages array
    let wipIndex = this.wipMessageId
      ? this.threadState.messages.findIndex(m => m.id === this.wipMessageId)
      : -1;

    if (wipIndex === -1) {
      // First delta for this turn — create WIP message with stable ID
      this.wipMessageId = payload.messageId; // stable ID from agent
      const wipMessage: StoredMessage = {
        id: payload.messageId,
        role: "assistant",
        content: [],
      };
      this.threadState = {
        ...this.threadState,
        messages: [...this.threadState.messages, wipMessage],
      };
      wipIndex = this.threadState.messages.length - 1;
    }

    // Apply deltas to the WIP message's content blocks
    const wip = this.threadState.messages[wipIndex];
    const blocks = [...(wip.content as ContentBlock[])];

    for (const delta of payload.deltas) {
      if (blocks[delta.index]) {
        blocks[delta.index] = {
          ...blocks[delta.index],
          [delta.type === "text" ? "text" : "thinking"]:
            (blocks[delta.index] as any)[delta.type === "text" ? "text" : "thinking"] + delta.append,
          isStreaming: true,
        };
      } else {
        // New block
        blocks[delta.index] = delta.type === "text"
          ? { type: "text", text: delta.append, isStreaming: true }
          : { type: "thinking", thinking: delta.append, isStreaming: true };
      }
    }

    // Immutable update
    const updatedMessages = [...this.threadState.messages];
    updatedMessages[wipIndex] = { ...wip, content: blocks };
    this.threadState = { ...this.threadState, messages: updatedMessages };

    return this.getState();
  }

  private applyHydrate(state: ThreadState): ThreadRenderState {
    this.threadState = { ...state };
    this.lastSeq = null;
    this.wipMessageId = null;
    return this.getState();
  }
}
```

### Key differences from original plan

1. **No chain tracking** — gap detection uses `seq` from socket messages, not `previousEventId`
2. **No patch application** — actions go through the shared reducer
3. **No `full` snapshot handling** — HYDRATE replaces full-sync (reads from disk)
4. **No `pendingBlocks`** — stream deltas write directly into `messages` as a WIP assistant message with `isStreaming: true` on blocks
5. **`payload.messageId`** — stream deltas include the stable message ID so the machine knows which message to update

### Why stream deltas aren't in the shared reducer

The agent **produces** stream deltas (compares raw SDK blocks with last-sent lengths). The client **consumes** them (applies appends to message blocks). These are fundamentally different operations. Making the agent use a reducer for streaming would add complexity without benefit — it doesn't reconstruct blocks from deltas, it has the full blocks from the SDK.

Stream delta application on the client is trivial (content concatenation + `isStreaming` flag). It doesn't warrant shared logic. The shared reducer handles the complex stuff: state transitions, tool lifecycle, usage accumulation, orphaned tool cleanup.

### How streaming flows through messages

1. First STREAM_DELTA → machine creates WIP assistant message (using `payload.messageId`) with `isStreaming: true` blocks
2. Subsequent STREAM_DELTAs → machine appends to existing blocks, keeps `isStreaming: true`
3. APPEND_ASSISTANT_MESSAGE (committed) → reducer replaces content, blocks have no `isStreaming` flag
4. Components check `block.isStreaming` to decide TrickleText vs static render

---

## Part 5: Client Tests (`src/lib/__tests__/thread-state-machine.test.ts`)

1. **Action application** — each ThreadAction type applied through `apply()` produces expected state
2. **Gap detection** — non-sequential seq triggers gap state, HYDRATE recovers
3. **Stream deltas** — creates WIP message with `isStreaming` blocks, appends on subsequent deltas
4. **Committed action clears streaming** — APPEND_ASSISTANT_MESSAGE replaces WIP, `isStreaming` gone
5. **HYDRATE clears WIP** — no stale streaming state after disk recovery
6. **Reducer consistency** — state after applying actions matches direct reducer output
7. **Sequence replay** — same action sequence produces identical state (determinism)

---

## Files

| File | Layer | Purpose |
|------|-------|---------|
| `core/lib/thread-reducer.ts` | core | Shared pure reducer |
| `core/lib/__tests__/thread-reducer.test.ts` | core | Reducer unit tests |
| `core/lib/index.ts` | core | Add export |
| `agents/src/output.ts` | agents | Full rewrite: `dispatch()` + action emission |
| `agents/src/lib/hub/types.ts` | agents | Add `ThreadActionMessage` type |
| `src/lib/thread-state-machine.ts` | client | Client wrapper (reducer + streaming + gaps) |
| `src/lib/__tests__/thread-state-machine.test.ts` | client | Client tests |

## Wire Format Change

The `state_event` message type is replaced by `thread_action`:

```ts
// BEFORE (Phase 0 simplified):
interface StateEventMessage extends SocketMessage {
  type: "state_event";
  patches: Operation[];
  full?: unknown;
}

// AFTER:
interface ThreadActionMessage extends SocketMessage {
  type: "thread_action";
  action: ThreadAction;
}
```

`stream_delta` remains unchanged (simplified by Phase 0, not affected by reducer).

Client-side impact on Phase 2+: `listeners.ts` dispatches `ThreadAction` objects to the store instead of applying patches. The `AGENT_STATE_DELTA` handler becomes trivially simple — just pass the action through.

## Verification

1. `pnpm vitest run core/lib/__tests__/thread-reducer.test.ts` — all reducer tests pass
2. `cd agents && pnpm test` — existing agent tests pass (mutation function signatures preserved)
3. `pnpm vitest run src/lib/__tests__/thread-state-machine.test.ts` — client tests pass
4. Reducer file stays under 250 lines
5. Functions stay under 50 lines each
