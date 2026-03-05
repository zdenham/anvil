# Event System & Thread Renderer Architecture

Post-refactor architecture diagram for the unified event system and streaming-first thread renderer.

**Context**: This replaces the old dual-store architecture (streaming-store + thread-store + disk reads during streaming) with a single state machine per thread. The old `streaming-store.ts` has been deleted.

---

## End-to-End Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT PROCESS (Node.js)                                                │
│                                                                         │
│  Claude SDK  ──stream events──▶  MessageHandler                        │
│                                    │                                    │
│                    ┌───────────────┼───────────────┐                   │
│                    ▼               ▼               ▼                   │
│             StreamAccumulator    Output          Tool/File              │
│             (50ms throttle)     (dispatch)       state updates         │
│                    │               │               │                   │
│                    │               ▼               │                   │
│                    │         threadReducer()       │                   │
│                    │          (pure fn)            │                   │
│                    │               │               │                   │
│                    │          ┌────┴────┐          │                   │
│                    │          ▼         ▼          │                   │
│                    │       Memory    Disk          │                   │
│                    │      (state)  (state.json)    │                   │
│                    │               │               │                   │
│                    ▼               ▼               ▼                   │
│                 HubClient.send()                                       │
│                 ├── stream_delta   (append-only block deltas)          │
│                 ├── thread_action  (reducer action + seq number)       │
│                 └── event          (named: permission, completion...)  │
│                                                                         │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Socket (IPC)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TAURI HUB (Rust)                                                       │
│  Routes messages by threadId, manages agent lifecycle                   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ listen("agent:message")
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Zustand)                                             │
│                                                                         │
│  AgentService.parseAgentOutput()                                        │
│       │                                                                 │
│       ├── THREAD_ACTION ────▶ threadStore.dispatch(threadId, event)     │
│       │                            │                                    │
│       ├── STREAM_DELTA ─────▶ threadStore.dispatch(threadId, event)     │
│       │                            │                                    │
│       ├── OPTIMISTIC_STREAM ─▶ convert to STREAM_DELTA ──▶ dispatch    │
│       │   (legacy compat)          │                                    │
│       │                            ▼                                    │
│       │                   ThreadStateMachine                            │
│       │                   (per-thread instance)                         │
│       │                                                                 │
│       └── Named events ──▶ eventBus ──▶ listeners.ts                   │
│           (AGENT_COMPLETED,          (metadata refresh,                 │
│            PERMISSION_*,              HYDRATE on completion,            │
│            THREAD_*)                  chain reset)                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Three Event Types

### 1. `thread_action` — Committed State Updates

Carries a reducer action (same type used by agent-side `threadReducer`).

```
Agent: output.dispatch({ type: "APPEND_ASSISTANT_MESSAGE", ... })
  → threadReducer(state, action)     // update memory
  → writeStateToDisk(state)          // disk-as-truth
  → hubClient.send({ type: "thread_action", action, seq })
                                                      ↑
                                          monotonic sequence number
```

Actions: `INIT`, `APPEND_USER_MESSAGE`, `APPEND_ASSISTANT_MESSAGE`, `MARK_TOOL_RUNNING`, `MARK_TOOL_COMPLETE`, `UPDATE_FILE_CHANGE`, `SET_SESSION_ID`, `UPDATE_USAGE`, `COMPLETE`, `ERROR`, `CANCELLED`, `HYDRATE`

### 2. `stream_delta` — Ephemeral Streaming Content

Append-only text/thinking deltas for the WIP (work-in-progress) message.

```
SDK content_block_delta → StreamAccumulator.handleDelta()
                            │
                            ├── Accumulates in blocks[] by index
                            ├── 50ms throttled flush
                            └── Emits: { deltas: [...], full?: [...], messageId }
                                         ↑                ↑
                                  new chars only    periodic full snapshot
                                                    (every ~20 emits)
```

### 3. `event` — Named Lifecycle Events

```
AGENT_COMPLETED, AGENT_ERROR, AGENT_CANCELLED
PERMISSION_REQUEST, PERMISSION_RESPONSE
QUESTION_REQUEST, QUESTION_RESPONSE
THREAD_OPTIMISTIC_CREATED, THREAD_CREATED, THREAD_UPDATED
WORKTREE_ALLOCATED, WORKTREE_RELEASED
```

---

## ThreadStateMachine (Core Abstraction)

Lives outside Zustand. One instance per active thread. Two-layer state model:

```
ThreadStateMachine
│
├── committedState: ThreadState          ← from threadReducer (persisted)
│   ├── messages: StoredMessage[]
│   ├── toolStates: Record<id, ToolExecutionState>
│   ├── fileChanges: FileChange[]
│   ├── metrics, status, usage, etc.
│   └── applied via: THREAD_ACTION events → threadReducer(state, action)
│
├── wipMessage: WipMessage | null        ← from STREAM_DELTA (ephemeral)
│   ├── id: string (messageId from agent)
│   ├── role: "assistant"
│   └── content: RenderContentBlock[]    ← blocks with isStreaming: true
│       applied via: STREAM_DELTA events → append to content blocks
│
└── seq tracking                         ← gap detection
    ├── lastSeq: number
    ├── hasGap: boolean
    └── On gap → needsHydration = true → triggers disk re-read
```

### State Access

```
getState()            → committedState + WIP overlay (for rendering)
getCommittedState()   → committedState only (for JSON patching)
needsHydration        → true if seq gap detected
```

### Transport Events

| Event | Source | Effect |
|-------|--------|--------|
| `THREAD_ACTION` | Agent output.dispatch() | Apply action through threadReducer, advance seq |
| `STREAM_DELTA` | StreamAccumulator | Append to WIP message content blocks |
| `HYDRATE` | Disk read (cold start, completion, gap recovery) | Full state replacement, clear WIP, reset seq |

---

## Thread Store (Zustand)

```ts
interface ThreadStoreState {
  threads: Record<string, ThreadMetadata>      // sidebar data (lightweight)
  threadStates: Record<string, ThreadRenderState>  // render data (lazy-loaded)
  activeThreadId: string | null
  threadErrors: Record<string, string>
}

// External to Zustand (avoids serialization):
const machines = new Map<string, ThreadStateMachine>()
```

### Key Operations

```
setThreadState(id, state)     → machine.apply(HYDRATE) → update threadStates[id]
dispatch(id, event)           → machine.apply(event)   → update threadStates[id]
getCommittedState(id)         → machine.getCommittedState() (no WIP overlay)
clearMachineState(id)         → destroy machine (on panel hide)
```

---

## Listeners (Event Bus → Store)

```
AGENT_STATE_DELTA ──▶ Check chain: previousEventId === lastAppliedEventId?
                      ├── Yes: apply patches to getCommittedState()
                      └── No: reset chain, wait for next periodic full (~1s)

STREAM_DELTA ────────▶ dispatch to machine → WIP overlay update

AGENT_COMPLETED ─────▶ refreshMetadata() + loadFullState(HYDRATE) + markUnread
                       (HYDRATE clears WIP, final reconciliation)

panel-hidden ────────▶ clearChainState() + clearMachineState()
                       (next activation triggers fresh HYDRATE from disk)
```

---

## Rendering Pipeline

```
ThreadView
  │
  ├── groupMessagesIntoTurns(messages)
  │
  ├── ThreadProvider (threadId, workingDirectory context)
  │
  └── MessageList (virtualized)
        │
        ├── turns[0..N-1] ──▶ TurnRenderer
        │                       ├── User turn → user message UI
        │                       └── Assistant turn → AssistantMessage
        │                             ├── text blocks → MarkdownRenderer
        │                             ├── thinking blocks → ThinkingBlock
        │                             └── tool_use blocks → ToolBlockRouter
        │                                                     ├── AskUserQuestion → LiveAskUserQuestion
        │                                                     ├── Registry match → SpecializedBlock
        │                                                     │   (Bash, Edit, Read, Grep, etc.)
        │                                                     └── No match → generic ToolUseBlock
        │
        └── turns[N] (streaming slot, always reserved)
              │
              └── isStreaming?
                    ├── Yes → StreamingContent
                    │           └── filter(block.isStreaming === true)
                    │               └── TrickleBlock (per block)
                    │                   └── StreamingCursor (blinking █)
                    │
                    └── No (but running) → WorkingIndicator
```

### Why the Streaming Slot is Always Reserved

The virtual list count is `turns.length + 1`. This prevents N→N+1→N count flicker when streaming starts/stops. The slot renders nothing when idle, `StreamingContent` during streaming, or `WorkingIndicator` between turns.

---

## Scroll Coordinator

Single class replaces two competing React effects. Pure, testable, no React deps.

```
ScrollCoordinator
│
├── _sticky: boolean          (auto-scroll engaged?)
├── _pendingBehavior: string  (queued scroll: "auto" | "smooth")
├── _rafId: number            (single RAF, coalesces signals)
│
├── Signals (input):
│   ├── onContentGrew()           ← ResizeObserver: "auto" (instant)
│   ├── onItemAdded()             ← count increase: "smooth" (polished)
│   ├── onUserScrolledUp()        ← wheel event: disengage sticky
│   └── onScrollPositionChanged() ← scroll event: re-engage if near bottom
│
└── Output:
    └── Batched into single requestAnimationFrame
        Multiple signals in same frame → last behavior wins
```

Wired into `useVirtualList` hook which owns the ResizeObserver and DOM event listeners.

---

## Tool State Flow

```
Agent marks tool running:
  output.dispatch({ type: "MARK_TOOL_RUNNING", toolUseId, toolName })
    → thread_action → machine → threadStates[id].toolStates[toolUseId] = { status: "running" }

Agent marks tool complete:
  output.dispatch({ type: "MARK_TOOL_COMPLETE", toolUseId, result, isError })
    → thread_action → machine → threadStates[id].toolStates[toolUseId] = { status: "complete", ... }

UI reads:
  useToolState(threadId, toolUseId)
    → useThreadStore(useShallow(s => s.threadStates[threadId]?.toolStates?.[toolUseId]))
       └── useShallow because HYDRATE replaces all references
```

---

## Selector Hooks (Render Optimization)

All use `useCallback` for stable selector identity → minimal re-renders.

| Hook | Selects | Re-renders when |
|------|---------|-----------------|
| `useMessage(threadId, idx)` | Single message | That message changes |
| `useMessageContent(threadId, idx)` | Content blocks array | Content changes |
| `useMessageCount(threadId)` | `messages.length` | Count changes |
| `useToolState(threadId, toolId)` | Tool execution state | Status/result changes |
| `useIsThreadRunning(threadId)` | Boolean | Running state toggles |

---

## What Was Eliminated

| Old | New | Why |
|-----|-----|-----|
| `streaming-store.ts` (Zustand) | ThreadStateMachine WIP overlay | Single source of truth, no handoff race |
| Dual chain tracking (stream + state) | Seq numbers on thread_action | One gap detection mechanism |
| `AGENT_STATE_DELTA` with JSON patches | `thread_action` with reducer actions | Same reducer on both sides, no structuredClone |
| Disk reads during streaming | Events-only while running, disk on cold-start/completion | No I/O during streaming |
| `clearStream()` handoff | WIP cleared by HYDRATE on completion | No flash between ephemeral→persisted |
| Two scroll effects | ScrollCoordinator class | No competing RAF loops |
| `ReconnectQueue` | Binary connected/not + full-on-reconnect | Simpler, no stale queued messages |

---

## Phases

- [x] Document architecture

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->
