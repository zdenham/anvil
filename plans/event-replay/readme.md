# Agent Events — Per-Thread Replay

Rename the Event debugger tab to "Agent Events", scope it to only agent-emitted socket messages, and add per-thread replay that re-emits captured messages as if the agent sent them.

## Context

The event debugger already captures all `AgentSocketMessage` payloads arriving through `initAgentMessageListener()` in `agent-service.ts` (lines 154-273). These are messages sent by agents via `HubClient.send()` → AgentHub socket → Tauri `agent:message` event. The store has a `filters.threadId` field but no UI to set it.

**Replay strategy:** Captured events store the original raw `AgentSocketMessage` as `payload`. Replay calls a factored-out `routeAgentMessage(msg)` function directly — bypassing the Tauri transport layer — so the existing routing logic processes them identically to live messages. The `isReplaying` flag suppresses re-capture and filters dangerous side-effect events.

### Key Files

| Area | File | Role |
|------|------|------|
| Store | `src/stores/event-debugger-store.ts` | Zustand store — captures events, filters (no cap — opt-in recorder) |
| Event list | `src/components/debug-panel/event-list.tsx` | Toolbar + filter bar + scrollable event rows |
| Event detail | `src/components/debug-panel/event-detail.tsx` | Selected event inspector |
| Layout | `src/components/debug-panel/event-debugger.tsx` | 60/40 split — list / detail |
| Tab config | `src/components/debug-panel/debug-panel.tsx:13` | Tab label: `{ id: "events", label: "Events", icon: Radio }` |
| Listener | `src/lib/agent-service.ts:154-273` | `initAgentMessageListener()` — routes socket messages |
| Seq tracking | `src/lib/agent-service.ts:94` | `lastSeqByThread` Map + `cleanupSeqTracking()` (line 143, **not exported**) |
| Event bus | `src/entities/events.ts` | mitt-based eventBus, `AppEvents` type |
| Hub types | `agents/src/lib/hub/types.ts` | `SocketMessage`, `EventMessage`, `PipelineStamp` |
| Hub client | `agents/src/lib/hub/client.ts` | `HubClient.send()` — stamps `pipeline[0]` with `{ stage: "agent:sent", seq, ts: Date.now() }` |
| Thread store | `src/entities/threads/store.ts` | Zustand entity store + external `machines` Map of `ThreadStateMachine` |
| State machine | `src/lib/thread-state-machine.ts` | Per-thread: committedState, wipMessage, seq/gap tracking |
| Listeners | `src/entities/threads/listeners.ts` | `clearChainState(threadId)` — clears chain tracking + destroys machine |
| Heartbeat | `src/stores/heartbeat-store.ts` | `removeThread(threadId)` — clears heartbeat + gap stats |
| Disk stats | `src/stores/disk-read-stats.ts` | `diskReadStats.clear(threadId)` |
| Recovery | `src/lib/state-recovery.ts` | `stopRecoveryPolling(threadId)` |

### Architecture Decisions

1. **Replay calls routing function directly** — extract the message routing logic from `initAgentMessageListener()` into a standalone `routeAgentMessage(msg)` function. The replayer calls this directly, bypassing Tauri transport. This avoids: browser-mode no-op (`emit()` is no-op outside Tauri), uncertain same-window loopback behavior, and unnecessary transport overhead.
2. **Agent-side timing from `pipeline[0].ts`** — `HubClient.send()` already stamps `pipeline[0]` with `{ stage: "agent:sent", ts: Date.now() }`. No new `emittedAt` field needed. The store derives emission time from `pipeline[0].ts`.
3. **Skip self-capture during replay** — `isReplaying` flag on the store; the capture guard becomes `if (isCapturing && !isReplaying)`.
4. **Tab renamed to "Agent Events"** — only agent socket messages, not UI-local eventBus emissions.
5. **Thread state clear composes existing primitives** — `clearChainState` + `setThreadState(null)` + heartbeat removal + seq tracking cleanup + disk stats + recovery polling.
6. **Replay-aware event type filter** — not all captured event types are safe to replay. `stream_delta` and `thread_action` are replayed; named `event` messages (permissions, thread lifecycle) are **skipped** to avoid phantom side effects; `heartbeat` is skipped to avoid staleness recovery with old timestamps.
7. **Seq numbers handled by machine reset** — calling `setThreadState(threadId, null)` destroys the `ThreadStateMachine`. The first replayed `THREAD_ACTION` after a fresh machine starts a new sequence (machine's `lastSeq` starts null after `applyHydrate`). No seq renumbering needed.

### Three Event Types (post-refactor)

The agent emits three message types through `HubClient.send()`:

| Type | Purpose | Replay safe? |
|------|---------|-------------|
| `thread_action` | Reducer actions (committed state updates, seq numbered) | Yes — primary replay target |
| `stream_delta` | Ephemeral text/thinking deltas for WIP message | Yes — drives streaming UI |
| `event` | Named lifecycle events (permissions, completion, thread lifecycle) | **No** — causes dangerous side effects (phantom dialogs, metadata refreshes) |

Additional types routed by the listener: `heartbeat` (skip — old timestamps trigger staleness), `log`/`drain` (safe but low value), `state`/`state_event`/`optimistic_stream` (deprecated, skip).

## Phases

- [x] Phase 1: Rename tab + thread filter + event type badges + timing display
- [x] Phase 2: Clear thread state + export seq cleanup
- [x] Phase 3: Replay engine + transport controls

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Rename Tab + Thread Filter + Event Type Badges + Timing

### 1a. Rename to "Agent Events"

In `src/components/debug-panel/debug-panel.tsx` line 13, change the tab label from `"Events"` to `"Agent Events"`. The tab ID stays `"events"`.

### 1b. Update event type badges

In `src/components/debug-panel/event-list.tsx`, the `EVENT_TYPES` constant (line 10) only lists `["state", "event", "drain", "heartbeat", "log"]`. Add the new types from the refactored architecture:

- `"thread_action"` — primary state update mechanism
- `"stream_delta"` — primary streaming mechanism
- `"state_event"` — legacy but still routed
- `"optimistic_stream"` — legacy but still routed
- `"network"` — routed to network debugger
- `"register"` — sent on connect

Update `TYPE_BADGE_STYLES` (lines 12-18) with colors for each new type.

### 1c. Derive `emittedAt` from existing pipeline

In `src/stores/event-debugger-store.ts`:
- Add `emittedAt: number | null` to `CapturedEvent`
- In `captureEvent()`, extract from the already-captured `pipeline` array: `pipeline?.find(s => s.stage === "agent:sent")?.ts ?? null`
- **No agent-side changes needed** — `HubClient.send()` already stamps `pipeline[0]` with `{ stage: "agent:sent", ts: Date.now() }` and `captureEvent()` already stores `pipeline` via `extractPipeline(msg)` (line 125)

### 1d. Thread filter dropdown

In `src/components/debug-panel/event-list.tsx`:
- Derive unique `threadId` values from `allEvents`
- Add `<select>` to FilterBar that sets `filters.threadId`
- Show as short-id (first 8 chars) with "All threads" default

### 1e. Show `emittedAt` in event rows

Update `EventRow` (lines 50-77) to show `emittedAt` instead of capture `timestamp` when available. Show relative delta (`+120ms`) from previous event when thread-filtered.

## Phase 2: Clear Thread State

### 2a. Export `cleanupSeqTracking`

In `src/lib/agent-service.ts`, the function `cleanupSeqTracking(threadId)` (line 143) is module-private. Export it so the clear-state utility can call it.

### 2b. `clearThreadStateForReplay(threadId)` utility

Create a utility function (in `src/entities/threads/listeners.ts` alongside existing `clearChainState`, or a new `src/lib/replay-utils.ts`) that composes existing primitives:

```typescript
export function clearThreadStateForReplay(threadId: string): void {
  // 1. Clear chain tracking + destroy ThreadStateMachine
  clearChainState(threadId);

  // 2. Clear Zustand render state (also destroys machine — redundant but safe)
  useThreadStore.getState().setThreadState(threadId, null);

  // 3. Clear heartbeat tracking
  useHeartbeatStore.getState().removeThread(threadId);

  // 4. Clear pipeline sequence tracking
  cleanupSeqTracking(threadId);  // newly exported from agent-service.ts

  // 5. Clear disk read stats
  diskReadStats.clear(threadId);

  // 6. Stop any active recovery polling
  stopRecoveryPolling(threadId);
}
```

**Important:** This clears `threadStates[threadId]` (render state) but NOT `threads[threadId]` (metadata). The thread still exists in the sidebar — we're only wiping its runtime state for clean replay.

### 2c. "Clear State" button

In the event-list toolbar:
- Add "Clear State" button (visible only when `filters.threadId` is set)
- Calls `clearThreadStateForReplay(filters.threadId)`
- Icon: `RotateCcw` from lucide

## Phase 3: Replay Engine + Transport Controls

### 3a. Factor out message routing

In `src/lib/agent-service.ts`, extract the body of the `listen("agent:message", ...)` callback (the `switch` statement at lines 185-269) into a standalone function:

```typescript
export function routeAgentMessage(msg: AgentSocketMessage): void {
  // ... existing switch(msg.type) routing logic ...
}
```

The listener becomes:
```typescript
listen("agent:message", (event) => {
  const msg = event.payload as AgentSocketMessage;
  routeAgentMessage(msg);
});
```

### 3b. Replay state in store

Add to `src/stores/event-debugger-store.ts`:

```typescript
// State
isReplaying: boolean;               // true during replay (suppresses re-capture)
replayState: "idle" | "playing" | "paused";
replayIndex: number;                // position in filtered events
replaySpeed: number;                // 0.5x, 1x, 2x, 4x
replayTimerId: number | null;

// Actions
startReplay(): void;
pauseReplay(): void;
resumeReplay(): void;
stepForward(): void;
setReplaySpeed(speed: number): void;
stopReplay(): void;
```

### 3c. Replay dispatch — direct routing (no Tauri emit)

New file `src/lib/event-replayer.ts`:

```typescript
import { routeAgentMessage } from "./agent-service";

/** Event types that are safe to replay */
const REPLAYABLE_TYPES = new Set(["thread_action", "stream_delta"]);

/** Event types that cause dangerous side effects during replay */
// "event" — phantom permission dialogs, metadata refreshes
// "heartbeat" — old timestamps trigger staleness recovery
// "state"/"state_event"/"optimistic_stream" — deprecated

export function replayEvent(captured: CapturedEvent): boolean {
  const payload = captured.payload as AgentSocketMessage;
  if (!REPLAYABLE_TYPES.has(payload.type)) {
    return false; // skipped
  }
  routeAgentMessage(payload);
  return true;
}
```

No Tauri transport dependency. Works in both Tauri and browser modes. The existing routing applies state deltas, updates WIP content, fires eventBus — same as live.

### 3d. Replay timing logic

In the store's `startReplay()`:
1. Set `isReplaying: true`, `replayState: "playing"`, `replayIndex: 0`
2. Call `clearThreadStateForReplay()` for the filtered thread (clean slate — machine destroyed, so first `THREAD_ACTION` starts fresh seq)
3. Schedule ticks using `emittedAt` deltas between consecutive events (from `pipeline[0].ts`), divided by `replaySpeed`. Fall back to capture `timestamp` if pipeline unavailable.
4. Each tick: call `replayEvent(filteredEvents[replayIndex])`, increment index, schedule next
5. `pauseReplay()` clears timer, keeps index
6. `stepForward()` dispatches single event, increments
7. Auto-stops when index >= filteredEvents.length, sets `isReplaying: false`

### 3e. Transport controls UI

In `src/components/debug-panel/event-list.tsx`, replay toolbar (visible when thread-filtered + events exist):

```
[Play] [Pause] [Step] [1x v] [Stop]     3/47 events
```

- Play/Pause toggle
- Step forward
- Speed dropdown (0.5x, 1x, 2x, 4x)
- Stop (reset to idle)
- Progress: `{replayIndex}/{total}`
- Highlight current replay event row (accent border + background)
- Dim events after `replayIndex` ("future" events)
- Skipped (non-replayable) events shown with a subtle strikethrough or muted badge

### 3f. Suppress re-capture during replay

In `agent-service.ts`, the capture call (lines 180-183):

```typescript
const debugStore = useEventDebuggerStore.getState();
if (debugStore.isCapturing && !debugStore.isReplaying) {
  debugStore.captureEvent(msg as unknown as Record<string, unknown>);
}
```

This is the only change needed in the listener — replay messages flow through the same routing but don't pollute the captured event list.

### Seq number safety

When `clearThreadStateForReplay` runs:
- `clearChainState` destroys the `ThreadStateMachine` via `clearMachineState`
- `setThreadState(threadId, null)` removes `threadStates[threadId]`
- `cleanupSeqTracking` clears `lastSeqByThread`

When the first replayed `thread_action` arrives, a new `ThreadStateMachine` is created with `lastSeq: null`. The machine accepts any seq as the starting point, so replayed events with their original seq numbers work without renumbering.

### Known limitation: `thread_action` bridge

The current `thread_action` handler in `agent-service.ts` (lines 226-234) bridges to `AGENT_STATE_DELTA` with `previousEventId: null` and empty patches. This means `thread_action` replay will trigger a full-state read path in `listeners.ts` — which looks for a `full` field that doesn't exist on the bridged event, hitting the "misbehaving agent" warning and resetting the chain. **`thread_action` replay will not correctly restore committed state until the bridge is replaced with direct `threadStore.dispatch()` wiring.** Replay of `stream_delta` events (WIP content) works correctly now.
