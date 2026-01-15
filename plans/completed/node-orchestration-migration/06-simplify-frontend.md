# Phase 6: Simplify Frontend

## Goal

Remove orchestration logic from the frontend now that Node handles worktree allocation and thread creation.

## Prerequisites

- [05-wire-up-runner.md](./05-wire-up-runner.md) complete

## Files to Modify

- `src/components/spotlight/spotlight.tsx`
- `src/lib/agent-service.ts`
- `src/lib/thread-store.ts` (or equivalent)

## Current Frontend Flow (Remove)

```
Spotlight
    ├── 1. taskService.createDraft()
    ├── 2. crypto.randomUUID() → threadId
    ├── 3. openTask()
    ├── 4. worktreeService.allocateRoutingWorktree() ← REMOVE
    ├── 5. prepareAgent() with --cwd, --merge-base  ← SIMPLIFY
    ├── 6. spawn()
    └── 7. Forward events
```

## New Frontend Flow

```
Spotlight
    ├── 1. crypto.randomUUID() → taskId + threadId
    ├── 2. taskService.createDraft()
    ├── 3. openTask() (no thread yet)
    ├── 4. spawn Node with (taskId, threadId, prompt, mortDir)
    └── 5. Handle events (thread:created, agent:state, etc.)
```

## Changes to spotlight.tsx

### Before
```typescript
// Old flow with frontend orchestration
const threadId = crypto.randomUUID();
const taskId = await taskService.createDraft(...);

// Frontend allocates worktree - REMOVE THIS
const allocation = await worktreeService.allocateRoutingWorktree(repoName, threadId);

// Frontend creates thread entity - REMOVE THIS
await threadService.create({
  id: threadId,
  workingDirectory: allocation.worktreePath,
  mergeBase: allocation.mergeBase,
});

// Frontend passes cwd and mergeBase - SIMPLIFY
const command = await prepareAgent({
  cwd: allocation.worktreePath,
  mergeBase: allocation.mergeBase,
  // ...
});
```

### After
```typescript
// New flow - Node does orchestration
const taskId = crypto.randomUUID();
const threadId = crypto.randomUUID();

// Create task draft on disk (Node reads this)
await taskService.createDraft({
  id: taskId,
  repositoryName: repoName,
  title: prompt.slice(0, 50),
});

// Open task window immediately (optimistic UI)
openTask(taskId);

// Spawn Node - it will allocate worktree and create thread
const command = await prepareAgent({
  agent: 'planning',
  taskId,
  threadId,
  prompt,
  mortDir: getMortDir(),
  // NO cwd, NO mergeBase - Node computes these
});

spawn(command);
```

## Changes to agent-service.ts

### prepareAgent Updates

```typescript
interface PrepareAgentArgs {
  agent: string;
  taskId: string;
  threadId: string;
  prompt: string;
  mortDir: string;
  // REMOVED: cwd, mergeBase
}

function prepareAgent(args: PrepareAgentArgs): string[] {
  return [
    'node',
    '/path/to/runner.js',
    '--agent', args.agent,
    '--task-id', args.taskId,
    '--thread-id', args.threadId,
    '--prompt', args.prompt,
    '--mort-dir', args.mortDir,
    // REMOVED: --cwd, --merge-base
  ];
}
```

## New Event Handlers

Add handlers for new events from Node:

```typescript
function handleAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case 'thread:created':
      // Node created the thread - add to store
      threadStore.add(event.thread);
      break;

    case 'worktree:allocated':
      // Log for debugging, no action needed
      console.log('Worktree allocated:', event.allocation);
      break;

    case 'worktree:released':
      // Log for debugging, no action needed
      console.log('Worktree released:', event.threadId);
      break;

    case 'agent:state':
      // Existing handler
      threadStore.updateState(event.threadId, event.state);
      break;
  }
}
```

## Files to Delete

After migration is complete:
- `src/lib/workspace-service.ts` - All logic moved to Node

## Tasks

1. Remove worktree allocation from spotlight
2. Remove thread creation from spotlight (Node does this)
3. Simplify prepareAgent arguments
4. Add event handlers for `thread:created`, `worktree:allocated`, `worktree:released`
5. Update thread store to handle events from Node
6. Remove workspace-service.ts imports
7. Test full flow end-to-end

## Test Cases

- Spotlight spawns Node with minimal args
- Task draft exists on disk before Node starts
- UI shows task window immediately (optimistic)
- Thread appears in store when `thread:created` event received
- Agent messages display correctly
- Thread marked complete when agent finishes

## Verification

- [ ] No Tauri calls for worktree operations in spotlight
- [ ] No thread creation in frontend
- [ ] Events from Node handled correctly
- [ ] Full flow works end-to-end
- [ ] workspace-service.ts deleted or unused
