# Phase 5: Wire Up Node Runner

## Goal

Integrate the orchestration services into the Node runner, enabling worktree allocation without frontend involvement.

## Prerequisites

- [04-worktree-allocation.md](./04-worktree-allocation.md) complete
- [03c-task-services.md](./03c-task-services.md) complete
- [03d-thread-service.md](./03d-thread-service.md) complete

## Files to Modify/Create

- `agents/src/runner.ts` - Modify argument parsing
- `agents/src/orchestration.ts` - New orchestration module

## New Runner Arguments

```
--agent         Agent type (planning, execution, etc.)
--prompt        User's query
--anvil-dir      Data directory (~/.anvil)
--task-slug     Task slug - task must exist on disk
--thread-id     UUID - Node will create the thread entity
```

**Removed arguments:**
- `--cwd` - Node allocates worktree and sets cwd
- `--merge-base` - Node computes from allocated worktree
- `--repo-name` - Node reads repositoryName from task metadata

## Types

**IMPORTANT**: Use canonical types from the entities/types modules.

```typescript
// From src/entities/threads/types.ts
interface ThreadMetadata {
  id: string;
  taskId: string;
  agentType: string;
  workingDirectory: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  ttlMs?: number;
  git?: {
    branch: string;
    commitHash?: string;
  };
  turns: ThreadTurn[];
}

// From src/entities/repositories/types.ts
interface WorktreeState {
  path: string;
  version: number;
  currentBranch: string | null;
  claim: WorktreeClaim | null;
}
```

## Orchestration Module

```typescript
// agents/src/orchestration.ts
import { NodeFileSystemAdapter } from '@core/adapters/node/fs-adapter';
import { NodeGitAdapter } from '@core/adapters/node/git-adapter';
import { NodePathLock } from '@core/adapters/node/path-lock';
import { RepositorySettingsService } from '@core/services/repository/settings-service';
import { MergeBaseService } from '@core/services/git/merge-base-service';
import { TaskMetadataService } from '@core/services/task/metadata-service';
import { ThreadService } from '@core/services/thread/thread-service';
import { WorktreeAllocationService } from '@core/services/worktree/allocation-service';
import { getThreadFolderName } from '@/entities/threads/types';

interface RunnerArgs {
  agent: string;
  prompt: string;
  anvilDir: string;
  taskSlug: string;
  threadId: string;
}

interface OrchestrationResult {
  taskSlug: string;
  threadId: string;
  threadFolderName: string;
  cwd: string;
  mergeBase: string;
  repoName: string;
  branch: string;
}

export function orchestrate(args: RunnerArgs): OrchestrationResult {
  // Create adapters (all sync)
  const fs = new NodeFileSystemAdapter();
  const git = new NodeGitAdapter();
  const pathLock = new NodePathLock();

  // Create services
  const settingsService = new RepositorySettingsService(args.anvilDir, fs);
  const mergeBaseService = new MergeBaseService(git);
  const taskMetadataService = new TaskMetadataService(args.anvilDir, fs);
  const threadService = new ThreadService(args.anvilDir, fs);
  const allocationService = new WorktreeAllocationService(
    args.anvilDir,
    settingsService,
    mergeBaseService,
    git,
    pathLock
  );

  // Read task metadata - frontend already created draft on disk
  const taskMeta = taskMetadataService.get(args.taskSlug);
  const repoName = taskMeta.repositoryName;

  if (!repoName) {
    throw new Error(`Task ${args.taskSlug} has no repositoryName`);
  }

  // Allocate worktree
  const allocation = allocationService.allocate(repoName, args.threadId);
  emitEvent({
    type: 'worktree:allocated',
    worktree: allocation.worktree,
    mergeBase: allocation.mergeBase,
  });

  // Create thread entity on disk
  const thread = threadService.create(args.taskSlug, {
    id: args.threadId,
    taskId: taskMeta.id,
    agentType: args.agent,
    workingDirectory: allocation.worktree.path,
    prompt: args.prompt,
    git: {
      branch: taskMeta.branchName,
    },
  });
  emitEvent({ type: 'thread:created', thread });

  const threadFolderName = getThreadFolderName(args.agent, args.threadId);

  return {
    taskSlug: args.taskSlug,
    threadId: args.threadId,
    threadFolderName,
    cwd: allocation.worktree.path,
    mergeBase: allocation.mergeBase,
    repoName,
    branch: taskMeta.branchName,
  };
}

export function setupCleanup(
  anvilDir: string,
  repoName: string,
  threadId: string
): void {
  const cleanup = () => {
    try {
      const fs = new NodeFileSystemAdapter();
      const git = new NodeGitAdapter();
      const pathLock = new NodePathLock();
      const settingsService = new RepositorySettingsService(anvilDir, fs);
      const mergeBaseService = new MergeBaseService(git);
      const allocationService = new WorktreeAllocationService(
        anvilDir,
        settingsService,
        mergeBaseService,
        git,
        pathLock
      );

      allocationService.release(repoName, threadId);
      emitEvent({ type: 'worktree:released', threadId });
    } catch {
      // Ignore cleanup errors
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function emitEvent(event: object): void {
  console.log(JSON.stringify(event));
}
```

## Runner Integration

```typescript
// agents/src/runner.ts (simplified)
import { orchestrate, setupCleanup } from './orchestration';

const args = parseArgs(process.argv);

// Orchestrate - allocates worktree, creates thread
const result = orchestrate({
  agent: args.agent,
  prompt: args.prompt,
  anvilDir: args.anvilDir,
  taskSlug: args.taskSlug,
  threadId: args.threadId,
});

// Setup cleanup handlers
setupCleanup(args.anvilDir, result.repoName, args.threadId);

// Run agent with orchestrated cwd and merge base
runAgent({
  ...args,
  cwd: result.cwd,
  mergeBase: result.mergeBase,
});
```

## Tasks

1. Create `agents/src/orchestration.ts` module
2. Modify `agents/src/runner.ts` argument parsing
3. Remove `--cwd`, `--merge-base` from required args
4. Integrate orchestration before agent runs
5. Setup cleanup handlers for graceful shutdown
6. Write integration tests

## New Event Types

```typescript
// Events use canonical types from entities

interface WorktreeAllocatedEvent {
  type: 'worktree:allocated';
  worktree: WorktreeState;  // From src/entities/repositories/types.ts
  mergeBase: string;
}

interface ThreadCreatedEvent {
  type: 'thread:created';
  thread: ThreadMetadata;  // From src/entities/threads/types.ts
}

interface WorktreeReleasedEvent {
  type: 'worktree:released';
  threadId: string;
}
```

## Test Cases

- Runner starts with minimal args (taskSlug, threadId, prompt)
- Orchestration reads task metadata from disk
- Worktree is allocated and checked out
- Thread entity is created on disk with correct fields (agentType, git, turns)
- Events are emitted to stdout with correct structure
- Cleanup releases worktree on exit
- Cleanup handles SIGINT/SIGTERM

## Usage Example

```bash
# Frontend creates task draft, then spawns:
node runner.js \
  --agent planning \
  --task-slug fix-login-bug \
  --thread-id def-456 \
  --prompt "Fix the login bug" \
  --anvil-dir ~/.anvil
```

## Verification

- [ ] Runner works with new argument format
- [ ] Orchestration allocates worktree successfully
- [ ] Thread created on disk with workingDirectory, agentType, git.branch, and turns[]
- [ ] Events emitted with correct ThreadMetadata structure
- [ ] Cleanup works on normal exit and signals
- [ ] **Uses canonical types from src/entities/threads/types.ts**
