# Sub-plan 4: Entity Listeners & Cleanup

**Parent Plan**: `plans/event-system-overhaul.md`
**Phases Covered**: Phases 9, 10, 8, 11
**Depends On**: Sub-plans 2 and 3
**Parallel With**: None (final phase)

---

## Goal

Create centralized entity event listeners, remove scattered handlers, update event bridge, and clean up AppEvents type. Fixes Bugs 2 (task updates not rendering) and 3 (thread list not updating).

---

## Phase 9: Entity Event Listeners

### Pre-requisite: Audit Existing Listeners

Before adding new listeners, remove existing scattered handlers to prevent duplicate processing.

**Search for existing handlers:**
```bash
grep -r "eventBus.on(" --include="*.ts" --include="*.tsx" src/
grep -r "listen(" --include="*.ts" --include="*.tsx" src/
```

**Known locations to clean up:**

| File | Current Behavior | Action |
|------|------------------|--------|
| `src/entities/index.ts:71-114` | Inline Tauri `listen()` calls | DELETE - replace with `setupEntityListeners()` |
| `src/components/workspace/task-workspace.tsx` | Direct Tauri `listen()` calls | REVIEW - remove if duplicating entity logic |
| `src/components/spotlight/spotlight.tsx` | Mixed eventBus/Tauri handlers | REVIEW - remove if duplicating entity logic |
| `src/hooks/use-thread-state.ts` | Direct event subscriptions | REVIEW - keep only component-specific handlers |

### Create: `src/entities/tasks/listeners.ts`

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { taskService } from "./service.js";
import { useTaskStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

/**
 * Setup task event listeners.
 * Each listener refreshes from disk (source of truth) then store updates.
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

### Create: `src/entities/threads/listeners.ts`

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

### Create: `src/entities/repositories/listeners.ts`

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
    useRepositoryStore.getState()._applyDelete(name);
  });
}
```

### Update: `src/entities/index.ts`

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

// DELETE the old inline Tauri listen() calls (lines 71-114)
```

### Update: App Initialization

Find where the app initializes and add:

```typescript
import { setupEntityListeners } from "./entities/index.js";

// During app init
setupEntityListeners();
```

### Store Updates Required

Add `_applyDelete` actions to stores if not present:

**`src/entities/tasks/store.ts`:**
```typescript
_applyDelete: (taskId: string) => {
  set((state) => {
    const { [taskId]: _, ...remaining } = state.tasks;
    return { tasks: remaining };
  });
},
```

**`src/entities/repositories/store.ts`:**
```typescript
_applyDelete: (name: string) => {
  set((state) => {
    const { [name]: _, ...remaining } = state.repositories;
    return { repositories: remaining };
  });
},
```

### Checklist - Phase 9

- [ ] Audit existing listeners (search `eventBus.on(` and `listen(`)
- [ ] Remove duplicate handlers from components/hooks
- [ ] Remove inline handlers from `src/entities/index.ts`
- [ ] Create `src/entities/tasks/listeners.ts`
- [ ] Create `src/entities/threads/listeners.ts`
- [ ] Create `src/entities/repositories/listeners.ts`
- [ ] Add `_applyDelete` to task store
- [ ] Add `_applyDelete` to repository store
- [ ] Export `setupEntityListeners()` from `src/entities/index.ts`
- [ ] Call `setupEntityListeners()` in app initialization

---

## Phase 10: Remove Service Event Emissions

### Goal

Remove service-level event emissions that would double-trigger entity listeners.

### File: `src/entities/threads/service.ts`

**DELETE these lines:**
```typescript
// Line 191 - DELETE (Node agent emits this, not frontend service)
eventBus.emit("thread:created", { metadata });

// Line 246 - DELETE (Node agent emits status changes)
eventBus.emit("thread:status-changed", { id, status: updates.status });
```

### File: `src/entities/tasks/service.ts`

**KEEP these lines** (they serve different purposes):
```typescript
// Line 103 - KEEP (cross-concern notification for pending review UI)
eventBus.emit("action-requested", { ... });

// Line 372 - KEEP (local UI updates when user changes status via kanban)
eventBus.emit("task:status-changed", { id, status: updates.status });
```

### Rationale

- `thread:created` and `thread:status-changed` will now come from Node agent only
- `action-requested` is emitted locally when refreshing a task that gained a pending review
- `task:status-changed` is emitted locally for user-initiated status changes (e.g., kanban drag)

### Checklist - Phase 10

- [ ] DELETE `eventBus.emit("thread:created")` from `src/entities/threads/service.ts:191`
- [ ] DELETE `eventBus.emit("thread:status-changed")` from `src/entities/threads/service.ts:246`
- [ ] VERIFY `eventBus.emit("action-requested")` kept in `src/entities/tasks/service.ts:103`
- [ ] VERIFY `eventBus.emit("task:status-changed")` kept in `src/entities/tasks/service.ts:372`

---

## Phase 8: Event Bridge Broadcast List

### File: `src/lib/event-bridge.ts`

Update `BROADCAST_EVENTS` to use `EventName` enum:

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

  // Repository
  EventName.REPOSITORY_CREATED,
  EventName.REPOSITORY_UPDATED,
  EventName.REPOSITORY_DELETED,

  // Settings
  EventName.SETTINGS_UPDATED,
] as const;
```

### Checklist - Phase 8

- [ ] Import `EventName` from `@core/types/events.js`
- [ ] Update `BROADCAST_EVENTS` to use enum values
- [ ] Remove any hardcoded string event names

---

## Phase 11: AppEvents Type Update

### File: `src/entities/events.ts`

Update to extend shared types:

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

### Checklist - Phase 11

- [ ] Update `AppEvents` to extend `EventPayloads`
- [ ] Remove duplicate type definitions
- [ ] Re-export types for convenience
- [ ] Verify types compile

---

## Testing

### Integration Tests

1. CLI command → event emission → disk refresh → store update
2. Orchestration → event emission → UI update
3. Cross-window broadcast propagation
4. No double-refresh (verify only one disk read per event)

### Manual Tests

1. **Task updates (Bug 2)**: Rename task via agent, verify UI updates immediately
2. **Thread list (Bug 3)**: Start agent from task workspace, verify thread appears in list
3. **Cross-window**: Open same task in two windows, make changes, verify both update
4. **No double processing**: Check logs for duplicate refresh calls

---

## Completion Criteria

- [ ] All entity listeners created and registered
- [ ] Scattered handlers removed from components
- [ ] Service event emissions cleaned up
- [ ] Event bridge uses `EventName` enum
- [ ] `AppEvents` extends shared `EventPayloads`
- [ ] No duplicate event handling
- [ ] `pnpm typecheck` passes
- [ ] All manual tests pass

---

## Final Verification

After all sub-plans complete, verify full event flow:

```
Node Agent                    Tauri Frontend
    │                              │
    │ stdout: {type:"event"...}    │
    │──────────────────────────────►│
    │                              │ parseAgentOutput()
    │                              │ handleAgentEvent()
    │                              │ eventBus.emit()
    │                              │      │
    │                              │      ▼
    │                              │ Entity Listener
    │                              │ service.refreshById()
    │                              │      │
    │                              │      ▼
    │                              │ Store Update
    │                              │      │
    │                              │      ▼
    │                              │ UI Re-render
```
