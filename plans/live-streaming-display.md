# Live Streaming Display in Thread View

## Problem Statement

Currently, the mortician app displays thread messages only after complete state snapshots are emitted by the agent and persisted to disk. Users cannot see the agent's thoughts or text as it streams in real-time, which is a common and useful UX pattern in other AI interfaces (Claude.ai, ChatGPT, etc.).

The existing "disk as truth" architecture pattern writes complete `state.json` snapshots, and the UI reads from disk on `AGENT_STATE` events. This works well for persistence but introduces latency and doesn't support character-by-character streaming.

## Investigation Findings

### Current Architecture

1. **Agent-side (`agents/src/runners/shared.ts`)**:
   - Uses `@anthropic-ai/claude-agent-sdk` with `includePartialMessages: false`
   - Messages are emitted only when complete via `appendAssistantMessage()`
   - `emitState()` writes to disk first, then emits to stdout

2. **Message Handler (`agents/src/runners/message-handler.ts`)**:
   - Handles `SDKMessage` types: `system`, `assistant`, `user`, `result`, `tool_progress`
   - No handling for `SDKPartialAssistantMessage` (streaming events)

3. **Frontend (`src/lib/agent-service.ts`)**:
   - Parses stdout JSON lines: `log`, `event`, `state`
   - On `state` events, emits `AGENT_STATE` to eventBus
   - Thread service reads from disk and updates zustand store

4. **Thread View (`src/components/thread/`)**:
   - `AssistantMessage` renders `ContentBlock[]` from persisted state
   - `TextBlock` shows `StreamingCursor` when `isStreaming` prop is true
   - Currently `isStreaming` only indicates the thread is active, not actual token streaming

### How Streaming Actually Works

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
│       │        └── input_json_delta '":"foo.ts"}'           │
│       │        └── content_block_stop                       │
│       │                                                      │
│       └── message_stop                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              [SDK executes tool, gets result]
                              │
                              ▼
              [New model turn if continuation needed]
```

#### Tool Use: What Happens Mid-Stream?

Tool **invocations** are announced during streaming (you see `content_block_start` with type `tool_use` and watch the input JSON build character-by-character). But:

- **Tool execution** happens AFTER `message_stop` - the SDK handles this
- **Tool results** come back via a separate user message (not streaming)
- The agentic loop then starts a new model turn, which streams again

So within a single model turn, content blocks are sequential (thinking → text → tool_use). But the overall agentic flow is: stream → execute tools → stream next turn → repeat.

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

### Cross-Window Event Broadcasting (Critical)

**The agent is typically spawned from the Spotlight window but displayed in the Control Panel window.** This means streaming events MUST be broadcast across windows via Tauri IPC.

Current cross-window flow for `AGENT_STATE`:
```
Spotlight Window (spawnSimpleAgent)
    ↓
[Agent process spawns, outputs JSON on stdout]
    ↓
handleSimpleAgentOutput() parses stdout
    ↓
eventBus.emit(AGENT_STATE, { threadId, state }) → local mitt
    ↓
setupOutgoingBridge() intercepts → converts to Tauri event
    ↓
emit("app:agent:state", { threadId, state, _source: "spotlight" })
    ↓
Tauri broadcasts to ALL windows
    ↓
Control Panel receives via setupIncomingBridge()
    ↓
Checks _source !== controlPanelLabel (echo prevention)
    ↓
Emits to local mitt: eventBus.emit(AGENT_STATE, payload)
    ↓
Thread listeners update zustand store → UI re-renders
```

**Key file: `src/lib/event-bridge.ts`**
- `BROADCAST_EVENTS` array controls which events are sent cross-window
- Currently includes `AGENT_STATE`, `AGENT_SPAWNED`, `AGENT_COMPLETED`, etc.
- **We MUST add `STREAM_DELTA` to this array for cross-window streaming**

### Why Zustand Store (Not a Hook)

A zustand store is the correct choice over a simple hook because:

1. **Cross-window state sync**: Each window has its own React context, but zustand stores can receive events from the event bridge and update independently
2. **Selective subscriptions**: Components can subscribe to specific threadId slices to minimize re-renders
3. **Non-React access**: The event bridge handlers need to update state outside React component lifecycle (`useStreamingStore.getState().appendDelta(...)`)
4. **Existing pattern**: This matches how `useThreadStore`, `usePlanStore`, etc. work in the codebase

## Proposed Architecture

### Design Principles

1. **Preserve disk-as-truth**: Complete messages still persist to `state.json`
2. **Streaming state is ephemeral**: Lives only in memory, not persisted
3. **Graceful degradation**: If streaming fails, fall back to snapshot-based updates
4. **Minimal UI changes**: Extend existing components rather than rewrite

### Streaming → Persisted Transition

This is how thinking blocks (and all content) transition from streaming to persisted state:

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

The transition is seamless because:
- Streaming state is cleared when complete state arrives
- Same content, different render state (expanded while live, collapsed when done)
- No duplication because streaming store is emptied first

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT PROCESS                            │
│                                                                 │
│  SDK Query (includePartialMessages: true)                       │
│       │                                                         │
│       ├──[stream_event]──► emitStreamDelta() ──► stdout         │
│       │                    (NO disk write - ephemeral)          │
│       │                                                         │
│       └──[assistant msg]──► appendAssistantMessage() ──► disk   │
│                             emitState() ──► stdout              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ stdout (JSON lines)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SPOTLIGHT WINDOW                              │
│                   (spawns agent)                                │
│                                                                 │
│  handleSimpleAgentOutput() parses stdout                        │
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
| `stream_delta` | Agent stdout | No | Yes (via `STREAM_DELTA`) | `useStreamingStore` |
| `state` | Agent stdout | Yes (state.json) | Yes (via `AGENT_STATE`) | `useThreadStore` |
| Agent complete | Process close | Yes (metadata.json) | Yes (via `AGENT_COMPLETED`) | Both stores cleared |

## Implementation Plan

### Phase 1: Agent-Side Streaming Events

**File: `agents/src/output.ts`**

Add new streaming event emitter (no disk write):

```typescript
export function emitStreamDelta(delta: StreamDelta): void {
  // Emit directly to stdout - no disk write for streaming events
  stdout({ type: "stream_delta", delta });
}

interface StreamDelta {
  type: "text_delta" | "thinking_delta" | "content_block_start" | "content_block_stop";
  index: number;
  text?: string;
  blockType?: string;
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

### Phase 2: Frontend Streaming Store

**File: `src/stores/streaming-store.ts` (new)**

```typescript
import { create } from "zustand";

interface StreamingBlock {
  type: "text" | "thinking";
  content: string;
}

interface StreamingState {
  // Keyed by threadId
  activeStreams: Record<string, {
    blocks: StreamingBlock[];
    isStreaming: boolean;
  }>;
}

interface StreamingActions {
  startStream: (threadId: string) => void;
  appendDelta: (threadId: string, index: number, type: string, text: string) => void;
  startBlock: (threadId: string, index: number, blockType: string) => void;
  endBlock: (threadId: string, index: number) => void;
  clearStream: (threadId: string) => void;
}

export const useStreamingStore = create<StreamingState & StreamingActions>((set) => ({
  activeStreams: {},

  startStream: (threadId) => set((state) => ({
    activeStreams: {
      ...state.activeStreams,
      [threadId]: { blocks: [], isStreaming: true },
    },
  })),

  appendDelta: (threadId, index, type, text) => set((state) => {
    const stream = state.activeStreams[threadId];
    if (!stream) return state;

    const blocks = [...stream.blocks];
    if (!blocks[index]) {
      blocks[index] = { type: type as "text" | "thinking", content: "" };
    }
    blocks[index].content += text;

    return {
      activeStreams: {
        ...state.activeStreams,
        [threadId]: { ...stream, blocks },
      },
    };
  }),

  startBlock: (threadId, index, blockType) => set((state) => {
    const stream = state.activeStreams[threadId];
    if (!stream) return state;

    const blocks = [...stream.blocks];
    blocks[index] = { type: blockType as "text" | "thinking", content: "" };

    return {
      activeStreams: {
        ...state.activeStreams,
        [threadId]: { ...stream, blocks },
      },
    };
  }),

  endBlock: (threadId, index) => set((state) => state),  // No-op for now

  clearStream: (threadId) => set((state) => {
    const { [threadId]: _, ...rest } = state.activeStreams;
    return { activeStreams: rest };
  }),
}));
```

### Phase 3: Event Types & Cross-Window Broadcasting

**File: `core/types/events.ts`**

Add streaming delta event to the event system:

```typescript
// Add to EventName enum
export enum EventName {
  // ... existing events ...
  STREAM_DELTA = "stream:delta",
}

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

// Add to CoreEvents interface
export interface CoreEvents {
  // ... existing events ...
  [EventName.STREAM_DELTA]: StreamDeltaPayload;
}
```

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

**File: `src/lib/agent-output-parser.ts`**

Update schema to handle stream deltas (stdout parsing):

```typescript
// Add to AgentOutput union for stdout parsing
export interface StreamDeltaMessage {
  type: "stream_delta";
  delta: {
    type: "text_delta" | "thinking_delta" | "content_block_start" | "content_block_stop";
    index: number;
    text?: string;
    blockType?: string;
  };
}

const StreamDeltaSchema = z.object({
  type: z.literal("stream_delta"),
  delta: z.object({
    type: z.enum(["text_delta", "thinking_delta", "content_block_start", "content_block_stop"]),
    index: z.number(),
    text: z.string().optional(),
    blockType: z.string().optional(),
  }),
});

export const AgentOutputSchema = z.union([
  AgentLogMessageSchema,
  AgentEventMessageSchema,
  AgentStateMessageSchema,
  StreamDeltaSchema,
]);
```

**File: `src/lib/agent-service.ts`**

Emit stream deltas to eventBus (which triggers cross-window broadcast):

```typescript
function handleSimpleAgentOutput(threadId: string, data: string, buffer: { value: string }): void {
  // ... existing buffer logic ...

  for (const line of lines) {
    const output = parseAgentOutput(line);
    if (output) {
      switch (output.type) {
        // ... existing cases ...

        case "stream_delta":
          // Emit to eventBus - outgoing bridge will broadcast to other windows
          eventBus.emit(EventName.STREAM_DELTA, {
            threadId,
            delta: output.delta,
          });
          break;

        case "state":
          eventBus.emit(EventName.AGENT_STATE, { threadId, state: output.state });
          break;
      }
    }
  }
}
```

### Phase 4: Streaming Store with Event Listener

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
    const stream = state.activeStreams[threadId];
    if (!stream) return state;

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

Initialize streaming state on spawn (in the window that spawns):

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

## Alternative Approaches Considered

### 1. React Hook Instead of Zustand Store
- **Pros**: Simpler, less boilerplate
- **Cons**: Can't update from event bridge (outside React), can't share across components cleanly
- **Decision**: Zustand store required because:
  - Event bridge handlers run outside React lifecycle
  - Need `getState()` for imperative updates from `handleSimpleAgentOutput()`
  - Each window has its own store instance, but events sync them via bridge
  - Selective subscriptions minimize re-renders (`useStreamingStore(s => s.activeStreams[threadId])`)

### 2. WebSocket/SSE Instead of stdout
- **Pros**: Native browser streaming, potential lower latency
- **Cons**: Requires additional infrastructure, Tauri IPC works well
- **Decision**: Not needed - stdout parsing with JSON lines is sufficient

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
   - `agent-output-parser.ts`: Test delta parsing

2. **Integration Tests**:
   - Agent spawns and emits stream deltas correctly
   - Frontend accumulates and displays deltas
   - Complete message clears streaming state

3. **Manual Testing**:
   - Visual verification of token-by-token streaming
   - Test long responses (thinking blocks, code blocks)
   - Test multiple concurrent threads

## Rollout Plan

**Decision: No feature flag - implement outright.**

## Performance Considerations

1. **React Re-renders**: Use zustand selectors to minimize re-renders
2. **Memory**: Clear streaming state on message complete
3. **Throttling**: Consider throttling UI updates if needed (batch deltas)

## Decisions & Open Questions

### Decided

1. **Thinking blocks while streaming**: Show expanded (not collapsed) during streaming. They transition to collapsed state naturally when the complete `AGENT_STATE` arrives and streaming state is cleared.

2. **Feature flag**: None - implement outright.

### Open Questions

1. Should we show streaming content for resumed conversations?
2. Should we throttle/batch delta events to reduce Tauri IPC overhead?
   - Could batch every 50ms instead of per-token
   - Trade-off between smoothness and efficiency
3. How to handle the case where Control Panel opens mid-stream?
   - Currently: Would only see deltas from that point forward
   - Option: Could add "catch-up" mechanism to request current streaming state
