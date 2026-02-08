# Live Streaming Display in Thread View

## Problem Statement

Currently, the mortician app displays thread messages only after complete state snapshots are emitted by the agent and persisted to disk. Users cannot see the agent's thoughts or text as it streams in real-time, which is a common and useful UX pattern in other AI interfaces (Claude.ai, ChatGPT, etc.).

The existing "disk as truth" architecture pattern writes complete `state.json` snapshots, and the UI reads from disk on `AGENT_STATE` events. This works well for persistence but introduces latency and doesn't support character-by-character streaming.

## Investigation Findings

### Current Architecture (Socket-Based IPC)

The codebase has migrated from stdout-based to **socket-based IPC**. All agent-to-frontend communication now flows through Unix sockets via the AgentHub (Rust backend).

1. **Agent Hub (Rust) - `src-tauri/src/agent_hub.rs`**:
   - Unix socket server at `~/.mort/agent-hub.sock`
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
3. **Use socket IPC**: Stream deltas via the same AgentHub socket as state updates
4. **Graceful degradation**: If streaming fails, fall back to snapshot-based updates
5. **Minimal UI changes**: Extend existing components rather than rewrite

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT PROCESS                            │
│                                                                 │
│  SDK Query (includePartialMessages: true)                       │
│       │                                                         │
│       ├──[stream_event]──► hubClient.sendStreamDelta() ──► socket
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
│       ├──[stream_delta]──► Tauri emit("agent:message", {        │
│       │                      type: "stream_delta", delta: {...} │
│       │                    })                                   │
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
│       ├──[stream_delta]──► eventBus.emit(STREAM_DELTA)          │
│       │                                                         │
│       └──[state]──► eventBus.emit(AGENT_STATE)                  │
│                                                                 │
│  setupOutgoingBridge() intercepts mitt events                   │
│       │                                                         │
│       └──► Tauri emit("app:stream:delta", {..., _source})       │
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
│       └──► eventBus.emit(STREAM_DELTA, payload)                 │
│                              │                                  │
│  setupStreamingListeners()   │                                  │
│       │                      ▼                                  │
│       └──► useStreamingStore.handleDelta(payload)               │
│                              │                                  │
│  ThreadView subscribes       │                                  │
│       │                      ▼                                  │
│       └──► StreamingContent re-renders with new text            │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

| Event | Source | Disk? | Cross-Window? | Store Update |
|-------|--------|-------|---------------|--------------|
| `stream_delta` | Agent via socket | No | Yes (via `STREAM_DELTA`) | `useStreamingStore` |
| `state` | Agent via socket | Yes (state.json) | Yes (via `AGENT_STATE`) | `useThreadStore` |
| Agent complete | Process close | Yes (metadata.json) | Yes (via `AGENT_COMPLETED`) | Both stores cleared |

### Streaming → Persisted Transition

```
WHILE STREAMING:
┌─────────────────────────────────────┐
│  useStreamingStore.activeStreams    │
│  └── [threadId]                     │
│       └── blocks: [                 │
│            { type: "thinking",      │  ◄─── Rendered EXPANDED
│              content: "Let me..." } │       (live preview)
│            { type: "text",          │
│              content: "I'll..." }   │
│          ]                          │
└─────────────────────────────────────┘

WHEN AGENT_STATE ARRIVES:
┌─────────────────────────────────────┐
│  1. useStreamingStore.clearStream() │  ◄─── Clears ephemeral state
│                                     │
│  2. useThreadStore updated from     │
│     state.json with complete        │  ◄─── ThinkingBlock now in
│     AssistantMessage                │       persisted message
└─────────────────────────────────────┘

AFTER TRANSITION:
┌─────────────────────────────────────┐
│  UI renders from useThreadStore     │
│  └── ThinkingBlock rendered         │  ◄─── Rendered COLLAPSED
│      (using existing component      │       (default for persisted)
│       with isCollapsed=true)        │
└─────────────────────────────────────┘
```

## Implementation Plan

## Phases

- [ ] Phase 1: Agent-side streaming events
- [ ] Phase 2: Event types and socket message routing
- [ ] Phase 3: Cross-window event broadcasting
- [ ] Phase 4: Frontend streaming store
- [ ] Phase 5: Thread view integration
- [ ] Phase 6: Testing and polish

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

### Phase 1: Agent-Side Streaming Events

**File: `agents/src/output.ts`**

Add new streaming delta emitter (via socket, no disk write):

```typescript
/**
 * Emit a streaming delta via socket.
 * Unlike emitState(), this does NOT write to disk - streaming is ephemeral.
 */
export function emitStreamDelta(delta: StreamDelta): void {
  if (hubClient?.isConnected) {
    hubClient.send({
      type: "stream_delta",
      delta,
    });
  }
}

export interface StreamDelta {
  type: "text_delta" | "thinking_delta" | "content_block_start" | "content_block_stop";
  index: number;
  text?: string;
  blockType?: string;
}
```

**File: `agents/src/lib/hub/client.ts`**

Add convenience method (optional, can use `send()` directly):

```typescript
sendStreamDelta(delta: StreamDelta): void {
  this.send({ type: "stream_delta", delta });
}
```

**File: `agents/src/runners/message-handler.ts`**

Handle `SDKPartialAssistantMessage`:

```typescript
private async handleStreamEvent(msg: SDKPartialAssistantMessage): Promise<boolean> {
  const event = msg.event;

  if (event.type === "content_block_delta") {
    if (event.delta.type === "text_delta") {
      emitStreamDelta({
        type: "text_delta",
        index: event.index,
        text: event.delta.text,
      });
    } else if (event.delta.type === "thinking_delta") {
      emitStreamDelta({
        type: "thinking_delta",
        index: event.index,
        text: event.delta.thinking,
      });
    }
  } else if (event.type === "content_block_start") {
    emitStreamDelta({
      type: "content_block_start",
      index: event.index,
      blockType: event.content_block.type,
    });
  } else if (event.type === "content_block_stop") {
    emitStreamDelta({
      type: "content_block_stop",
      index: event.index,
    });
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

Add streaming delta event:

```typescript
// Add to EventName object
export const EventName = {
  // ... existing events ...
  STREAM_DELTA: "stream:delta",
} as const;

// Add event payload type
export interface StreamDeltaPayload {
  threadId: string;
  delta: {
    type: "text_delta" | "thinking_delta" | "content_block_start" | "content_block_stop";
    index: number;
    text?: string;
    blockType?: string;
  };
}

// Add to EventPayloads interface
export interface EventPayloads {
  // ... existing events ...
  [EventName.STREAM_DELTA]: StreamDeltaPayload;
}
```

**File: `src/lib/agent-service.ts`**

Route stream_delta messages from socket:

```typescript
// In initAgentMessageListener(), add case for stream_delta
agentMessageUnlisten = await listen<AgentSocketMessage>("agent:message", (event) => {
  const msg = event.payload;

  switch (msg.type) {
    case "state":
      // ... existing ...
      break;

    case "event":
      // ... existing ...
      break;

    case "stream_delta":
      // Stream deltas are high-frequency, ephemeral events
      eventBus.emit(EventName.STREAM_DELTA, {
        threadId: msg.threadId,
        delta: msg.delta as StreamDeltaPayload["delta"],
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

**CRITICAL: Add STREAM_DELTA to broadcast events for cross-window delivery:**

```typescript
const BROADCAST_EVENTS = [
  // Agent lifecycle
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  EventName.AGENT_COMPLETED,
  // ... existing events ...

  // Streaming (NEW - required for spotlight → control panel)
  EventName.STREAM_DELTA,
] as const;
```

### Phase 4: Frontend Streaming Store

**File: `src/stores/streaming-store.ts` (new)**

```typescript
import { create } from "zustand";
import { eventBus } from "@/entities/events";
import { EventName, type StreamDeltaPayload } from "@core/types/events.js";

interface StreamingBlock {
  type: "text" | "thinking";
  content: string;
}

interface StreamingState {
  activeStreams: Record<string, {
    blocks: StreamingBlock[];
    isStreaming: boolean;
  }>;
}

interface StreamingActions {
  startStream: (threadId: string) => void;
  handleDelta: (payload: StreamDeltaPayload) => void;
  clearStream: (threadId: string) => void;
}

export const useStreamingStore = create<StreamingState & StreamingActions>((set, get) => ({
  activeStreams: {},

  startStream: (threadId) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [threadId]: { blocks: [], isStreaming: true },
    },
  })),

  handleDelta: ({ threadId, delta }) => set((state) => {
    // Auto-create stream if it doesn't exist (for windows that join mid-stream)
    let stream = state.activeStreams[threadId];
    if (!stream) {
      stream = { blocks: [], isStreaming: true };
    }

    const blocks = [...stream.blocks];

    switch (delta.type) {
      case "content_block_start":
        blocks[delta.index] = {
          type: delta.blockType === "thinking" ? "thinking" : "text",
          content: ""
        };
        break;
      case "text_delta":
      case "thinking_delta":
        if (blocks[delta.index]) {
          blocks[delta.index] = {
            ...blocks[delta.index],
            content: blocks[delta.index].content + (delta.text ?? ""),
          };
        }
        break;
      case "content_block_stop":
        // Block complete - no action needed
        break;
    }

    return {
      activeStreams: {
        ...state.activeStreams,
        [threadId]: { ...stream, blocks },
      },
    };
  }),

  clearStream: (threadId) => set((state) => {
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }),
}));

// ============================================================================
// Event Listeners (called from setupEntityListeners)
// ============================================================================

export function setupStreamingListeners(): void {
  // Handle stream deltas from any window (via event bridge)
  eventBus.on(EventName.STREAM_DELTA, (payload) => {
    useStreamingStore.getState().handleDelta(payload);
  });

  // Clear streaming state when complete state arrives
  eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
    useStreamingStore.getState().clearStream(threadId);
  });

  // Clear streaming state when agent completes/errors/cancels
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

  if (!stream?.isStreaming || stream.blocks.length === 0) {
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

**File: `src/lib/agent-service.ts`**

Initialize streaming state on spawn:

```typescript
import { useStreamingStore } from "@/stores/streaming-store";

export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  // ... existing code ...

  // Initialize streaming state locally
  // Note: Other windows will auto-create stream state when they receive STREAM_DELTA
  useStreamingStore.getState().startStream(options.threadId);

  // ... spawn command ...
}
```

**Cleanup is handled automatically by event listeners** (see Phase 4):
- `AGENT_STATE` → clears stream (complete message arrived)
- `AGENT_COMPLETED` → clears stream
- `AGENT_CANCELLED` → clears stream

## Why Zustand Store (Not a Hook)

A zustand store is the correct choice over a simple hook because:

1. **Cross-window state sync**: Each window has its own React context, but zustand stores can receive events from the event bridge and update independently
2. **Selective subscriptions**: Components can subscribe to specific threadId slices to minimize re-renders
3. **Non-React access**: The event bridge handlers need to update state outside React component lifecycle (`useStreamingStore.getState().handleDelta(...)`)
4. **Existing pattern**: This matches how `useThreadStore`, `usePlanStore`, etc. work in the codebase

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

1. **React Re-renders**: Use zustand selectors to minimize re-renders
2. **Memory**: Clear streaming state on message complete
3. **Throttling**: Consider throttling UI updates if needed (batch deltas every ~50ms)

## Open Questions

1. Should we show streaming content for resumed conversations?
2. Should we throttle/batch delta events to reduce IPC overhead?
   - Could batch every 50ms instead of per-token
   - Trade-off between smoothness and efficiency
3. How to handle the case where Control Panel opens mid-stream?
   - Currently: Would only see deltas from that point forward
   - Option: Could add "catch-up" mechanism to request current streaming state
