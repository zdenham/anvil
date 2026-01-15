# Sub-plan 3: Frontend Parsing & Service

**Parent Plan**: `plans/event-system-overhaul.md`
**Phases Covered**: Phases 5, 6, 7
**Depends On**: Sub-plan 1 (Foundation)
**Parallel With**: Sub-plan 2 (Agent Events)
**Blocks**: Sub-plan 4

---

## Goal

Replace brittle line-by-line JSON parsing with typed event handling. Fix Bug 1 (content.md not rendering) and Bug 4 (no loading state).

---

## Phase 5: Typed Event Parser

### Create: `src/lib/agent-output-parser.ts`

```typescript
import {
  AgentOutput,
  AgentEventMessage,
  AgentStateMessage,
  AgentLogMessage,
  EventName,
  EventNameType,
  EventPayloads,
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

### Checklist - Phase 5

- [ ] Create `src/lib/agent-output-parser.ts`
- [ ] Implement `parseAgentOutput()` with validation against `EventName`
- [ ] Add debug logging for parse failures
- [ ] Verify types compile

---

## Phase 6: Agent Service Refactor

### File: `src/lib/agent-service.ts`

#### 1. Update `SpawnAgentWithOrchestrationOptions`

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

#### 2. Update Call Sites

**File: `src/components/spotlight/spotlight.tsx`**
```typescript
// When calling spawnAgentWithOrchestration, pass task.id
await spawnAgentWithOrchestration({
  agentType,
  taskSlug: task.slug,
  taskId: task.id,  // ADD THIS
  threadId,
  prompt,
});
```

**File: `src/components/workspace/task-workspace.tsx`**
```typescript
// Same - pass task.id
await spawnAgentWithOrchestration({
  agentType,
  taskSlug: task.slug,
  taskId: task.id,  // ADD THIS
  threadId,
  prompt,
});
```

#### 3. Remove Brittle Parsing Functions

DELETE these functions from `src/lib/agent-service.ts`:
- `detectMortMutations()` (lines 56-66)
- `tryRefreshFromToolResult()` (lines 73-122)

#### 4. Add Typed Event Handler

```typescript
import { parseAgentOutput } from "./agent-output-parser.js";
import { EventName, AgentEventMessage, EventNameType } from "@core/types/events.js";

/**
 * Handle typed events from agent process.
 *
 * IMPORTANT: This function only emits to eventBus - it does NOT refresh from disk.
 * Entity listeners (Sub-plan 4) handle all disk refreshes.
 */
function handleAgentEvent(
  event: AgentEventMessage,
  threadId: string
): void {
  const { name, payload } = event;

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

#### 5. Update stdout Parsing

Replace the existing stdout handler with:

```typescript
// In spawnAgentWithOrchestration stdout handler:
const taskId = options.taskId;  // Now available from options

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
          taskId,  // Now correctly using options.taskId (fixes Bug 1)
        });
      }
      break;

    case "event":
      handleAgentEvent(output, threadId);
      break;

    case "log":
      // Forward to logger or structured log file
      break;
  }
}
```

#### 6. Add Optimistic Thread Creation (Fixes Bug 4)

Before spawning the command:

```typescript
// Optimistically create thread with running status before spawning
await threadService.createOptimistic({
  id: options.threadId,
  taskId: options.taskId,
  status: "running",
});

// Spawn the command - Node will emit events for subsequent state changes
await command.spawn();
```

### Checklist - Phase 6

- [ ] Update `SpawnAgentWithOrchestrationOptions` to require `taskId`
- [ ] Update call site in `spotlight.tsx` to pass `task.id`
- [ ] Update call site in `task-workspace.tsx` to pass `task.id`
- [ ] Remove `detectMortMutations()` function
- [ ] Remove `tryRefreshFromToolResult()` function
- [ ] Implement `handleAgentEvent()` dispatcher
- [ ] Update stdout parsing to use `parseAgentOutput()`
- [ ] Use `options.taskId` for tool-completed events
- [ ] Add optimistic thread creation before spawn

---

## Phase 7: Loading State Fix

### File: `src/entities/threads/service.ts`

Add `createOptimistic` method:

```typescript
import type { ThreadStatus } from "@core/types/threads.js";
import type { ThreadMetadata } from "./types.js";
import { useThreadStore } from "./store.js";

/**
 * Create an optimistic thread entry in the store before agent spawn.
 * This allows immediate UI feedback (loading state) without waiting for Node.
 *
 * IMPORTANT: This does NOT write to disk. The thread exists only in memory.
 * Disk write happens when Node orchestration creates the thread and emits
 * thread:created event, which triggers refreshById to sync from disk.
 */
createOptimistic(params: {
  id: string;
  taskId: string;
  status: ThreadStatus;
}): void {
  const { id, taskId, status } = params;

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

### File: `src/entities/threads/store.ts`

Add store action:

```typescript
// Add to store actions:
_applyOptimistic: (thread: ThreadMetadata) => {
  set((state) => ({
    threads: { ...state.threads, [thread.id]: thread },
  }));
},
```

### File: `src/hooks/use-action-state.ts`

Add thread status check:

```typescript
// Add after streamingState check (around line 27):
// Thread status is set optimistically by frontend before spawning
if (thread?.status === "running") {
  return { type: "streaming" };
}
```

### Flow Summary

1. User submits prompt
2. Frontend generates thread UUID
3. Frontend calls `threadService.createOptimistic({ id, taskId, status: "running" })`
4. Store updates immediately → `useActionState` returns streaming → UI shows loading
5. Frontend spawns agent process
6. Node emits events → handlers refresh from disk → store stays in sync

### Checklist - Phase 7

- [ ] Implement `threadService.createOptimistic()` in `src/entities/threads/service.ts`
- [ ] Add `_applyOptimistic` action to `src/entities/threads/store.ts`
- [ ] Add `thread?.status === "running"` check in `useActionState`
- [ ] Verify loading state appears immediately on agent spawn

---

## Testing

### Unit Tests

1. `parseAgentOutput` returns correct type for each message type
2. `parseAgentOutput` returns null for invalid JSON
3. `parseAgentOutput` returns null for unknown event names
4. `createOptimistic` updates store without disk write

### Integration Tests

1. Agent spawn → optimistic thread creation → loading state visible immediately
2. Tool completion event has correct `taskId` (Bug 1 fix verification)

### Manual Tests

1. **Loading state**: Click Start in action panel, verify spinner appears immediately
2. **content.md rendering**: Make agent write to content.md, verify live update in TaskOverview

---

## Completion Criteria

- [ ] `src/lib/agent-output-parser.ts` created with typed parser
- [ ] `src/lib/agent-service.ts` refactored to use new parser
- [ ] `taskId` correctly passed through spawn options
- [ ] Optimistic thread creation implemented
- [ ] Loading state appears immediately on agent spawn
- [ ] `pnpm typecheck` passes

---

## Next Steps

After completion:
- Unblock Sub-plan 4 (Entity Listeners & Cleanup)
- Enable full end-to-end testing with Sub-plan 2
