# 05 - Hydration Integration

**Dependencies:** 01-core-types, 02-store-service, 03-detection, 04-entity-relationships
**Parallelizable after completion with:** 06-ui, 07-navigation

## Design Decisions

- **Hydration Order**: Keep parallel hydration via `Promise.all` (plans hydrate alongside other entities)
- **Bootstrap Location**: Hydration happens in `src/entities/index.ts` via `hydrateEntities()`, NOT in App.tsx
- **Event Structure**: `AGENT_STATE` events have `{ threadId, state }` where `state.fileChanges` contains the file changes
- **Repository Name**: Look up from task via `taskId`, threads don't have `repositoryName` directly

## Overview

Integrate the Plan entity into the app's bootstrap/hydration sequence and wire up the detection service to thread state events.

## Implementation Steps

### 1. Update Entities Index for Hydration

**File:** `src/entities/index.ts`

Add plan hydration to `hydrateEntities()` (runs in parallel with other entities):

```typescript
import { planService } from "./plans";

export async function hydrateEntities(): Promise<void> {
  await Promise.all([
    taskService.hydrate(),
    threadService.hydrate(),
    repoService.hydrate(),
    settingsService.hydrate(),
    planService.hydrate(), // Add plans - runs in parallel
  ]);
}
```

Also add plans to exports:

```typescript
export * from "./plans";
```

### 2. Wire Detection into Thread State Listener

**File:** `src/entities/threads/listeners.ts`

Integrate plan detection when thread state changes:

```typescript
import { planService, detectPlanFromFileChanges } from "@/entities/plans";
import { useTaskStore } from "@/entities/tasks";
import { threadService } from "./service";
import { eventBus, EventName } from "@/lib/event-bridge";

// In setupThreadListeners or equivalent:
export function setupThreadListeners() {
  // ... existing listeners

  // Plan detection from AGENT_STATE events
  eventBus.on(EventName.AGENT_STATE, async ({ threadId, state }) => {
    const thread = useThreadStore.getState().getThread(threadId);
    if (!thread) return;

    // Skip if thread already has a plan associated
    if (thread.planId) return;

    // Check for plan file changes
    if (state.fileChanges && state.fileChanges.length > 0) {
      // Get repository name from task
      const task = useTaskStore.getState().tasks[thread.taskId];
      if (!task?.repositoryName) return;

      const result = detectPlanFromFileChanges(
        state.fileChanges,
        thread.workingDirectory
      );

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          task.repositoryName,
          result.path
        );
        await threadService.update(thread.id, { planId: plan.id });
      }
    }
  });
}
```

### 3. Wire Detection into User Message Submission

**File:** Integrate where user messages are submitted (component or service level)

Since there's no centralized message handler, this should be integrated at the component level where messages are submitted. The pattern:

```typescript
import { detectPlanFromMessage, planService } from "@/entities/plans";
import { useTaskStore } from "@/entities/tasks";
import { threadService } from "@/entities/threads";

// When submitting a user message:
async function handleMessageSubmit(
  content: string,
  thread: ThreadMetadata
): Promise<void> {
  // Only check if thread doesn't already have a plan
  if (!thread.planId) {
    const task = useTaskStore.getState().tasks[thread.taskId];

    if (task?.repositoryName) {
      const result = detectPlanFromMessage(content);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          task.repositoryName,
          result.path
        );
        await threadService.update(thread.id, { planId: plan.id });
      }
    }
  }

  // Continue with normal message submission...
}
```

**Integration points to add this:**
- Spotlight message submission
- Thread panel message input
- Any other message entry points

### 4. Verify Plan References After Hydration (Optional)

**File:** `src/entities/index.ts`

Add a post-hydration verification step if desired:

```typescript
export async function hydrateEntities(): Promise<void> {
  await Promise.all([
    taskService.hydrate(),
    threadService.hydrate(),
    repoService.hydrate(),
    settingsService.hydrate(),
    planService.hydrate(),
  ]);

  // Optional: Verify plan references exist
  verifyPlanReferences();
}

function verifyPlanReferences(): void {
  const threads = useThreadStore.getState().getAll();
  const planStore = usePlanStore.getState();

  for (const thread of threads) {
    if (thread.planId) {
      const plan = planStore.getPlan(thread.planId);
      if (!plan) {
        console.warn(
          `Thread ${thread.id} references missing plan ${thread.planId}`
        );
        // Could optionally clear the reference:
        // threadService.update(thread.id, { planId: null });
      }
    }
  }
}
```

### 5. Setup Entity Listeners

**File:** `src/entities/index.ts`

Ensure plan-related listeners are set up:

```typescript
export function setupEntityListeners(): void {
  setupTaskListeners();
  setupThreadListeners(); // This now includes plan detection
  // ... other listeners
}
```

## Important Notes

1. **AGENT_STATE Event Structure:**
   ```typescript
   EventPayloads[EventName.AGENT_STATE] = {
     threadId: string;
     state: ThreadState;  // fileChanges is inside state
   };
   ```

2. **FileChange Structure:**
   ```typescript
   interface FileChange {
     path: string;
     operation: "create" | "modify" | "delete" | "rename";
     oldPath?: string;
     diff: string;
   }
   ```

3. **Repository Name Resolution:**
   - Threads have `taskId` but NOT `repositoryName`
   - Must look up task to get `repositoryName`
   - Pattern: `useTaskStore.getState().tasks[thread.taskId]?.repositoryName`

## Validation Criteria

- [ ] Plans hydrate in parallel with other entities (Promise.all)
- [ ] Creating/editing a plan file associates the thread with that plan
- [ ] Mentioning a plan path in user message associates the thread
- [ ] Plans are only created once per repo+path combination (idempotent)
- [ ] Missing plan references are logged (optionally cleared)
- [ ] App boots without errors
- [ ] Plan store is populated after hydration
- [ ] Repository name is correctly resolved from task
