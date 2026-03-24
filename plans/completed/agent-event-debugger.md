# Agent Event Debugger

A new debug panel tab that captures and displays all agent events flowing through the unix socket, with payload inspection and on-demand disk state reading.

## Context

Events flow: Agent → HubClient (unix socket) → Rust AgentHub → Tauri `agent:message` event → `initAgentMessageListener()` → eventBus → components.

Two categories of events exist:
1. **Routed events** (`type: "state" | "event" | "optimistic_stream" | "heartbeat" | "log"`) — forwarded to frontend via `agent:message` Tauri events
2. **Drain events** (`type: "drain"`) — tool/permission/lifecycle analytics events sent to Rust SQLite only. **Not forwarded to frontend** (`agent_hub.rs:467` — `continue; // Don't forward to frontend`)

**Source location info is NOT currently tracked.** Events don't carry information about where in the agent runner they were emitted from. The `pipeline` stamps track delivery stages (agent:sent → hub:received → hub:emitted) but not the code location.

## Phases

- [x] Add `source` field to socket message protocol and tag emission sites
- [x] Forward drain events to frontend (opt-in when debug panel is open)
- [x] Create event capture store (Zustand)
- [x] Build the event debugger tab UI
- [x] Add thread disk state reader

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `source` field to socket message protocol

Add an optional `source` string to the message protocol so events carry their origin within the agent runner.

### Changes

**`agents/src/lib/hub/types.ts`** — Add optional `source` to `SocketMessage`:
```ts
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  pipeline?: PipelineStamp[];
  source?: string; // e.g. "shared:PreToolUse", "shared:PostToolUse:plan-detection"
  [key: string]: unknown;
}
```

**`agents/src/lib/hub/client.ts`** — Thread `source` through send helpers:
```ts
sendEvent(name: string, payload: unknown, source?: string): void {
  this.send({ type: "event", name, payload, source });
}

sendDrain(event: string, properties: Record<string, string | number | boolean>, source?: string): void {
  this.send({ type: "drain", event, properties, source });
}
```

**`agents/src/lib/drain-manager.ts`** — Accept optional `source` in `emit()`:
```ts
emit<E extends DrainEventNameType>(
  event: E,
  properties: DrainEventPayloads[E],
  source?: string,
): void {
  // ...
  this.hub.sendDrain(event, flat, source);
}
```

**`agents/src/runners/shared.ts`** — Update `emitEvent()` signature and tag call sites:
```ts
export function emitEvent(name: string, payload: Record<string, unknown>, source?: string): void {
  hub.sendEvent(name, payload, source);
}
```

Tag key emission sites with descriptive source strings:
- `emitEvent(EventName.THREAD_CREATED, ..., "runAgentLoop:subagent-spawn")`
- `emitEvent(EventName.PLAN_DETECTED, ..., "PostToolUse:plan-detection")`
- `emitEvent(EventName.RELATION_CREATED, ..., "PostToolUse:plan-relation")`
- `emitEvent(EventName.THREAD_NAME_GENERATED, ..., "runAgentLoop:name-generation")`
- `drainManager.emit(DrainEventName.TOOL_STARTED, ..., "PreToolUse:allow")`
- `drainManager.emit(DrainEventName.TOOL_COMPLETED, ..., "PostToolUse:complete")`
- `drainManager.emit(DrainEventName.PERMISSION_DECIDED, ..., "PreToolUse:permission")`
- etc.

**`src/lib/agent-service.ts`** — Include `source` in the `AgentSocketMessage` interface:
```ts
interface AgentSocketMessage {
  // ...existing fields...
  source?: string;
}
```

## Phase 2: Forward drain events to frontend

Currently drain events hit `continue` in `agent_hub.rs` and never reach the frontend. We want to forward them when the debug panel's event tab is active.

### Approach: Always forward drain events as Tauri events

Simplest approach — always emit drain messages to the frontend alongside the tracing/SQLite path. The frontend capture store will just ignore them if the debugger isn't active (or cap the buffer).

**`src-tauri/src/agent_hub.rs`** — After the tracing emit, also forward to Tauri:
```rust
if msg_type == "drain" {
    // ... existing tracing logic ...

    // Also forward to frontend for event debugger
    let _ = app_handle.emit("agent:message", &raw_msg);
    continue;
}
```

**`src/lib/agent-service.ts`** — Add `"drain"` to the message type switch:
```ts
case "drain":
  // Forward to event debugger store only (not eventBus)
  // Handled by the capture store's raw message listener
  break;
```

## Phase 3: Create event capture store

A Zustand store that captures ALL raw socket messages for the debugger.

### New file: `src/stores/event-debugger-store.ts`

```ts
interface CapturedEvent {
  id: number;               // auto-increment
  timestamp: number;        // Date.now() when received by frontend
  threadId: string;
  senderId: string;
  type: string;             // "state" | "event" | "drain" | "heartbeat" | "log" | "optimistic_stream"
  name?: string;            // event name (for type="event") or drain event name (for type="drain")
  source?: string;          // agent-side source tag
  payload: unknown;         // full payload (state object, event payload, drain properties)
  pipeline?: PipelineStamp[];
  size: number;             // approximate byte size of the serialized message
}

interface EventDebuggerState {
  events: CapturedEvent[];
  isCapturing: boolean;        // toggle capture on/off
  maxEvents: number;           // circular buffer limit (default 500)
  filters: {
    types: Set<string>;        // filter by message type
    threadId: string | null;   // filter by thread
    search: string;            // text search in event name/payload
  };
  selectedEventId: number | null;

  // Disk state snapshot
  diskState: ThreadState | null;
  diskStateThreadId: string | null;
  diskStateLoading: boolean;
}
```

**Capture hook** — Register a separate Tauri `agent:message` listener (or tap into the existing one in `agent-service.ts`) that pushes every raw message into the store. Use a simple approach: add a capture call at the top of `initAgentMessageListener` before the switch statement, so we capture the raw message before it's routed.

```ts
// In initAgentMessageListener, before the switch:
const { captureEvent } = useEventDebuggerStore.getState();
if (useEventDebuggerStore.getState().isCapturing) {
  captureEvent(msg);
}
```

## Phase 4: Build the event debugger tab UI

### New files

**`src/components/debug-panel/event-debugger.tsx`** — Main component (~200 lines)

Layout: two-panel split
- **Left panel (60%)**: Scrollable event list
- **Right panel (40%)**: Selected event detail / disk state viewer

#### Event List
- Each row: `[timestamp] [type badge] [name/event] [threadId short] [source tag]`
- Color-coded type badges: state=blue, event=green, drain=orange, heartbeat=gray, log=yellow
- Click to select → shows detail in right panel
- Auto-scroll to bottom (with "pause auto-scroll" on manual scroll up)
- Filter bar at top: type toggles, thread ID dropdown, text search

#### Event Detail Panel
- JSON tree view of the full payload (collapsible)
- Pipeline stamps displayed as a mini timeline: `agent:sent(ts) → hub:received(ts) → hub:emitted(ts) → frontend:received(ts)`
- Source tag prominently displayed
- Copy-to-clipboard button for the raw JSON

#### Disk State Reader
- Button: "Read Thread State from Disk"
- Thread ID input (pre-filled from selected event's threadId)
- Reads `~/.anvil/threads/{threadId}/state.json` and `metadata.json`
- Displays in a collapsible JSON tree
- Shows: message count, file changes, tool states, token usage, status

### Debug panel integration

**`src/stores/debug-panel/types.ts`** — Add `"events"` to `DebugPanelTabSchema`:
```ts
export const DebugPanelTabSchema = z.enum(["logs", "diagnostics", "events"]);
```

**`src/components/debug-panel/debug-panel.tsx`** — Add tab entry and render:
```ts
import { Radio } from "lucide-react"; // or similar icon

const TABS = [
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "diagnostics", label: "Frame Rate", icon: Activity },
  { id: "events", label: "Events", icon: Radio },
];

// In tab content:
{activeTab === "events" && <EventDebugger />}
```

## Phase 5: Add thread disk state reader

### New file: `src/lib/thread-disk-reader.ts`

Utility to read thread state and metadata from disk on-demand:

```ts
export async function readThreadFromDisk(threadId: string): Promise<{
  metadata: ThreadMetadata | null;
  state: ThreadState | null;
}> {
  const dataDir = await getDataDir();
  const threadDir = `${dataDir}/threads/${threadId}`;
  // Read both files, parse with Zod schemas
  // Return parsed data or null if not found
}
```

This is called from the event debugger UI when the user clicks "Read Disk State" — the result is stored in the `EventDebuggerState.diskState` field and rendered in the right panel.

## Notes

- The capture store uses a circular buffer (default 500 events) to prevent unbounded memory growth. Heartbeat events could optionally be excluded by default since they're very frequent.
- State messages carry the full `ThreadState` which can be large. The `size` field on `CapturedEvent` helps the user see which events are heavy. Consider storing a truncated preview and the full payload separately.
- Drain events carry flat key-value properties, not nested payloads — they'll display cleanly in the detail view.
- The `source` field is opt-in and backward-compatible. Old agents without source tags will just show "unknown" in the debugger.
