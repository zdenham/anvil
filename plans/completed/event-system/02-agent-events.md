# Sub-plan 2: Agent Event System

**Parent Plan**: `plans/event-system-overhaul.md`
**Phases Covered**: Phases 2, 3, 4
**Depends On**: Sub-plan 1 (Foundation)
**Parallel With**: Sub-plan 3 (Frontend Parsing)
**Blocks**: Sub-plan 4 (partially - testing only)

---

## Goal

Implement strongly-typed event emission from the Node agent process. Replace ad-hoc `logger.info(JSON.stringify(...))` calls with typed `events.emit()` calls.

---

## Phase 2: Agent Event Emitter

### File: `agents/src/lib/events.ts`

Rewrite with typed emitter:

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

### Checklist - Phase 2

- [ ] Rewrite `agents/src/lib/events.ts` with typed emitter
- [ ] Ensure `emitEvent` uses `EventName` enum
- [ ] Export `events` helper object
- [ ] Verify types compile with `pnpm --filter agents typecheck`

---

## Phase 3: CLI Event Emissions

### File: `agents/src/cli/anvil.ts`

Add event emissions after all CLI mutations:

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

### Checklist - Phase 3

- [ ] Add `events.taskCreated()` after task create
- [ ] Add `events.taskUpdated()` after task rename
- [ ] Add `events.taskUpdated()`/`events.taskStatusChanged()` after task update
- [ ] Add `events.taskDeleted()` after task delete
- [ ] Add `events.actionRequested()` after request-human

---

## Phase 4: Orchestration Events

### File: `agents/src/orchestration.ts`

Replace `logger.info(JSON.stringify(...))` calls with typed events:

```typescript
import { events } from "./lib/events.js";

// Line ~123: After worktree allocation (replace logger.info)
events.worktreeAllocated(allocation.worktree, mergeBase);

// Line ~137: After thread creation (replace logger.info)
events.threadCreated(thread.id, taskMeta.id);

// Line ~183: After worktree release (replace logger.info)
events.worktreeReleased(threadId);
```

### Note on Dependencies

Phase 4 assumes frontend optimistic updates are complete (Sub-plan 3, Phase 7). The orchestration code can be written now, but full testing should wait until Sub-plan 3 completes.

### Checklist - Phase 4

- [ ] Replace worktree allocated log with `events.worktreeAllocated()`
- [ ] Replace thread created log with `events.threadCreated()`
- [ ] Replace worktree released log with `events.worktreeReleased()`
- [ ] Remove old `logger.info(JSON.stringify({type: 'worktree:allocated'...}))` calls

---

## Testing

### Unit Tests

1. Event emitter produces correct JSON format:
   ```typescript
   // Test that emitEvent outputs valid JSON with correct structure
   const output = captureStdout(() => events.taskCreated("task-123"));
   expect(JSON.parse(output)).toEqual({
     type: "event",
     name: "task:created",
     payload: { taskId: "task-123" }
   });
   ```

2. All EventName values are valid strings

### Integration Tests (after Sub-plan 3)

1. CLI command → event emission → captured by frontend
2. Orchestration → event emission → UI update

---

## Completion Criteria

- [ ] `agents/src/lib/events.ts` rewritten with typed emitter
- [ ] All CLI mutations emit corresponding events
- [ ] All orchestration state changes emit events
- [ ] `pnpm --filter agents typecheck` passes
- [ ] No more raw `logger.info(JSON.stringify({type:...}))` for events

---

## Next Steps

After completion:
- Sub-plan 4 can begin testing (needs both Sub-plans 2 and 3)
- Full end-to-end testing with Sub-plan 3's frontend changes
