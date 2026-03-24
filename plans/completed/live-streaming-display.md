# Live Streaming Display in Thread View

## Problem Statement

Currently, the anvil app displays thread messages only after complete state snapshots are emitted by the agent and persisted to disk. Users cannot see the agent's thoughts or text as it streams in real-time, which is a common and useful UX pattern in other AI interfaces (Claude.ai, ChatGPT, etc.).

The existing "disk as truth" architecture pattern writes complete `state.json` snapshots, and the UI reads from disk on `AGENT_STATE` events. This works well for persistence but introduces latency and doesn't support character-by-character streaming.

## Investigation Findings

### Current Architecture (Socket-Based IPC)

The codebase has migrated from stdout-based to **socket-based IPC**. All agent-to-frontend communication now flows through Unix sockets via the AgentHub (Rust backend).

1. **Agent Hub (Rust) - `src-tauri/src/agent_hub.rs`**:
   - Unix socket server at `~/.anvil/agent-hub.sock`
   - Accepts connections from all agents (root + sub-agents)
   - Routes messages to frontend via `agent:message` Tauri events
   - JSON-line protocol with automatic buffering

2. **Hub Client (Node.js) - `agents/src/lib/hub/client.ts`**:
   - `HubClient` class manages socket connections
   - `sendState(state)` - Sends complete thread state snapshots
   - `sendEvent(name, payload)` - Sends typed events
   - Socket is the **only** communication path (stdout fallback removed)

3. **Frontend Reception - `src/lib/agent-service.ts`**:
   - `initAgentMessageListener()` listens for `agent:message` Tauri events
   - Routes by message type: `state` → `AGENT_STATE`, `event` → `routeAgentEvent()`
   - Emits to local `eventBus` (mitt)

4. **Cross-Window Broadcasting - `src/lib/event-bridge.ts`**:
   - `BROADCAST_EVENTS` array controls which events are sent cross-window
   - Spotlight spawns agent → Control Panel displays it
   - Uses Tauri `emit()` broadcast with `_source` echo prevention

5. **Message Handler (`agents/src/runners/message-handler.ts`)**:
   - Handles `SDKMessage` types: `system`, `assistant`, `user`, `result`, `tool_progress`
   - **No handling for `SDKPartialAssistantMessage` yet** (streaming events)

### How Streaming Works in the Anthropic SDK

**Key insight: Streamed content IS the eventual persisted content, just delivered incrementally.**

The Anthropic API streams the assistant's response as it's generated. What you see in streaming is exactly what ends up in the final message - it's a live preview, not separate data.

#### What Gets Streamed

| Content Type | Delta Event | Persisted? | Notes |
|--------------|-------------|------------|-------|
| Text | `text_delta` | Yes (TextBlock) | The main response text |
| Thinking | `thinking_delta` | Yes (ThinkingBlock) | Extended thinking content |
| Tool input JSON | `input_json_delta` | Yes (ToolUseBlock.input) | Tool parameters being built |

#### Stream Event Lifecycle (Single Model Turn)

```
┌─────────────────────────────────────────────────────────────┐
│                     SINGLE MODEL TURN                        │
│                                                              │
│  message_start                                               │
│       │                                                      │
│       ├── content_block_start (thinking, index=0)           │
│       │        └── thinking_delta "Let me..."               │
│       │        └── thinking_delta "analyze..."              │
│       │        └── content_block_stop                       │
│       │                                                      │
│       ├── content_block_start (text, index=1)               │
│       │        └── text_delta "I'll help..."                │
│       │        └── text_delta " you with..."                │
│       │        └── content_block_stop                       │
│       │                                                      │
│       ├── content_block_start (tool_use, index=2)           │
│       │        └── input_json_delta '{"file'                │
│       │        └── input_json_delta '":\"foo.ts\"}'         │
│       │        └── content_block_stop                       │
│       │                                                      │
│       └── message_stop                                       │
└─────────────────────────────────────────────────────────────┘
```

#### Tool Use: What Happens Mid-Stream?

Tool **invocations** are announced during streaming (you see `content_block_start` with type `tool_use` and watch the input JSON build character-by-character). But:

- **Tool execution** happens AFTER `message_stop` - the SDK handles this
- **Tool results** come back via a separate user message (not streaming)
- The agentic loop then starts a new model turn, which streams again

**For our implementation**: We only stream text/thinking content. Tool use blocks appear in streaming but their execution/results flow through the existing `AGENT_STATE` persistence mechanism.

### SDK Streaming Support

The Claude Agent SDK supports real-time streaming via:

```typescript
// Enable in query options
includePartialMessages: true
```

This emits `SDKPartialAssistantMessage`:
```typescript
type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: RawMessageStreamEvent;  // From Anthropic SDK
  parent_tool_use_id: string | null;
  uuid: UUID;
  session_id: string;
}
```

Where `RawMessageStreamEvent` includes:
- `content_block_start`: New content block begins
- `content_block_delta`: Token chunk with `text_delta` or `thinking_delta`
- `content_block_stop`: Content block complete
- `message_start`, `message_delta`, `message_stop`: Message lifecycle

## Proposed Architecture

### Design Principles

1. **Preserve disk-as-truth**: Complete messages still persist to `state.json`
2. **Streaming state is ephemeral**: Lives only in memory, not persisted
3. **Use socket IPC**: Stream content via the same AgentHub socket as state updates
4. **Graceful degradation**: If streaming fails, fall back to snapshot-based updates
5. **Minimal UI changes**: Extend existing components rather than rewrite

### High-Level Design

**Key design choice: Agent-side accumulation.** The agent accumulates streamed content into full content block snapshots and sends the complete accumulated state on each emit (throttled to ~50ms). This means:
- The socket message is always a **full snapshot** of current streaming blocks, not individual deltas
- The client simply replaces its state wholesale — no accumulation logic needed
- Late-joining windows (e.g., Control Panel opening mid-stream) get the full content immediately
- Resumed conversations work identically — the agent re-streams accumulated content

This is redundant in bandwidth but dramatically simplifies the client and eliminates an entire class of sync bugs.

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT PROCESS                            │
│                                                                 │
│  SDK Query (includePartialMessages: true)                       │
│       │                                                         │
│       ├──[stream_event]──► accumulator.handleDelta()            │
│       │                    ├── updates in-memory blocks         │
│       │                    └── throttled (50ms):                │
│       │                        hubClient.send({                 │
│       │                          type: "optimistic_stream",     │
│       │                          blocks: [full snapshot]        │
│       │                        })                               │
│       │                    (NO disk write - ephemeral)          │
│       │                                                         │
│       └──[assistant msg]──► appendAssistantMessage() ──► disk   │
│                             hubClient.sendState() ──► socket    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Unix Socket (JSON lines)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT HUB (Rust)                         │
│                                                                 │
│  handle_connection() reads JSON lines via BufReader             │
│       │                                                         │
│       ├──[optimistic_stream]──► Tauri emit("agent:message", {   │
│       │                           type: "optimistic_stream",    │
│       │                           blocks: [...]                 │
│       │                         })                              │
│       │                                                         │
│       └──[state]──► Tauri emit("agent:message", {               │
│                       type: "state", state: {...}               │
│                     })                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC (agent:message event)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FRONTEND (Spotlight Window)                   │
│                   (receives agent:message)                      │
│                                                                 │
│  initAgentMessageListener() routes messages                     │
│       │                                                         │
│       ├──[optimistic_stream]──► eventBus.emit(OPTIMISTIC_STREAM)│
│       │                                                         │
│       └──[state]──► eventBus.emit(AGENT_STATE)                  │
│                                                                 │
│  setupOutgoingBridge() intercepts mitt events                   │
│       │                                                         │
│       └──► Tauri emit("app:optimistic:stream", {..., _source})  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC broadcast
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CONTROL PANEL WINDOW                          │
│                   (displays thread)                             │
│                                                                 │
│  setupIncomingBridge() receives Tauri event                     │
│       │                                                         │
│       └──► eventBus.emit(OPTIMISTIC_STREAM, payload)            │
│                              │                                  │
│  setupStreamingListeners()   │                                  │
│       │                      ▼                                  │
│       └──► useStreamingStore.setStream(payload)                 │
│            (simple replacement — no accumulation)               │
│                              │                                  │
│  ThreadView subscribes       │                                  │
│       │                      ▼                                  │
│       └──► StreamingContent re-renders with new text            │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

| Event | Source | Disk? | Cross-Window? | Store Update |
|-------|--------|-------|---------------|--------------|
| `optimistic_stream` | Agent via socket | **No** (ephemeral) | Yes (via `OPTIMISTIC_STREAM`) | `useStreamingStore` |
| `state` | Agent via socket | Yes (state.json) | Yes (via `AGENT_STATE`) | `useThreadStore` |
| Agent complete | Process close | Yes (metadata.json) | Yes (via `AGENT_COMPLETED`) | Both stores cleared |

> The `optimistic` prefix signals that this event carries ephemeral preview data that must NOT be written to disk or persisted to state. It exists purely for UI responsiveness.

### Streaming → Persisted Transition

```
WHILE STREAMING:
┌──────────────────────────────────────┐
│  useStreamingStore.activeStreams     │
│  └── [threadId]                      │
│       └── blocks: [                  │
│            { type: "thinking",       │  ◄─── Rendered EXPANDED
│              content: "Let me..." }  │       (live preview)
│            { type: "text",           │
│              content: "I'll..." }    │
│          ]                           │
│       (full snapshot — no accum.)    │
└──────────────────────────────────────┘

WHEN AGENT_STATE ARRIVES:
┌──────────────────────────────────────┐
│  1. useStreamingStore.clearStream()  │  ◄─── Clears optimistic state
│                                      │
│  2. useThreadStore updated from      │
│     state.json with complete         │  ◄─── ThinkingBlock now in
│     AssistantMessage                 │       persisted message
└──────────────────────────────────────┘

AFTER TRANSITION:
┌──────────────────────────────────────┐
│  UI renders from useThreadStore      │
│  └── ThinkingBlock rendered          │  ◄─── Rendered COLLAPSED
│      (using existing component       │       (default for persisted)
│       with isCollapsed=true)         │
└──────────────────────────────────────┘
```

## Implementation Plan

## Phases

- [x] Phase 1: Agent-side streaming with accumulation + throttling
- [x] Phase 2: Event types and socket message routing (`OPTIMISTIC_STREAM`)
- [x] Phase 3: Cross-window event broadcasting
- [x] Phase 4: Frontend streaming store (snapshot replacement, no accumulation)
- [x] Phase 5: Thread view integration
- [x] Phase 6: Stream lifecycle management

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

### Phase 1: Agent-Side Streaming with Accumulation

The agent accumulates stream deltas into full content block snapshots and emits the complete accumulated state via socket, throttled to ~50ms. The client never accumulates — it just replaces.

**File: `agents/src/lib/stream-accumulator.ts` (new)**

Accumulates SDK stream deltas into content block snapshots and emits throttled snapshots via socket:

```typescript
import { type HubClient } from "./hub/client.js";

interface StreamBlock {
  type: "text" | "thinking";
  content: string;
}

/**
 * Accumulates SDK stream deltas into full content block snapshots.
 * Emits throttled optimistic_stream messages via the hub socket.
 *
 * The "optimistic" prefix signals this data is ephemeral and must
 * NOT be persisted to disk or written to state.
 */
export class StreamAccumulator {
  private blocks: StreamBlock[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private hubClient: HubClient,
    private threadId: string,
    private throttleMs = 50,
  ) {}

  handleDelta(event: RawMessageStreamEvent): void {
    if (event.type === "content_block_start") {
      const blockType = event.content_block.type;
      // Only accumulate text and thinking blocks
      if (blockType === "text" || blockType === "thinking") {
        this.blocks[event.index] = { type: blockType, content: "" };
        this.schedulFlush();
      }
    } else if (event.type === "content_block_delta") {
      const block = this.blocks[event.index];
      if (!block) return;

      if (event.delta.type === "text_delta") {
        block.content += event.delta.text;
      } else if (event.delta.type === "thinking_delta") {
        block.content += event.delta.thinking;
      }
      this.scheduleFlush();
    }
    // content_block_stop: no action needed, block is already complete
  }

  /** Flush immediately (e.g., on message_stop) */
  flush(): void {
    this.cancelPendingFlush();
    this.emitSnapshot();
  }

  /** Reset accumulator for next model turn */
  reset(): void {
    this.cancelPendingFlush();
    this.blocks = [];
    this.dirty = false;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.dirty) {
          this.emitSnapshot();
        }
      }, this.throttleMs);
    }
  }

  private cancelPendingFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private emitSnapshot(): void {
    this.dirty = false;
    if (!this.hubClient.isConnected) return;

    // Filter out empty/undefined slots and send full snapshot
    const blocks = this.blocks.filter(Boolean);
    this.hubClient.send({
      type: "optimistic_stream",
      threadId: this.threadId,
      blocks,
    });
  }
}
```

**File: `agents/src/runners/message-handler.ts`**

Handle `SDKPartialAssistantMessage` — feed raw events into the accumulator:

```typescript
private accumulator: StreamAccumulator;

// In constructor or init:
this.accumulator = new StreamAccumulator(hubClient, threadId);

private async handleStreamEvent(msg: SDKPartialAssistantMessage): Promise<boolean> {
  const event = msg.event;
  this.accumulator.handleDelta(event);

  // On message_stop, flush any remaining buffered content and reset
  if (event.type === "message_stop") {
    this.accumulator.flush();
    this.accumulator.reset();
  }

  return true;
}
```

**File: `agents/src/runners/shared.ts`**

Enable partial messages:

```typescript
includePartialMessages: true,  // Changed from false
```

### Phase 2: Event Types and Socket Message Routing

**File: `core/types/events.ts`**

Add optimistic stream event:

```typescript
// Add to EventName object
export const EventName = {
  // ... existing events ...
  OPTIMISTIC_STREAM: "optimistic:stream",
} as const;

// Add event payload type
export interface OptimisticStreamPayload {
  threadId: string;
  /** Full accumulated content snapshot - NOT a delta. Replaces previous snapshot. */
  blocks: Array<{
    type: "text" | "thinking";
    content: string;
  }>;
}

// Add to EventPayloads interface
export interface EventPayloads {
  // ... existing events ...
  [EventName.OPTIMISTIC_STREAM]: OptimisticStreamPayload;
}
```

**File: `src/lib/agent-service.ts`**

Route optimistic_stream messages from socket:

```typescript
// In initAgentMessageListener(), add case for optimistic_stream
agentMessageUnlisten = await listen<AgentSocketMessage>("agent:message", (event) => {
  const msg = event.payload;

  switch (msg.type) {
    case "state":
      // ... existing ...
      break;

    case "event":
      // ... existing ...
      break;

    case "optimistic_stream":
      // Optimistic stream: full content snapshots, NOT persisted to disk
      eventBus.emit(EventName.OPTIMISTIC_STREAM, {
        threadId: msg.threadId,
        blocks: msg.blocks,
      });
      break;

    case "log":
      // ... existing ...
      break;
  }
});
```

### Phase 3: Cross-Window Event Broadcasting

**File: `src/lib/event-bridge.ts`**

**CRITICAL: Add OPTIMISTIC_STREAM to broadcast events for cross-window delivery:**

```typescript
const BROADCAST_EVENTS = [
  // Agent lifecycle
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  EventName.AGENT_COMPLETED,
  // ... existing events ...

  // Optimistic streaming (NEW - required for spotlight → control panel)
  // "optimistic" prefix = ephemeral, NOT persisted to state
  EventName.OPTIMISTIC_STREAM,
] as const;
```

### Phase 4: Frontend Streaming Store

**File: `src/stores/streaming-store.ts` (new)**

The store is drastically simplified by agent-side accumulation. It receives full content snapshots and simply replaces its state — no delta accumulation logic needed.

```typescript
import { create } from "zustand";
import { eventBus } from "@/entities/events";
import { EventName, type OptimisticStreamPayload } from "@core/types/events.js";

interface StreamingBlock {
  type: "text" | "thinking";
  content: string;
}

interface StreamingState {
  /** Optimistic (ephemeral) streaming content, keyed by threadId. NOT persisted. */
  activeStreams: Record<string, {
    blocks: StreamingBlock[];
  }>;
}

interface StreamingActions {
  /** Replace the full streaming snapshot for a thread (no accumulation). */
  setStream: (payload: OptimisticStreamPayload) => void;
  clearStream: (threadId: string) => void;
}

export const useStreamingStore = create<StreamingState & StreamingActions>((set) => ({
  activeStreams: {},

  setStream: ({ threadId, blocks }) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [threadId]: { blocks },
    },
  })),

  clearStream: (threadId) => set((state) => {
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }),
}));

// ============================================================================
// Event Listeners (called from setupEntityListeners)
// ============================================================================

export function setupStreamingListeners(): void {
  // Receive full content snapshots from agent (via event bridge)
  eventBus.on(EventName.OPTIMISTIC_STREAM, (payload) => {
    useStreamingStore.getState().setStream(payload);
  });

  // Clear optimistic state when persisted state arrives
  eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });

  // Clear optimistic state when agent completes/errors/cancels
  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });

  eventBus.on(EventName.AGENT_CANCELLED, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });
}
```

**File: `src/entities/listeners.ts`**

Register streaming listeners at app startup:

```typescript
import { setupStreamingListeners } from "@/stores/streaming-store";

export function setupEntityListeners(): void {
  // ... existing listener setup ...
  setupStreamingListeners();
}
```

### Phase 5: Thread View Integration

**File: `src/components/thread/streaming-content.tsx` (new)**

```typescript
import { useStreamingStore } from "@/stores/streaming-store";
import { MarkdownRenderer } from "./markdown-renderer";
import { StreamingCursor } from "./streaming-cursor";

interface StreamingContentProps {
  threadId: string;
}

export function StreamingContent({ threadId }: StreamingContentProps) {
  // Selective subscription - only re-renders when this thread's stream changes
  const stream = useStreamingStore((s) => s.activeStreams[threadId]);

  if (!stream || stream.blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {stream.blocks.map((block, index) => (
        <div key={index} className="relative">
          {block.type === "thinking" ? (
            <div className="text-muted-foreground italic">
              {block.content}
            </div>
          ) : (
            <MarkdownRenderer content={block.content} isStreaming={true} />
          )}
          {index === stream.blocks.length - 1 && (
            <StreamingCursor className="ml-1" />
          )}
        </div>
      ))}
    </div>
  );
}
```

**File: `src/components/thread/assistant-message.tsx`**

Integrate streaming content (needs threadId prop added):

```typescript
import { StreamingContent } from "./streaming-content";

interface AssistantMessageProps {
  // ... existing props ...
  threadId: string;  // NEW - needed for streaming store lookup
}

export function AssistantMessage({ threadId, ... }) {
  // ... existing code ...

  return (
    <article>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0 space-y-3">
          {/* Existing persisted content blocks */}
          {content.map((block, index) => {
            // ... existing block rendering ...
          })}

          {/* Streaming content - shown AFTER persisted blocks */}
          <StreamingContent threadId={threadId} />
        </div>
      </div>
    </article>
  );
}
```

### Phase 6: Stream Lifecycle Management

No explicit initialization needed on the frontend. Because the agent sends full content snapshots, the store is populated automatically when the first `OPTIMISTIC_STREAM` event arrives. This also means:
- **Resumed conversations**: Work identically — the agent re-streams accumulated content
- **Late-joining windows**: Get full content on the next snapshot (~50ms)

**Cleanup is handled automatically by event listeners** (see Phase 4):
- `AGENT_STATE` → clears optimistic stream (persisted message arrived)
- `AGENT_COMPLETED` → clears optimistic stream
- `AGENT_CANCELLED` → clears optimistic stream

## Why Zustand Store (Not a Hook)

A zustand store is the correct choice over a simple hook because:

1. **Cross-window state sync**: Each window has its own React context, but zustand stores can receive events from the event bridge and update independently
2. **Selective subscriptions**: Components can subscribe to specific threadId slices to minimize re-renders
3. **Non-React access**: The event bridge handlers need to update state outside React component lifecycle (`useStreamingStore.getState().setStream(...)`)
4. **Existing pattern**: This matches how `useThreadStore`, `usePlanStore`, etc. work in the codebase

Note: With agent-side accumulation, the store's role is even simpler — it's just a snapshot holder. No accumulation, merging, or ordering logic needed.

## Alternative Approaches Considered

### 1. React Hook Instead of Zustand Store
- **Pros**: Simpler, less boilerplate
- **Cons**: Can't update from event bridge (outside React), can't share across components cleanly
- **Decision**: Zustand store required (see reasons above)

### 2. Send Deltas via stdout (Original Approach)
- **Pros**: Simpler initial implementation
- **Cons**: Stdout fallback has been removed from codebase; socket is now the only path
- **Decision**: Must use socket IPC - it's the established communication path

### 3. Persist Streaming State to Disk
- **Pros**: Could survive app restarts mid-stream
- **Cons**: Very high write frequency (per-token), disk I/O overhead
- **Decision**: Not worth the complexity - streaming is ephemeral by nature

### 4. Virtual Scrolling for Large Streams
- **Pros**: Better performance for very long streams
- **Cons**: Already using react-virtuoso, additional complexity
- **Decision**: Defer - monitor performance first

### 5. Single Global Stream (One Active at a Time)
- **Pros**: Simpler state management
- **Cons**: Can't support multiple concurrent threads (future feature)
- **Decision**: Use `Record<threadId, StreamState>` to support future multi-thread views

## Testing Plan

1. **Unit Tests**:
   - `streaming-store.ts`: Test state transitions, concurrent streams
   - Message handler: Test delta parsing

2. **Integration Tests**:
   - Agent spawns and emits stream deltas correctly via socket
   - Frontend accumulates and displays deltas
   - Complete message clears streaming state

3. **Manual Testing**:
   - Visual verification of token-by-token streaming
   - Test long responses (thinking blocks, code blocks)
   - Test multiple concurrent threads
   - Test Control Panel opening mid-stream

## Rollout Plan

**Decision: No feature flag - implement outright.**

## Performance Considerations

1. **React Re-renders**: Use zustand selectors to minimize re-renders (subscribe per-threadId)
2. **Memory**: Clear optimistic streaming state when persisted message arrives
3. **Throttling**: Agent-side `StreamAccumulator` throttles to 50ms — UI receives ~20 updates/sec max
4. **Bandwidth**: Sending full snapshots is redundant but bounded — content only grows during a single model turn, and thinking/text blocks are relatively small. The 50ms throttle keeps message frequency reasonable.

## Resolved Questions

1. **Show streaming for resumed conversations?** → **Yes.** Agent-side accumulation means the agent always holds the full snapshot. Resumed conversations stream identically to new ones.

2. **Throttle/batch delta events?** → **Yes, 50ms.** The `StreamAccumulator` batches at 50ms intervals — good balance between perceived smoothness and IPC/render overhead. The agent accumulates per-token but only emits snapshots at the throttle interval.

3. **Control Panel opens mid-stream?** → **Solved by agent-side accumulation.** Since each socket message is a full content snapshot (not an incremental delta), any window that joins mid-stream will receive the complete accumulated content on the very next emit (~50ms). No "catch-up" mechanism needed.

## Naming Convention: "Optimistic" Prefix

The `OPTIMISTIC_STREAM` / `optimistic_stream` naming was chosen deliberately to signal that this event carries **ephemeral preview data** that must never be written to disk or persisted to state. The "optimistic" prefix is a well-understood pattern (optimistic UI updates) that communicates:
- This data is a best-effort preview, not the source of truth
- It will be replaced by the real persisted data when `AGENT_STATE` arrives
- It should never be serialized, cached, or treated as authoritative
