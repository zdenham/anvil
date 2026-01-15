# Disk-First Event Architecture

## Problem

`useStreamingThread` violates two core patterns:

### 1. Disk is Truth

It maintains local React state from event payloads that never gets overwritten by disk state. When agent completes, stale state keeps UI stuck in loading.

### 2. Entity/Store Pattern

It uses `useState` instead of the official entity state via `listeners.ts` → service → store. We already have `ThreadUIStore` with `messages`, `fileChanges`, `status` - exactly what `useStreamingThread` duplicates.

## Correct Architecture

```
Agent Process                          Frontend
─────────────                          ────────
1. Write state.json to disk (await)
2. Emit event: { threadId }        ──► listeners.ts receives event
                                       │
                                       ▼
                                  3. threadService.refreshThreadState(threadId)
                                       │
                                       ▼
                                  4. Reads from disk, updates ThreadUIStore
                                       │
                                       ▼
                                  5. Components use useThreadUIStore
```

Events may carry data for optimistic updates, but must also trigger disk refresh. Disk overwrites optimistic state.

---

## Phase 1: Fix Agent Process Order

### 1.1 Update `agents/src/output.ts`

Change `emitState()` to write disk first, then emit:

```typescript
export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const payload = { ...state };

  // 1. FIRST: Write to disk (must complete before emitting)
  if (threadWriter) {
    try {
      await threadWriter.writeState(payload);
    } catch (err) {
      logger.warn(`[output] ThreadWriter failed: ${err}, trying direct write`);
      writeFileSync(statePath, JSON.stringify(payload, null, 2));
    }
  } else {
    writeFileSync(statePath, JSON.stringify(payload, null, 2));
  }

  // 2. THEN: Emit event (can include payload for optimistic updates)
  console.log(JSON.stringify({ type: "state", state: payload }));
}
```

### 1.2 Update All Callers to Await

Functions that call `emitState()` need to await it:

- `initState()`, `appendUserMessage()`, `appendAssistantMessage()`
- `appendToolResult()`, `markToolRunning()`, `updateFileChange()`
- `complete()`, `error()`

---

## Phase 2: Add Listeners for Agent Events

### 2.1 Update `src/entities/threads/listeners.ts`

Add listeners for `agent:state` and `agent:completed`:

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { logger } from "@/lib/logger-client.js";

export function setupThreadListeners(): void {
  // ... existing listeners ...

  // Agent state updates - refresh thread state from disk
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }) => {
    try {
      await threadService.refreshThreadState(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread state ${threadId}:`, e);
    }
  });

  // Agent completed - refresh thread state from disk
  eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }) => {
    try {
      await threadService.refreshThreadState(threadId);
      await threadService.refreshById(threadId); // Also refresh metadata
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  });
}
```

### 2.2 Add `refreshThreadState` to Thread Service

Add method to read `state.json` and update `ThreadUIStore`:

```typescript
// src/entities/threads/service.ts

async refreshThreadState(threadId: string): Promise<void> {
  const thread = this.get(threadId);
  if (!thread) return;

  const task = taskService.get(thread.taskId);
  if (!task) return;

  // Read state.json from disk
  const dataDir = await fs.getDataDir();
  const threadFolderName = `${thread.agentType}-${threadId}`;
  const statePath = fs.joinPath(dataDir, "tasks", task.slug, "threads", threadFolderName, "state.json");

  if (!(await fs.exists(statePath))) return;

  const content = await fs.readFile(statePath);
  const state = JSON.parse(content) as ThreadState;

  // Update ThreadUIStore
  const fileChanges = new Map<string, FileChange>();
  for (const change of state.fileChanges ?? []) {
    fileChanges.set(change.path, change);
  }

  useThreadUIStore.getState().setThread(threadId, {
    messages: state.messages,
    fileChanges,
    metadata: thread,
  });

  // Update status based on state
  const uiStatus = state.status === "complete" ? "completed" : state.status;
  useThreadUIStore.getState().setStatus(uiStatus);
}
```

---

## Phase 3: Delete Duplicated State

### 3.1 Delete `useStreamingThread`

Remove `src/hooks/use-streaming-thread.ts` entirely.

### 3.2 Update `src/hooks/index.ts`

Remove the export.

### 3.3 Update `task-workspace.tsx`

Use `useThreadUIStore` instead of `useStreamingThread`:

```typescript
// BEFORE
const { streamingState } = useStreamingThread(activeThreadId);
const { threadState: diskState, status: diskStatus } = useThreadMessages(activeThreadId);
const threadState = streamingState ?? diskState;

// AFTER
const { messages, fileChanges, status } = useThreadUIStore();
// Or keep useThreadMessages for initial load, but ThreadUIStore for live updates
```

### 3.4 Update `use-action-state.ts`

Remove `useStreamingThread` usage, use store instead.

### 3.5 Consider Deleting `useThreadMessages`

If `ThreadUIStore` is the single source, `useThreadMessages` may become redundant. The initial load can happen in the listener when thread is selected.

---

## Phase 4: Performance Optimization (If Needed)

### 4.1 Debounce Disk Reads

If `agent:state` events fire very frequently, debounce in the listener:

```typescript
import { debounce } from "lodash-es";

const debouncedRefresh = debounce(
  (threadId: string) => threadService.refreshThreadState(threadId),
  50
);

eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
  debouncedRefresh(threadId);
});
```

### 4.2 Optimistic Updates (Optional)

For snappier UI, apply event payload immediately, then let disk refresh overwrite:

```typescript
eventBus.on(EventName.AGENT_STATE, async ({ threadId, state }) => {
  // Optimistic: apply event payload immediately
  if (state) {
    useThreadUIStore.getState().setMessages(state.messages);
  }
  // Then refresh from disk (overwrites optimistic state)
  await threadService.refreshThreadState(threadId);
});
```

---

## File Changes Summary

| File | Action |
|------|--------|
| `agents/src/output.ts` | Make `emitState()` async, write disk first, then emit |
| `agents/src/runner.ts` | Update to await async output functions |
| `src/entities/threads/listeners.ts` | Add `AGENT_STATE` and `AGENT_COMPLETED` listeners |
| `src/entities/threads/service.ts` | Add `refreshThreadState()` method |
| `src/hooks/use-streaming-thread.ts` | **DELETE** |
| `src/hooks/index.ts` | Remove `useStreamingThread` export |
| `src/hooks/use-thread-messages.ts` | May become redundant (consider deleting) |
| `src/components/workspace/task-workspace.tsx` | Use `useThreadUIStore` instead of streaming hooks |
| `src/hooks/use-action-state.ts` | Remove `useStreamingThread` usage, use store |

---

## Validation Checklist

- [ ] Start new thread → messages appear as agent runs
- [ ] Follow-up message → messages update in real-time
- [ ] Thread completes → shows completed state (no stuck loading)
- [ ] Close and reopen app mid-stream → recovers from disk
- [ ] Multiple windows → both stay in sync
- [ ] Rapid state updates → UI stays responsive (no lag from disk reads)

---

## Rollback Plan

If issues arise, the changes are isolated:
1. Revert `output.ts` to sync stdout-first behavior
2. Restore `useStreamingThread` and its usage
3. Restore full state payload in events

Each phase can be reverted independently.
