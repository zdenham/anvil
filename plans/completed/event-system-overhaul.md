# Event System Overhaul

## Executive Summary

After moving logic to the Node agent process, events are not properly bubbling up to the Tauri UI. This plan consolidates the fixes for four specific bugs with a comprehensive overhaul to standardize the event system.

### Guiding Principles

1. **Disk is truth** - Events trigger disk refreshes, not in-memory mutations
2. **Shared types** - Single source of truth for event types in `core/`
3. **Explicit contracts** - Every event has a defined schema validated at compile time
4. **Reducer pattern** - UI stores subscribe to events and refresh from disk
5. **No brittle parsing** - Replace line-by-line JSON detection with typed event protocol

---

## Current Issues

### Bug 1: content.md Not Rendering Live (High)

**Location**: `src/lib/agent-service.ts:321`

When the agent completes a tool that writes to `content.md`, the event is emitted with `taskId: null`:

```typescript
eventBus.emit("agent:tool-completed", {
  threadId,
  taskId: null, // BROKEN: taskId is available but not being used
});
```

`TaskOverview` filters by taskId, so `null !== "actual-id"` never matches and refresh never triggers.

**Fix**: The frontend has access to the task object (with `task.id`) when spawning. Update `SpawnAgentWithOrchestrationOptions` to require `taskId` instead of just `taskSlug`, then use it in the event emission.

### Bug 2: Task Updates Not Rendering (High)

Three-part breakdown:
1. **Events defined but never emitted** - `events.taskUpdated()` exists in `agents/src/lib/events.ts` but is never called
2. **Events not in broadcast list** - `task:updated`, `task:deleted` missing from `BROADCAST_EVENTS`
3. **No UI subscriptions** - No components listen to task change events

### Bug 3: Thread List Not Updating (High)

1. Missing listeners for `thread:status-changed` and `thread:updated` events in `entities/index.ts`
2. Node doesn't emit `thread:status-changed` when agent starts - thread stays `idle`
3. Cross-window sync incomplete - events broadcast but not consumed

**Fix**: Node emits status change events, frontend handlers refresh thread from disk.

### Bug 4: Action Panel No Loading State (Medium)

No optimistic update when user initiates agent:
- Frontend generates thread UUID but doesn't set initial status
- UI waits for first event from Node before showing loading state

**Fix**: Frontend should optimistically set thread status to `running` immediately when spawning. The flow is:
1. Frontend generates thread UUID
2. Frontend optimistically creates thread with status `running` in store
3. Frontend spawns agent process with thread ID
4. Frontend listens to events for subsequent updates

---

## Architectural Problems

### Brittle Parsing Logic

**Location**: `src/lib/agent-service.ts:56-122`

```typescript
// Current: Line-by-line JSON detection
function detectAnvilMutations(result: ToolResult): void {
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (trimmed.startsWith("{")) {  // Fragile!
      const parsed = JSON.parse(trimmed);
      if (parsed.deleted) { /* handle */ }
      if (parsed.slug) { /* handle */ }
    }
  }
}
```

**Problems**:
- No schema validation
- Breaks with multi-line JSON or legitimate `{` in output
- Implicit contract between CLI and UI

### Duplicated Types

| Type | Defined In | Should Be In |
|------|-----------|--------------|
| `ThreadState` | `agents/src/output.ts` AND `src/lib/types/agent-messages.ts` | `core/types/events.ts` |
| `FileChange` | Same duplication | `core/types/events.ts` |
| `ResultMetrics` | Same duplication | `core/types/events.ts` |
| `ToolExecutionState` | Same duplication | `core/types/events.ts` |
| `WorkflowMode` | `src/entities/settings/types.ts` AND `agents/src/agent-types/merge-types.ts` | `core/types/settings.ts` |

### Dead Code

**In `agents/src/lib/events.ts`**:
```typescript
events.taskUpdated(slug)   // defined but never called - ALSO USES SLUG NOT TASKID
events.taskDeleted(slug)   // defined but never called - ALSO USES SLUG NOT TASKID
events.refresh(resource)   // defined but never called
```

**CRITICAL**: Current implementation uses `slug` instead of `taskId`. Per AGENTS.md: "Always key by task-id or slug-id NOT by slugs or folder paths."

**In `src/entities/events.ts` (AppEvents)**:
```typescript
"task:updated"        // defined but never emitted
"task:deleted"        // defined but never emitted
"repository:*"        // defined but never emitted
"settings:updated"    // defined but never emitted
```

### Inconsistent Patterns

- Some events use Tauri `listen()` directly
- Some events use mitt `eventBus.on()`
- Some events relayed through callbacks then re-emitted
- No consistent handler pattern
- Event listeners scattered across components, hooks, and services

### Event Protocol Inconsistency

The agent-to-frontend protocol is inconsistent:

```typescript
// agents/src/lib/events.ts:6 - uses "event" field
console.log(JSON.stringify({ type: "event", event, payload }));

// agents/src/orchestration.ts:71 - uses "type" directly as event name
logger.info(JSON.stringify({ type: 'worktree:allocated', ... }));

// src/lib/agent-service.ts:290 - expects "event" field
eventBus.emit(parsed.event, { ... });
```

**Target Protocol**: Standardize on `{ type: "event", name: "<event-name>", payload: {...} }`

### Scattered Listener Locations (MUST CONSOLIDATE)

**Complete audit of existing event listeners that need migration**:

| Location | Events Handled | Pattern | Action |
|----------|----------------|---------|--------|
| `src/entities/index.ts:71-82` | `task:update-from-agent` (Tauri listen) | Mixed | DELETE - migrate to entity listeners |
| `src/entities/index.ts:85-96` | `task:created` (Tauri listen) | Mixed | DELETE - migrate to entity listeners |
| `src/entities/index.ts:100-114` | `app:thread:created` (Tauri listen) | Mixed | DELETE - migrate to entity listeners |
| `src/hooks/use-streaming-thread.ts:58-60` | `agent:state`, `agent:completed`, `agent:error` | mitt in hook | KEEP - UI streaming state |
| `src/components/workspace/task-overview.tsx:51` | `agent:tool-completed` | mitt in component | KEEP - triggers content refresh |
| `src/components/workspace/action-panel.tsx:88` | `action-requested` | mitt in component | DELETE - entity listener handles |
| `src/lib/event-bridge.ts:32` | All BROADCAST_EVENTS | Outgoing bridge | UPDATE - use EventName enum |
| `src/lib/event-bridge.ts:72` | All BROADCAST_EVENTS | Incoming bridge | UPDATE - use EventName enum |
| `src/entities/threads/service.ts:191` | Emits `thread:created` | Service emit | REVIEW - may cause double-emit |
| `src/entities/threads/service.ts:246` | Emits `thread:status-changed` | Service emit | REVIEW - may cause double-emit |
| `src/entities/tasks/service.ts:103` | Emits `action-requested` | Service emit | KEEP - cross-concern notification |
| `src/entities/tasks/service.ts:372` | Emits `task:status-changed` | Service emit | KEEP - local UI update |

**Target Pattern**: Each entity gets a dedicated `listeners.ts` file:
```
src/entities/
  tasks/
    store.ts        # Zustand store (state only)
    service.ts      # Disk operations
    listeners.ts    # Event subscriptions → service.refresh() → store update
    hooks.ts        # Selectors for components
  threads/
    store.ts
    service.ts
    listeners.ts
    hooks.ts
  repositories/
    ...
```

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Node Agent Process                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ core/types/events.ts (Shared Event Types)           │   │
│  │                                                     │   │
│  │  AgentEvent = { type: "event", name, payload }     │   │
│  │  StateEvent = { type: "state", ... }               │   │
│  │                                                     │   │
│  │  EventName = "task:updated" | "task:deleted" | ... │   │
│  │  EventPayloads = { [K in EventName]: Payload }     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ emitEvent<E extends EventName>(name: E, payload)    │   │
│  │                                                     │   │
│  │ → console.log(JSON.stringify({                      │   │
│  │     type: "event",                                  │   │
│  │     name: "task:updated",                           │   │
│  │     payload: { taskId: "uuid-here" }                │   │
│  │   }))                                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└────────────────────────────┬────────────────────────────────┘
                             │ stdout (JSON lines)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Frontend                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ parseAgentOutput(line: string): AgentOutput         │   │
│  │                                                     │   │
│  │ → Validates against EventName enum                  │   │
│  │ → Returns typed event or null                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ handleAgentEvent(event: AgentEventMessage)          │   │
│  │                                                     │   │
│  │ // EMIT ONLY - no refresh here (listeners handle)  │   │
│  │ switch(event.name) {                                │   │
│  │   case "task:updated":                              │   │
│  │     eventBus.emit("task:updated", ...)             │   │
│  │ }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Event Bridge (mitt → Tauri broadcast)               │   │
│  │                                                     │   │
│  │ → Broadcasts to all windows                         │   │
│  │ → Other windows re-emit to local eventBus           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Entity Listeners (per-entity files)                 │   │
│  │                                                     │   │
│  │ // REFRESH HERE - single place for disk reads      │   │
│  │ // src/entities/tasks/listeners.ts                  │   │
│  │ eventBus.on("task:updated", ({ taskId }) => {       │   │
│  │   await taskService.refreshById(taskId);            │   │
│  │ });                                                 │   │
│  │                                                     │   │
│  │ // src/entities/threads/listeners.ts                │   │
│  │ eventBus.on("thread:status-changed", ...)           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Zustand Stores (state containers)                   │   │
│  │                                                     │   │
│  │ // Updated by services after disk refresh           │   │
│  │ useTaskStore, useThreadStore, useRepositoryStore    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Shared Types

### File: `core/types/events.ts`

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { TaskStatus } from "./tasks.js";
import type { ThreadStatus } from "./threads.js";
import type { WorktreeState } from "./repositories.js";

// ============================================================================
// Event Names
// ============================================================================

/**
 * All event names in the system.
 * Used by both Node agent (emission) and Tauri (consumption).
 */
export const EventName = {
  // Task lifecycle
  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_DELETED: "task:deleted",
  TASK_STATUS_CHANGED: "task:status-changed",

  // Thread lifecycle
  THREAD_CREATED: "thread:created",
  THREAD_UPDATED: "thread:updated",
  THREAD_STATUS_CHANGED: "thread:status-changed",

  // Agent process
  AGENT_SPAWNED: "agent:spawned",
  AGENT_STATE: "agent:state",
  AGENT_COMPLETED: "agent:completed",
  AGENT_ERROR: "agent:error",
  AGENT_TOOL_COMPLETED: "agent:tool-completed",

  // Orchestration
  WORKTREE_ALLOCATED: "worktree:allocated",
  WORKTREE_RELEASED: "worktree:released",

  // Repository
  REPOSITORY_CREATED: "repository:created",
  REPOSITORY_UPDATED: "repository:updated",
  REPOSITORY_DELETED: "repository:deleted",

  // User interaction
  ACTION_REQUESTED: "action-requested",

  // Settings
  SETTINGS_UPDATED: "settings:updated",
} as const;

export type EventNameType = (typeof EventName)[keyof typeof EventName];

// ============================================================================
// Event Payloads
// ============================================================================

/**
 * Payload types for each event.
 * Ensures type safety on both emit and consume sides.
 */
export interface EventPayloads {
  // Task events - use taskId (UUID) as primary identifier
  [EventName.TASK_CREATED]: { taskId: string };
  [EventName.TASK_UPDATED]: { taskId: string };
  [EventName.TASK_DELETED]: { taskId: string };
  [EventName.TASK_STATUS_CHANGED]: { taskId: string; status: TaskStatus };

  // Thread events
  [EventName.THREAD_CREATED]: { threadId: string; taskId: string };
  [EventName.THREAD_UPDATED]: { threadId: string; taskId: string };
  [EventName.THREAD_STATUS_CHANGED]: { threadId: string; status: ThreadStatus };

  // Agent events
  [EventName.AGENT_SPAWNED]: { threadId: string; taskId: string };
  [EventName.AGENT_STATE]: { threadId: string; state: ThreadState };
  [EventName.AGENT_COMPLETED]: { threadId: string; exitCode: number; costUsd?: number };
  [EventName.AGENT_ERROR]: { threadId: string; error: string };
  [EventName.AGENT_TOOL_COMPLETED]: { threadId: string; taskId: string };

  // Orchestration events
  [EventName.WORKTREE_ALLOCATED]: { worktree: WorktreeState; mergeBase: string };
  [EventName.WORKTREE_RELEASED]: { threadId: string };

  // Repository events
  [EventName.REPOSITORY_CREATED]: { name: string };
  [EventName.REPOSITORY_UPDATED]: { name: string };
  [EventName.REPOSITORY_DELETED]: { name: string };

  // User interaction
  [EventName.ACTION_REQUESTED]: {
    taskId: string;
    markdown: string;
    defaultResponse: string;
  };

  // Settings
  [EventName.SETTINGS_UPDATED]: { key: string; value: unknown };
}

// ============================================================================
// Agent Output Types (moved from duplicated locations)
// ============================================================================

/**
 * File change tracked during agent execution.
 */
export interface FileChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  oldPath?: string;
  diff?: string;
}

/**
 * Execution metrics for completed agent run.
 */
export interface ResultMetrics {
  durationApiMs: number;
  totalCostUsd: number;
  numTurns: number;
}

/**
 * Tool execution state tracked during run.
 */
export interface ToolExecutionState {
  status: "running" | "complete" | "error";
  result?: string;
  isError?: boolean;
}

/**
 * Complete thread state snapshot emitted during execution.
 *
 * NOTE: The `status` field uses the same values as ThreadStatus from threads.ts.
 * We inline the union here to avoid circular imports in the agent process,
 * but they MUST stay in sync. ThreadStatus is defined as:
 *   type ThreadStatus = "idle" | "running" | "complete" | "error";
 *
 * ThreadState only uses "running" | "complete" | "error" because agents
 * never emit state for idle threads (idle = no agent running).
 */
export interface ThreadState {
  messages: MessageParam[];
  fileChanges: FileChange[];
  workingDirectory: string;
  metrics?: ResultMetrics;
  status: "running" | "complete" | "error";  // Subset of ThreadStatus (excludes "idle")
  error?: string;
  timestamp: number;
  toolStates: Record<string, ToolExecutionState>;
}

// ============================================================================
// Agent Output Protocol
// ============================================================================

/**
 * Event message emitted to stdout by agent.
 */
export interface AgentEventMessage<E extends EventNameType = EventNameType> {
  type: "event";
  name: E;
  payload: EventPayloads[E];
}

/**
 * State message emitted to stdout by agent.
 */
export interface AgentStateMessage {
  type: "state";
  state: ThreadState;
}

/**
 * Log message emitted to stdout by agent.
 */
export interface AgentLogMessage {
  type: "log";
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
}

/**
 * All possible stdout messages from agent.
 */
export type AgentOutput = AgentEventMessage | AgentStateMessage | AgentLogMessage;
```

### File: `core/types/settings.ts`

```typescript
/**
 * Workflow execution mode.
 * Shared between frontend settings and agent merge logic.
 */
export type WorkflowMode = "auto" | "review" | "manual";
```

---

## Implementation Plan

### Phase 1: Shared Types Foundation

**Goal**: Establish single source of truth for all event types.

**Prerequisite - Path Alias Configuration**: This plan uses `@core/types/events.js` imports throughout. Verify these aliases are configured in both packages:

1. **`agents/tsconfig.json`** - Should have:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@core/*": ["../core/*"]
       }
     }
   }
   ```

2. **`src/tsconfig.json`** (frontend) - Should have:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@core/*": ["../core/*"],
         "@/*": ["./src/*"]
       }
     }
   }
   ```

3. **Vite config** (`vite.config.ts`) - May need resolve alias for runtime:
   ```typescript
   resolve: {
     alias: {
       "@core": path.resolve(__dirname, "../core"),
     }
   }
   ```

If these aren't already configured, add this as the first task in Phase 1.

**Files to create/modify**:

| Action | File |
|--------|------|
| Create | `core/types/events.ts` |
| Create | `core/types/settings.ts` |
| Update | `core/types/index.ts` |
| Delete types from | `agents/src/output.ts` |
| Delete types from | `src/lib/types/agent-messages.ts` |
| Delete WorkflowMode from | `agents/src/agent-types/merge-types.ts` |

**Changes**:

1. Create `core/types/events.ts` with all types shown above
2. Create `core/types/settings.ts` with `WorkflowMode`
3. Update `core/types/index.ts`:
   ```typescript
   export * from "./events.js";
   export * from "./settings.js";
   export * from "./tasks.js";
   // ... existing exports
   ```
4. Update imports throughout codebase to use `@core/types/events.js`

---

### Phase 2: Agent Event Emitter

**Goal**: Strongly-typed event emission from Node process.

**File**: `agents/src/lib/events.ts`

```typescript
import {
  EventName,
  EventPayloads,
  AgentEventMessage,
  EventNameType,
} from "@core/types/events.js";
import type { TaskStatus } from "@core/types/tasks.js";
import type { ThreadStatus } from "@core/types/threads.js";
import type { WorktreeState } from "@core/types/repositories.js";

/**
 * Emit a strongly-typed event to stdout.
 * Tauri frontend parses these and dispatches to event bus.
 */
export function emitEvent<E extends EventNameType>(
  name: E,
  payload: EventPayloads[E]
): void {
  const message: AgentEventMessage<E> = {
    type: "event",
    name,
    payload,
  };
  console.log(JSON.stringify(message));
}

/**
 * Convenience helpers for common events.
 */
export const events = {
  emit: emitEvent,

  // Task events
  taskCreated: (taskId: string) =>
    emitEvent(EventName.TASK_CREATED, { taskId }),

  taskUpdated: (taskId: string) =>
    emitEvent(EventName.TASK_UPDATED, { taskId }),

  taskDeleted: (taskId: string) =>
    emitEvent(EventName.TASK_DELETED, { taskId }),

  taskStatusChanged: (taskId: string, status: TaskStatus) =>
    emitEvent(EventName.TASK_STATUS_CHANGED, { taskId, status }),

  // Thread events
  threadCreated: (threadId: string, taskId: string) =>
    emitEvent(EventName.THREAD_CREATED, { threadId, taskId }),

  threadUpdated: (threadId: string, taskId: string) =>
    emitEvent(EventName.THREAD_UPDATED, { threadId, taskId }),

  threadStatusChanged: (threadId: string, status: ThreadStatus) =>
    emitEvent(EventName.THREAD_STATUS_CHANGED, { threadId, status }),

  // Orchestration events
  worktreeAllocated: (worktree: WorktreeState, mergeBase: string) =>
    emitEvent(EventName.WORKTREE_ALLOCATED, { worktree, mergeBase }),

  worktreeReleased: (threadId: string) =>
    emitEvent(EventName.WORKTREE_RELEASED, { threadId }),

  // Action request
  actionRequested: (taskId: string, markdown: string, defaultResponse: string) =>
    emitEvent(EventName.ACTION_REQUESTED, { taskId, markdown, defaultResponse }),
};
```

---

### Phase 3: CLI Event Emissions

**Goal**: Emit events after all CLI mutations.

**File**: `agents/src/cli/anvil.ts`

```typescript
import { events } from "../lib/events.js";

// After task create (around line 278):
const task = await tasks.create(createInput);
events.taskCreated(task.id);

// After task rename (around line 313):
const renamed = await tasks.rename(id, newTitle);
events.taskUpdated(renamed.id);

// After task update (around line 358):
const updated = await tasks.update(id, updates);
if (updates.status) {
  events.taskStatusChanged(updated.id, updates.status);
} else {
  events.taskUpdated(updated.id);
}

// After task delete:
await tasks.delete(id);
events.taskDeleted(id);

// After request-human (around line 494):
await tasks.requestReview(id, review);
events.actionRequested(id, review.markdown, review.defaultResponse);
```

---

### Phase 4: Orchestration Events

**Goal**: Convert logger.info JSON to proper events.

**Dependency Note**: This phase assumes Phase 6/7 are complete. The comment below about "Frontend optimistically sets running status" refers to the `threadService.createOptimistic()` call in Phase 6 and the `useActionState` check in Phase 7. Without those, the UI won't show immediate loading state.

**File**: `agents/src/orchestration.ts`

```typescript
import { events } from "./lib/events.js";

// Line ~123: After worktree allocation (replace logger.info)
events.worktreeAllocated(allocation.worktree, mergeBase);

// Line ~137: After thread creation (replace logger.info)
events.threadCreated(thread.id, taskMeta.id);

// Note: No need to emit thread:status-changed for "running" here.
// Frontend optimistically sets running status before spawning (Phase 6/7).
// This event is for cross-window sync - other windows will refresh from disk.

// Line ~183: After worktree release (replace logger.info)
events.worktreeReleased(threadId);
```

---

### Phase 5: Typed Event Parser

**Goal**: Validate and parse agent stdout with type safety.

**File**: `src/lib/agent-output-parser.ts` (NEW)

```typescript
import {
  AgentOutput,
  AgentEventMessage,
  AgentStateMessage,
  AgentLogMessage,
  EventName,
  EventNameType,
  ThreadState,
} from "@core/types/events.js";
import { logger } from "./logger-client.js";

const VALID_EVENT_NAMES = new Set(Object.values(EventName));

/**
 * Parse a JSON line from agent stdout into a typed output.
 * Returns null for non-JSON lines or unrecognized formats.
 */
export function parseAgentOutput(line: string): AgentOutput | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    // Log for debugging - helps identify malformed JSON from agent
    logger.debug(`[parseAgentOutput] JSON parse failed: ${trimmed.slice(0, 100)}`);
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case "event":
      return parseEventMessage(obj);
    case "state":
      return parseStateMessage(obj);
    case "log":
      return parseLogMessage(obj);
    default:
      return null;
  }
}

function parseEventMessage(obj: Record<string, unknown>): AgentEventMessage | null {
  const name = obj.name;
  if (typeof name !== "string" || !VALID_EVENT_NAMES.has(name as EventNameType)) {
    logger.warn(`[parseAgentOutput] Unknown event name: ${name}`);
    return null;
  }

  return {
    type: "event",
    name: name as EventNameType,
    payload: obj.payload as EventPayloads[EventNameType],
  };
}

function parseStateMessage(obj: Record<string, unknown>): AgentStateMessage | null {
  if (!obj.messages || !obj.workingDirectory || !obj.status) {
    return null;
  }
  return {
    type: "state",
    state: obj as unknown as ThreadState,
  };
}

function parseLogMessage(obj: Record<string, unknown>): AgentLogMessage | null {
  if (typeof obj.level !== "string" || typeof obj.message !== "string") {
    return null;
  }
  return {
    type: "log",
    level: obj.level as AgentLogMessage["level"],
    message: obj.message,
  };
}
```

---

### Phase 6: Agent Service Refactor

**Goal**: Replace brittle parsing with typed event handling. Fix Bug 1 and Bug 4.

**File**: `src/lib/agent-service.ts`

**Update `SpawnAgentWithOrchestrationOptions`**:
```typescript
interface SpawnAgentWithOrchestrationOptions {
  agentType: string;
  taskSlug: string;
  taskId: string;        // ADD: Required for event emissions
  threadId: string;
  prompt: string;
  appendedPromptOverride?: string;
}
```

**Remove**:
- `detectAnvilMutations()` function (lines 56-66)
- `tryRefreshFromToolResult()` function (lines 73-122)

**Add**:

```typescript
import { parseAgentOutput } from "./agent-output-parser.js";
import { EventName, AgentEventMessage, EventNameType } from "@core/types/events.js";

// taskId is now passed directly via options (fixes Bug 1)
const taskId = options.taskId;

// In spawnAgentWithOrchestration stdout handler, replace parsing logic:
for (const line of data.split("\n")) {
  const output = parseAgentOutput(line);
  if (!output) continue;

  switch (output.type) {
    case "state":
      threadState = output.state;
      eventBus.emit(EventName.AGENT_STATE, { threadId, state: output.state });

      // Check for tool completion
      const currentCount = countToolResults(output.state.messages);
      if (currentCount > lastToolResultCount) {
        lastToolResultCount = currentCount;
        eventBus.emit(EventName.AGENT_TOOL_COMPLETED, {
          threadId,
          taskId, // Now correctly using options.taskId
        });
      }
      break;

    case "event":
      await handleAgentEvent(output, threadId);
      break;

    case "log":
      // Forward to logger or structured log file
      break;
  }
}

// Optimistically create thread with running status before spawning (fixes Bug 4)
await threadService.createOptimistic({
  id: options.threadId,
  taskId: options.taskId,
  status: "running",
});

// Spawn the command - Node will emit events for subsequent state changes
await command.spawn();

/**
 * Handle typed events from agent process.
 *
 * IMPORTANT: This function only emits to eventBus - it does NOT refresh from disk.
 * Entity listeners (Phase 9) handle all disk refreshes. This separation ensures:
 * 1. No double-refresh in the originating window
 * 2. Cross-window broadcasts trigger refresh in other windows via their listeners
 * 3. Single source of truth for refresh logic (entity listeners)
 */
function handleAgentEvent(
  event: AgentEventMessage,
  threadId: string
): void {
  const { name, payload } = event;

  // Validate known event types and emit to bus
  // Entity listeners handle refresh from disk
  switch (name) {
    case EventName.TASK_CREATED:
    case EventName.TASK_UPDATED:
    case EventName.TASK_DELETED:
    case EventName.TASK_STATUS_CHANGED:
    case EventName.THREAD_CREATED:
    case EventName.THREAD_UPDATED:
    case EventName.THREAD_STATUS_CHANGED:
    case EventName.WORKTREE_ALLOCATED:
    case EventName.WORKTREE_RELEASED:
    case EventName.ACTION_REQUESTED:
      eventBus.emit(name, payload);
      break;

    default:
      logger.warn(`[handleAgentEvent] Unhandled event: ${name}`);
  }
}
```

---

### Phase 7: Fix Loading State Hook

**Goal**: Ensure `useActionState` reflects thread status from store (set optimistically).

**Prerequisite**: `threadService.createOptimistic()` must be implemented first (used in Phase 6).

**File**: `src/entities/threads/service.ts`

```typescript
/**
 * Create an optimistic thread entry in the store before agent spawn.
 * This allows immediate UI feedback (loading state) without waiting for Node.
 *
 * IMPORTANT: This does NOT write to disk. The thread exists only in memory.
 * Disk write happens when Node orchestration creates the thread and emits
 * thread:created event, which triggers refreshById to sync from disk.
 *
 * This is the correct pattern for optimistic UI:
 * 1. Store update → immediate UI feedback
 * 2. Async operation → Node creates thread on disk
 * 3. Event → listener refreshes from disk → store converges to truth
 */
createOptimistic(params: {
  id: string;
  taskId: string;
  status: ThreadStatus;
}): void {
  const { id, taskId, status } = params;

  // Create minimal thread object for store - NO DISK WRITE
  const optimisticThread: ThreadMetadata = {
    id,
    taskId,
    status,
    agentType: "",  // Will be set on disk refresh
    workingDirectory: "",  // Will be set on disk refresh
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };

  // Update store immediately (NO disk write - this is optimistic UI)
  useThreadStore.getState()._applyOptimistic(optimisticThread);
}
```

**File**: `src/entities/threads/store.ts`

```typescript
// Add to store actions:
_applyOptimistic: (thread: Thread) => {
  set((state) => ({
    threads: { ...state.threads, [thread.id]: thread },
  }));
},
```

**File**: `src/hooks/use-action-state.ts`

```typescript
// Add after streamingState check (around line 27):
// Thread status is set optimistically by frontend before spawning
if (thread?.status === "running") {
  return { type: "streaming" };
}
```

The flow is:
1. User submits prompt
2. Frontend generates thread UUID
3. Frontend calls `threadService.createOptimistic({ id, taskId, status: "running" })`
4. Store updates immediately → `useActionState` returns streaming state → UI shows loading
5. Frontend spawns agent process
6. Node emits events → handlers refresh from disk → store stays in sync

---

### Phase 8: Event Bridge Broadcast List

**Goal**: Broadcast all events cross-window.

**File**: `src/lib/event-bridge.ts`

```typescript
import { EventName } from "@core/types/events.js";

const BROADCAST_EVENTS = [
  // Agent lifecycle
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  EventName.AGENT_COMPLETED,
  EventName.AGENT_ERROR,
  EventName.AGENT_TOOL_COMPLETED,

  // Thread lifecycle
  EventName.THREAD_CREATED,
  EventName.THREAD_UPDATED,
  EventName.THREAD_STATUS_CHANGED,

  // Task lifecycle
  EventName.TASK_CREATED,
  EventName.TASK_UPDATED,
  EventName.TASK_DELETED,
  EventName.TASK_STATUS_CHANGED,

  // Orchestration
  EventName.WORKTREE_ALLOCATED,
  EventName.WORKTREE_RELEASED,

  // User interaction
  EventName.ACTION_REQUESTED,

  // Repository (if needed)
  EventName.REPOSITORY_CREATED,
  EventName.REPOSITORY_UPDATED,
  EventName.REPOSITORY_DELETED,

  // Settings
  EventName.SETTINGS_UPDATED,
] as const;
```

---

### Phase 9: Entity Event Listeners

**Goal**: Dedicated listener files per entity that refresh from disk (fixes Bugs 2 & 3).

**IMPORTANT - Cleanup Required**: Before adding new listeners, audit and remove existing scattered event handlers to prevent duplicate processing. Known locations to check:

| File | Current Behavior | Action |
|------|------------------|--------|
| `src/components/workspace/task-workspace.tsx` | Direct Tauri `listen()` calls | Remove, use entity listeners |
| `src/components/spotlight/spotlight.tsx` | Mixed eventBus/Tauri handlers | Remove, use entity listeners |
| `src/hooks/use-thread-state.ts` | Direct event subscriptions | Remove if duplicating entity listener logic |
| `src/entities/index.ts` | Inline event handlers | Replace with `setupEntityListeners()` call |
| Various components | `eventBus.on()` for entity events | Remove, centralize in listeners.ts |

**Audit process**:
1. Search codebase for `eventBus.on(` and `listen(` calls
2. Identify any that handle task/thread/repository events
3. Remove them if the new entity listeners cover the same functionality
4. Keep only component-specific handlers (e.g., local UI state, not entity refresh)

**File**: `src/entities/tasks/listeners.ts`

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { taskService } from "./service.js";
import { useTaskStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup task event listeners.
 * Each listener refreshes from disk (source of truth) then store updates.
 *
 * Error handling: Log and continue - don't let one failed refresh break the event flow.
 * The event has already happened; best effort refresh is better than crashing.
 */
export function setupTaskListeners(): void {
  eventBus.on(EventName.TASK_CREATED, async ({ taskId }) => {
    try {
      await taskService.refreshById(taskId);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh created task ${taskId}:`, e);
    }
  });

  eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
    try {
      await taskService.refreshById(taskId);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh updated task ${taskId}:`, e);
    }
  });

  eventBus.on(EventName.TASK_DELETED, async ({ taskId }) => {
    // Delete is synchronous store operation - unlikely to fail
    useTaskStore.getState()._applyDelete(taskId);
  });

  eventBus.on(EventName.TASK_STATUS_CHANGED, async ({ taskId }) => {
    try {
      await taskService.refreshById(taskId);
    } catch (e) {
      logger.error(`[TaskListener] Failed to refresh task status ${taskId}:`, e);
    }
  });
}
```

**File**: `src/entities/threads/listeners.ts`

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup thread event listeners.
 */
export function setupThreadListeners(): void {
  eventBus.on(EventName.THREAD_CREATED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread status ${threadId}:`, e);
    }
  });
}
```

**File**: `src/entities/repositories/listeners.ts`

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { repositoryService } from "./service.js";
import { useRepositoryStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup repository event listeners.
 */
export function setupRepositoryListeners(): void {
  eventBus.on(EventName.REPOSITORY_CREATED, async ({ name }) => {
    try {
      await repositoryService.refresh(name);
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to refresh created repository ${name}:`, e);
    }
  });

  eventBus.on(EventName.REPOSITORY_UPDATED, async ({ name }) => {
    try {
      await repositoryService.refresh(name);
    } catch (e) {
      logger.error(`[RepositoryListener] Failed to refresh updated repository ${name}:`, e);
    }
  });

  eventBus.on(EventName.REPOSITORY_DELETED, async ({ name }) => {
    // Delete is synchronous store operation - unlikely to fail
    useRepositoryStore.getState()._applyDelete(name);
  });
}
```

**File**: `src/entities/index.ts`

```typescript
import { setupTaskListeners } from "./tasks/listeners.js";
import { setupThreadListeners } from "./threads/listeners.js";
import { setupRepositoryListeners } from "./repositories/listeners.js";

/**
 * Initialize all entity event listeners.
 * Call once at app startup.
 */
export function setupEntityListeners(): void {
  setupTaskListeners();
  setupThreadListeners();
  setupRepositoryListeners();
}
```

---

### Phase 10: Remove Service Event Emissions (Prevent Double-Emit)

**Goal**: Services should NOT emit events that will trigger their own entity listeners.

The pattern is:
- **Agent → stdout → agent-service → eventBus.emit()** - this triggers entity listeners
- **Entity listeners → service.refreshById()** - this updates the store

If services also emit events, we get double-processing.

**File**: `src/entities/threads/service.ts`

**REMOVE these lines**:
```typescript
// Line 191 - DELETE (Node agent emits this, not frontend service)
eventBus.emit("thread:created", { metadata });

// Line 246 - DELETE (Node agent emits status changes)
eventBus.emit("thread:status-changed", { id, status: updates.status });
```

**File**: `src/entities/tasks/service.ts`

**KEEP these lines** (they serve different purposes):
```typescript
// Line 103 - KEEP (cross-concern notification for pending review UI)
eventBus.emit("action-requested", { ... });

// Line 372 - KEEP (local UI updates when user changes status via kanban)
// This is for local mutations, not agent-driven. Agent emits its own events.
eventBus.emit("task:status-changed", { id, status: updates.status });
```

**Rationale**:
- `thread:created` and `thread:status-changed` will now come from Node agent only
- `action-requested` is emitted locally when refreshing a task that gained a pending review
- `task:status-changed` is emitted locally for user-initiated status changes

---

### Phase 11: Update AppEvents Type

**Goal**: Single type definition extending shared types.

**File**: `src/entities/events.ts`

```typescript
import mitt from "mitt";
import {
  EventName,
  EventPayloads,
  EventNameType,
  ThreadState,
} from "@core/types/events.js";

// Re-export for convenience
export { EventName, type EventPayloads, type EventNameType };
export type { ThreadState };

/**
 * Frontend event payloads extend core payloads with optional metadata.
 */
export type AppEvents = {
  [K in EventNameType]: EventPayloads[K] & {
    _source?: "agent" | "local";
  };
};

export const eventBus = mitt<AppEvents>();
```

---

## Event Inventory

### Currently Working

| Event | Emitted | Consumed | Broadcast | Status |
|-------|---------|----------|-----------|--------|
| `agent:state` | Yes | Yes | Yes | OK |
| `agent:completed` | Yes | Yes | Yes | OK |
| `agent:error` | Yes | Yes | Yes | OK |
| `agent:spawned` | Yes | No | Yes | OK (informational) |
| `agent:tool-completed` | Yes | Yes | Yes | **BUG**: taskId is null |
| `action-requested` | Yes | Yes | Yes | OK |

### Needs Implementation

| Event | Emitted | Consumed | Broadcast | Action |
|-------|---------|----------|-----------|--------|
| `task:created` | No | No | No | Add in CLI |
| `task:updated` | No | No | No | Add in CLI |
| `task:deleted` | No | No | No | Add in CLI |
| `task:status-changed` | Local only | No | No | Add broadcast + handler |
| `thread:created` | Log only | Tauri | Yes | Convert to event |
| `thread:updated` | No | No | Yes | Add emission |
| `thread:status-changed` | Local only | No | No | Add broadcast + handler |
| `worktree:allocated` | Log only | No | No | Convert to event |
| `worktree:released` | Log only | No | No | Convert to event |
| `repository:*` | No | No | No | Add if needed |
| `settings:updated` | No | No | No | Add if needed |

---

## Migration Checklist

### Phase 1: Shared Types
- [ ] Verify/configure `@core/*` path alias in `agents/tsconfig.json`
- [ ] Verify/configure `@core/*` path alias in `src/tsconfig.json`
- [ ] Verify/configure `@core` resolve alias in `vite.config.ts`
- [ ] Create `core/types/events.ts`
- [ ] Create `core/types/settings.ts`
- [ ] Update `core/types/index.ts` exports
- [ ] Delete duplicate types from `agents/src/output.ts`
- [ ] Delete duplicate types from `src/lib/types/agent-messages.ts`
- [ ] Delete WorkflowMode from `agents/src/agent-types/merge-types.ts`
- [ ] Update imports throughout codebase

### Phase 2: Agent Event Emitter
- [ ] Rewrite `agents/src/lib/events.ts` with typed emitter
- [ ] Ensure `emitEvent` validates against EventName

### Phase 3: CLI Event Emissions
- [ ] Add `events.taskCreated()` after task create
- [ ] Add `events.taskUpdated()` after task rename
- [ ] Add `events.taskUpdated()`/`events.taskStatusChanged()` after task update
- [ ] Add `events.taskDeleted()` after task delete
- [ ] Add `events.actionRequested()` after request-human

### Phase 4: Orchestration Events
- [ ] Replace worktree allocated log with `events.worktreeAllocated()`
- [ ] Replace thread created log with `events.threadCreated()`
- [ ] Replace worktree released log with `events.worktreeReleased()`

### Phase 5: Event Parser
- [ ] Create `src/lib/agent-output-parser.ts`
- [ ] Implement `parseAgentOutput()` with validation
- [ ] Add unit tests for parser

### Phase 6: Agent Service Refactor
- [ ] Update `SpawnAgentWithOrchestrationOptions` to require `taskId`
- [ ] Update call sites in `spotlight.tsx` to pass `task.id`
- [ ] Update call sites in `task-workspace.tsx` to pass `task.id`
- [ ] Remove `detectAnvilMutations()` function
- [ ] Remove `tryRefreshFromToolResult()` function
- [ ] Implement `handleAgentEvent()` dispatcher
- [ ] Update stdout parsing to use `parseAgentOutput()`
- [ ] Use `options.taskId` for tool-completed events
- [ ] Add optimistic thread creation with `status: "running"` before spawn (fixes Bug 4)

### Phase 7: Loading State Fix
- [ ] Implement `threadService.createOptimistic()` in `src/entities/threads/service.ts`
- [ ] Add `_applyOptimistic` action to `src/entities/threads/store.ts`
- [ ] Add `thread?.status === "running"` check in `useActionState`

### Phase 8: Event Bridge
- [ ] Update BROADCAST_EVENTS to use EventName enum
- [ ] Add all task/thread/repository events

### Phase 9: Entity Event Listeners
- [ ] **Audit existing listeners**: Search for `eventBus.on(` and `listen(` across codebase
- [ ] Remove duplicate entity event handlers from `src/components/workspace/task-workspace.tsx`
- [ ] Remove duplicate entity event handlers from `src/components/spotlight/spotlight.tsx`
- [ ] Remove duplicate entity event handlers from `src/hooks/use-thread-state.ts`
- [ ] Remove inline handlers from `src/entities/index.ts`
- [ ] Create `src/entities/tasks/listeners.ts`
- [ ] Create `src/entities/threads/listeners.ts`
- [ ] Create `src/entities/repositories/listeners.ts`
- [ ] Update `src/entities/index.ts` to export `setupEntityListeners()`
- [ ] Call `setupEntityListeners()` in app initialization

### Phase 10: Remove Service Event Emissions
- [ ] DELETE `eventBus.emit("thread:created")` from `src/entities/threads/service.ts:191`
- [ ] DELETE `eventBus.emit("thread:status-changed")` from `src/entities/threads/service.ts:246`
- [ ] KEEP `eventBus.emit("action-requested")` in `src/entities/tasks/service.ts:103` (cross-concern)
- [ ] KEEP `eventBus.emit("task:status-changed")` in `src/entities/tasks/service.ts:372` (local mutations)

### Phase 11: AppEvents
- [ ] Update AppEvents to extend EventPayloads
- [ ] Remove duplicate type definitions

---

## Testing Strategy

### Unit Tests
1. Event parser validates EventName enum
2. Event emitter produces correct JSON format
3. Store handlers call correct service methods
4. `parseAgentOutput` returns null for invalid input

### Integration Tests
1. CLI command → event emission → disk refresh → store update
2. Orchestration → event emission → UI update
3. Cross-window broadcast propagation
4. Agent spawn → optimistic thread creation → loading state visible immediately

### Manual Tests
1. **content.md rendering**: Open task workspace, make agent write to content.md, verify live update
2. **Task rename**: Rename task via agent, verify UI reflects change immediately
3. **Thread list**: Start agent from task workspace, verify thread appears in list
4. **Loading state**: Click Start in action panel, verify spinner appears immediately (optimistic update, no delay)
5. **Cross-window**: Open same task in two windows, make changes, verify both update

---

## File Change Summary

| File | Action | Changes |
|------|--------|---------|
| `core/types/events.ts` | Create | EventName, EventPayloads, ThreadState, AgentOutput |
| `core/types/settings.ts` | Create | WorkflowMode |
| `core/types/index.ts` | Update | Add exports |
| `agents/src/output.ts` | Update | Remove duplicate types, import from @core |
| `agents/src/lib/events.ts` | Rewrite | Typed emitter with helpers |
| `agents/src/cli/anvil.ts` | Update | Add event emissions |
| `agents/src/orchestration.ts` | Update | Replace logs with events |
| `src/lib/agent-output-parser.ts` | Create | Typed parser |
| `src/lib/agent-service.ts` | Refactor | Add taskId to options, remove brittle parsing, add handleAgentEvent |
| `src/components/spotlight/spotlight.tsx` | Update | Pass `task.id` to spawn options |
| `src/components/workspace/task-workspace.tsx` | Update | Pass `task.id` to spawn options |
| `src/lib/types/agent-messages.ts` | Update | Remove duplicates, import from @core |
| `src/hooks/use-action-state.ts` | Update | Add thread status check |
| `src/lib/event-bridge.ts` | Update | Use EventName enum |
| `src/entities/events.ts` | Update | Extend EventPayloads |
| `src/entities/tasks/listeners.ts` | Create | Task event listeners |
| `src/entities/threads/listeners.ts` | Create | Thread event listeners |
| `src/entities/repositories/listeners.ts` | Create | Repository event listeners |
| `src/entities/index.ts` | Update | Export setupEntityListeners, DELETE setupTaskEventListeners |
| `src/entities/threads/service.ts` | Update | Add refreshById, createOptimistic; DELETE thread event emissions |
| `src/entities/tasks/service.ts` | Update | KEEP action-requested and task:status-changed emissions |
| `agents/src/agent-types/merge-types.ts` | Update | Remove WorkflowMode |

---

## Priority Order

| Priority | Phases | Impact |
|----------|--------|--------|
| **Critical** | 1, 2, 5, 6, 7 | Foundation + fix current bugs |
| **High** | 3, 4 | Complete event emissions from Node |
| **Medium** | 8, 9, 10, 11 | Full cross-window sync + cleanup |

### Dependency Graph

```
Phase 1 (Shared Types)
    │
    ├──► Phase 2 (Agent Event Emitter)
    │        │
    │        └──► Phase 3 (CLI Events)
    │        │
    │        └──► Phase 4 (Orchestration Events)
    │
    └──► Phase 5 (Event Parser)
             │
             └──► Phase 6 (Agent Service Refactor)
                      │
                      └──► Phase 7 (Loading State Fix)
                               │
                               └──► Phase 9 (Entity Listeners)
                                        │
                                        └──► Phase 10 (Remove Service Emissions)
                                                 │
                                                 └──► Phase 8, 11 (Bridge + AppEvents)
```

**Recommended execution order**:

1. **Phase 1** first - everything depends on shared types
2. **Phases 2 and 5** can be done in parallel after Phase 1
3. **Phase 6** depends on Phase 5 (parser) and uses types from Phase 1
4. **Phase 7** depends on Phase 6 (uses `createOptimistic` which is called in Phase 6)
5. **Phases 3 and 4** can be done anytime after Phase 2 (independent of frontend work)
6. **Phase 9** should come before Phase 8 - listeners must exist before broadcast matters
7. **Phase 10** after Phase 9 - remove service emissions that would double-trigger listeners
8. **Phases 8 and 11** are cleanup/polish, do last

**Note**: Phase 4 mentions "Frontend optimistically sets running status before spawning" - this refers to the Phase 6/7 implementation. Ensure Phase 6/7 are complete before testing Phase 4's assumption.

---

## Rollback Plan

If issues arise during migration:

1. Keep old `detectAnvilMutations()` code commented but available
2. Add feature flag `USE_NEW_EVENT_SYSTEM` defaulting to true
3. Can switch between old parsing and new events via flag
4. Monitor structured logs for unknown event names

---

## Changes from Review (2026-01-03)

This section documents changes made after initial plan review.

### 1. Fixed Double-Refresh Bug

**Problem**: Original design had `handleAgentEvent` refresh from disk AND emit to eventBus, then entity listeners would also refresh - causing duplicate disk reads.

**Solution**: `handleAgentEvent` now only emits to eventBus. Entity listeners (Phase 9) are the single place for all disk refreshes. This ensures:
- No double-refresh in originating window
- Cross-window broadcasts correctly trigger refresh via listeners
- Single source of truth for refresh logic

### 2. Added Explicit `threadService.createOptimistic()` Definition

**Problem**: Phase 6 used `threadService.createOptimistic()` but it wasn't defined anywhere.

**Solution**: Added complete implementation in Phase 7, including:
- `createOptimistic()` method in `src/entities/threads/service.ts`
- `_applyOptimistic` store action in `src/entities/threads/store.ts`

### 3. Clarified Phase Dependencies

**Problem**: Phase 4 assumed frontend optimistic update was done, but that's implemented in Phase 6/7.

**Solution**: Added dependency notes to Phase 4 and updated Priority Order section with clear dependency graph showing execution order.

### 4. Clarified ThreadState.status Type

**Problem**: `ThreadState.status` used inline union while `ThreadStatus` was imported separately - unclear if they matched.

**Solution**: Added documentation to `ThreadState` explaining the relationship: it uses a subset of `ThreadStatus` values (excludes "idle" since agents never emit state for idle threads).

### 5. Added Cleanup for Existing Scattered Listeners

**Problem**: Plan added new listeners but didn't mention removing existing scattered handlers, risking duplicate processing.

**Solution**: Added audit table and process to Phase 9 listing known files with handlers to remove before adding new centralized listeners.

### 6. Added Logging for Parse Failures

**Problem**: `parseAgentOutput` silently returned null on JSON parse failure, making debugging difficult.

**Solution**: Added `logger.debug()` call when JSON parse fails, including first 100 chars of failed input.

### 7. Added Error Handling to Entity Listeners

**Problem**: Async listeners had no try-catch, so a failed refresh could break event flow.

**Solution**: Wrapped all async operations in try-catch with `logger.error()` calls. Philosophy: log and continue - the event already happened, best-effort refresh is better than crashing.

### 8. Added Path Alias Prerequisite

**Problem**: Plan used `@core/types/events.js` imports but didn't verify these aliases were configured.

**Solution**: Added prerequisite section to Phase 1 listing all required tsconfig and vite.config changes to enable `@core/*` imports in both `agents/` and `src/` packages.

### 9. Added Complete Listener Audit Table

**Problem**: Plan mentioned removing scattered listeners but didn't enumerate all locations.

**Solution**: Added comprehensive table in "Scattered Listener Locations (MUST CONSOLIDATE)" section listing every file with event handlers and what action to take (DELETE, KEEP, or UPDATE).

### 10. Clarified Optimistic Update Does NOT Write to Disk

**Problem**: `createOptimistic()` description was ambiguous about disk behavior.

**Solution**: Explicitly documented that optimistic updates are store-only. Added comments explaining the pattern:
1. Store update → immediate UI feedback
2. Async operation → Node creates thread on disk
3. Event → listener refreshes from disk → store converges to truth

### 11. Added Phase 10 for Service Emission Cleanup

**Problem**: Services emit events that would double-trigger once entity listeners are added.

**Solution**: Added Phase 10 to explicitly remove `thread:created` and `thread:status-changed` emissions from threadService (Node agent handles these), while keeping `action-requested` and `task:status-changed` (needed for local UI).

### 12. Documented Event Protocol Inconsistency

**Problem**: Plan didn't explicitly call out the `{ type, event }` vs `{ type, name }` vs `{ type: eventName }` inconsistency.

**Solution**: Added "Event Protocol Inconsistency" section showing the three different patterns currently in use and the target protocol to standardize on.

### 13. Highlighted slug vs taskId Bug

**Problem**: Dead code section didn't emphasize that existing events use `slug` which violates AGENTS.md.

**Solution**: Added "CRITICAL" note and "ALSO USES SLUG NOT TASKID" annotations to make this violation obvious.
