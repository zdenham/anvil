# Sub-Plan 5: Task Creation Flow Integration

## Prerequisites
- **Sub-Plan 1 (Data Model)** must be complete (for `worktreePath` on task/thread types)
- **Sub-Plan 4 (Spotlight Worktree Selection)** must be complete

## Parallel Execution
This is the **final integration step** - runs after Sub-Plans 1 and 4 are complete.

## Overview
Wire the explicit `worktreePath` through the entire task creation flow, from spotlight selection to agent spawn. Remove any remaining auto-allocation logic.

---

## Part A: Task Service Integration

### File: `src/lib/task-service.ts` (or equivalent)

Update task creation to accept and store `worktreePath`:

```typescript
interface CreateTaskOptions {
  prompt: string;
  repositoryName: string;
  worktreePath: string; // Now required (or validated separately)
}

async function createTask(options: CreateTaskOptions): Promise<Task> {
  const { prompt, repositoryName, worktreePath } = options;

  // Validate worktree exists
  if (!worktreePath) {
    throw new Error("Worktree path is required");
  }

  const task = await taskService.createDraft({
    prompt,
    repositoryName,
    worktreePath, // Store on task
  });

  return task;
}
```

---

## Part B: Thread Creation

Ensure threads also store `worktreePath`:

```typescript
interface CreateThreadOptions {
  taskId: string;
  worktreePath: string;
  // ... other fields
}

async function createThread(options: CreateThreadOptions): Promise<Thread> {
  const thread = await threadService.create({
    taskId: options.taskId,
    worktreePath: options.worktreePath, // Store on thread
    // ... other fields
  });

  return thread;
}
```

---

## Part C: Agent Spawn with Explicit CWD

### File: `src/lib/agent-service.ts`

Update `spawnAgentWithOrchestration` (or equivalent spawn function):

```typescript
export interface SpawnAgentOptions {
  taskSlug: string;
  threadId: string;
  prompt: string;
  agentType: string;
  worktreePath: string; // Explicit - no longer optional
}

export async function spawnAgent(options: SpawnAgentOptions): Promise<void> {
  const { taskSlug, threadId, prompt, agentType, worktreePath } = options;

  // Validate worktree path exists
  if (!worktreePath) {
    throw new Error("Worktree path is required to spawn agent");
  }

  const commandArgs = [
    runnerPath,
    "--agent", agentType,
    "--task-slug", taskSlug,
    "--thread-id", threadId,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--cwd", worktreePath, // Always explicit - no allocation
  ];

  // Spawn agent process...
}
```

### Remove allocation fallback

Delete any code that looks like:
```typescript
// DELETE THIS:
if (!worktreePath) {
  worktreePath = await worktreeAllocationService.allocate(repoName);
}
```

---

## Part D: Agent Runner Updates

### File: `agents/src/runners/task-runner-strategy.ts` (or equivalent)

Ensure runners receive and use the explicit `worktreePath`:

```typescript
// The runner should receive --cwd from spawn args
// No allocation logic should remain here

// DELETE any code like:
// const worktree = await this.allocationService.claim(threadId);

// The runner just uses process.cwd() or the provided cwd
const cwd = options.cwd; // Passed from spawn
```

### File: `agents/src/orchestration.ts`

Remove any remaining pool/allocation references:

```typescript
// DELETE imports like:
// import { WorktreePoolManager } from './worktree-pool-manager';
// import { WorktreeAllocationService } from './allocation-service';

// DELETE any initialization of these services
```

---

## Part E: Touch Worktree on Use

Update lastAccessedAt when task uses a worktree:

```typescript
// In task creation or agent spawn flow
await worktreeService.touch(repositoryName, worktreePath);
```

This ensures most-recently-used worktrees appear first in spotlight.

---

## Part F: Error Handling Updates

### File: `src/lib/agent-service.ts`

Remove `no_worktrees_available` error type - this scenario is now prevented by UI (spotlight won't allow task creation without a worktree selected):

```typescript
// DELETE:
// if (errorType === 'no_worktrees_available') {
//   // handle...
// }
```

### File: `src/components/spotlight/spotlight.tsx`

Remove handling for `no_worktrees_available` - the UI prevents this case:

```typescript
// DELETE error handling for this type
// Instead, spotlight should prevent task creation when no worktrees exist
```

---

## Verification Steps

1. Update task creation to require and store `worktreePath`
2. Update thread creation to store `worktreePath`
3. Update agent spawn to require explicit `--cwd`
4. Remove any allocation fallback logic
5. Add `worktreeService.touch()` call on task creation
6. Remove `no_worktrees_available` error handling
7. TypeScript compile: `pnpm tsc --noEmit`
8. Full build: `pnpm build`
9. End-to-end test:
   - Create worktree in Worktrees tab
   - Open spotlight, type task
   - Verify worktree shows in result
   - Create task
   - Verify task has `worktreePath` in metadata
   - Verify agent spawns with correct `--cwd`
   - Verify worktree `lastAccessedAt` updated

## Success Criteria
- Task creation requires `worktreePath` (no auto-allocation)
- Task and thread metadata store `worktreePath`
- Agent spawns with explicit `--cwd` matching selected worktree
- No references to `WorktreeAllocationService` or `WorktreePoolManager`
- No `no_worktrees_available` error handling remains
- `lastAccessedAt` updates when worktree is used
- Full task creation → agent spawn flow works end-to-end
