# Phase 3d: Thread Service

## Goal

Create a single-responsibility service for creating, reading, and updating thread metadata.

## Prerequisites

- [02a-fs-adapter.md](./02a-fs-adapter.md) complete

## Parallel With

- [03a-settings-service.md](./03a-settings-service.md)
- [03b-merge-base-service.md](./03b-merge-base-service.md)
- [03c-task-services.md](./03c-task-services.md)
- [03e-branch-service.md](./03e-branch-service.md)

## Files to Create

- `core/services/thread/thread-service.ts`
- `core/services/thread/thread-service.test.ts`

## Types

**IMPORTANT**: Import types from `src/entities/threads/types.ts` - these are the canonical definitions.

```typescript
// From src/entities/threads/types.ts

type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused";

type AgentType = "entrypoint" | "execution" | "review" | "merge" | "planning";

interface ThreadTurn {
  index: number;
  prompt: string;
  startedAt: number;
  completedAt: number | null;
  exitCode?: number;
  costUsd?: number;
}

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

interface CreateThreadInput {
  id?: string;
  taskId: string;
  agentType: string;
  workingDirectory: string;
  prompt: string;
  git?: {
    branch: string;
  };
}

interface UpdateThreadInput {
  status?: ThreadStatus;
  turns?: ThreadTurn[];
  git?: {
    branch: string;
    commitHash?: string;
  };
}
```

## Storage Path

**IMPORTANT**: Threads are stored at `~/.mort/tasks/{taskSlug}/threads/{agentType}-{id}/`

This matches the existing codebase structure where threads live inside their parent task directory.

## Implementation

```typescript
// core/services/thread/thread-service.ts
import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type {
  ThreadMetadata,
  CreateThreadInput,
  UpdateThreadInput,
  ThreadStatus,
  ThreadTurn,
} from '@/entities/threads/types';
import { getThreadFolderName } from '@/entities/threads/types';

export class ThreadService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  create(taskSlug: string, input: CreateThreadInput): ThreadMetadata {
    const id = input.id ?? this.generateId();
    const folderName = getThreadFolderName(input.agentType, id);
    const threadDir = this.getThreadDir(taskSlug, folderName);

    // Create thread directory
    this.fs.mkdir(threadDir, { recursive: true });

    // Create initial turn
    const now = Date.now();
    const initialTurn: ThreadTurn = {
      index: 0,
      prompt: input.prompt,
      startedAt: now,
      completedAt: null,
    };

    // Create metadata
    const metadata: ThreadMetadata = {
      id,
      taskId: input.taskId,
      agentType: input.agentType,
      workingDirectory: input.workingDirectory,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      git: input.git,
      turns: [initialTurn],
    };

    // Write metadata file
    this.writeMetadata(taskSlug, folderName, metadata);

    return metadata;
  }

  get(taskSlug: string, folderName: string): ThreadMetadata {
    const metadataPath = this.getMetadataPath(taskSlug, folderName);
    const content = this.fs.readFile(metadataPath);
    return JSON.parse(content);
  }

  update(taskSlug: string, folderName: string, updates: UpdateThreadInput): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
    const updated: ThreadMetadata = {
      ...metadata,
      ...updates,
      updatedAt: Date.now(),
    };

    this.writeMetadata(taskSlug, folderName, updated);
    return updated;
  }

  markCompleted(taskSlug: string, folderName: string, exitCode?: number): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
    const turns = [...metadata.turns];

    // Complete the current turn if any
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.completedAt === null) {
        turns[turns.length - 1] = {
          ...lastTurn,
          completedAt: Date.now(),
          exitCode,
        };
      }
    }

    return this.update(taskSlug, folderName, {
      status: 'completed',
      turns,
    });
  }

  markError(taskSlug: string, folderName: string, exitCode?: number): ThreadMetadata {
    const metadata = this.get(taskSlug, folderName);
    const turns = [...metadata.turns];

    // Complete the current turn if any
    if (turns.length > 0) {
      const lastTurn = turns[turns.length - 1];
      if (lastTurn.completedAt === null) {
        turns[turns.length - 1] = {
          ...lastTurn,
          completedAt: Date.now(),
          exitCode,
        };
      }
    }

    return this.update(taskSlug, folderName, {
      status: 'error',
      turns,
    });
  }

  exists(taskSlug: string, folderName: string): boolean {
    return this.fs.exists(this.getMetadataPath(taskSlug, folderName));
  }

  list(taskSlug: string): string[] {
    const threadsDir = path.join(this.mortDir, 'tasks', taskSlug, 'threads');
    if (!this.fs.exists(threadsDir)) {
      return [];
    }
    return this.fs.readDir(threadsDir).filter(name => {
      return this.exists(taskSlug, name);
    });
  }

  private getThreadDir(taskSlug: string, folderName: string): string {
    return path.join(this.mortDir, 'tasks', taskSlug, 'threads', folderName);
  }

  private getMetadataPath(taskSlug: string, folderName: string): string {
    return path.join(this.getThreadDir(taskSlug, folderName), 'metadata.json');
  }

  private writeMetadata(taskSlug: string, folderName: string, metadata: ThreadMetadata): void {
    const metadataPath = this.getMetadataPath(taskSlug, folderName);
    this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
```

## Tasks

1. Import ThreadMetadata types from `src/entities/threads/types.ts`
2. Implement ThreadService class
3. Include helper methods for common status transitions
4. Support list() to enumerate threads for a task
5. Write unit tests with mock FileSystemAdapter

## Test Cases

- Create thread with all required fields
- Create thread initializes first turn
- Get returns parsed metadata
- Update merges changes correctly and updates timestamp
- markCompleted sets status and completes current turn
- markError sets status and completes current turn
- exists returns correct boolean
- list returns all thread folder names for a task

## Key Design Decision

**Node creates threads, not frontend.**

- Frontend spawns Node with taskId + threadId (UUIDs only)
- Node allocates worktree first
- Node creates thread entity with workingDirectory and git info
- Node emits `thread:created` event
- Frontend receives event and creates thread in store

This ensures threads always have complete data from the start.

## Single Responsibility

This service ONLY:
- Creates thread metadata on disk
- Reads thread metadata
- Updates thread metadata
- Lists threads for a task

It does NOT:
- Allocate worktrees
- Manage task metadata
- Emit events

## Verification

- [ ] All tests pass
- [ ] No async/await used
- [ ] Service has single responsibility
- [ ] **Types imported from canonical source (src/entities/threads/types.ts)**
- [ ] **ThreadStatus uses correct enum values (idle|running|completed|error|paused)**
- [ ] **ThreadMetadata includes agentType, git, turns fields**
