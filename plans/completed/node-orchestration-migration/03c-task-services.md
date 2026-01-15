# Phase 3c: Task Services

## Goal

Create single-responsibility services for task draft creation and metadata management.

## Prerequisites

- [02a-fs-adapter.md](./02a-fs-adapter.md) complete

## Parallel With

- [03a-settings-service.md](./03a-settings-service.md)
- [03b-merge-base-service.md](./03b-merge-base-service.md)
- [03d-thread-service.md](./03d-thread-service.md)
- [03e-branch-service.md](./03e-branch-service.md)

## Files to Create

- `core/services/task/draft-service.ts`
- `core/services/task/metadata-service.ts`
- `core/services/task/task-service.test.ts`

## Types

**IMPORTANT**: Import types from `core/types/tasks.ts` - these are the canonical definitions.

```typescript
// From core/types/tasks.ts

type TaskStatus =
  | "draft"        // Created at spotlight, not yet committed
  | "backlog"      // Ideas, not yet prioritized
  | "todo"         // Prioritized, ready to work on
  | "in-progress"  // Agent actively working
  | "in-review"    // Work done, under review
  | "done"         // Merged and complete
  | "cancelled";   // Abandoned

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

interface PendingReview {
  markdown: string;
  defaultResponse: string;
  requestedAt: number;
  onApprove: string;
  onFeedback: string;
}

interface TaskMetadata {
  id: string;
  slug: string;
  title: string;
  description?: string;
  branchName: string;
  type: "work" | "investigate";
  subtasks: Subtask[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  tags: string[];
  sortOrder: number;
  repositoryName?: string;
  pendingReview: PendingReview | null;
  reviewApproved?: boolean;
  prUrl?: string;
}

interface CreateDraftOptions {
  id: string;
  repositoryName: string;
  title: string;
  type?: "work" | "investigate";
}
```

## TaskDraftService Implementation

```typescript
// core/services/task/draft-service.ts
import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { TaskMetadata, TaskStatus } from '@core/types/tasks';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export class TaskDraftService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  create(options: CreateDraftOptions): TaskMetadata {
    const slug = slugify(options.title);
    const taskDir = this.getTaskDir(slug);

    // Create task directory
    this.fs.mkdir(taskDir, { recursive: true });

    // Create metadata with all required fields
    const now = Date.now();
    const metadata: TaskMetadata = {
      id: options.id,
      slug,
      title: options.title,
      branchName: `task/${slug}`,
      type: options.type ?? "work",
      subtasks: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      parentId: null,
      tags: [],
      sortOrder: now,
      repositoryName: options.repositoryName,
      pendingReview: null,
    };

    // Write metadata file
    const metadataPath = path.join(taskDir, 'metadata.json');
    this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  private getTaskDir(slug: string): string {
    return path.join(this.mortDir, 'tasks', slug);
  }
}
```

## TaskMetadataService Implementation

```typescript
// core/services/task/metadata-service.ts
import * as path from 'path';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { TaskMetadata, UpdateTaskInput } from '@core/types/tasks';

export class TaskMetadataService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  get(taskSlug: string): TaskMetadata {
    const metadataPath = this.getMetadataPath(taskSlug);
    const content = this.fs.readFile(metadataPath);
    return JSON.parse(content);
  }

  update(taskSlug: string, updates: UpdateTaskInput): TaskMetadata {
    const metadata = this.get(taskSlug);
    const updated: TaskMetadata = {
      ...metadata,
      ...updates,
      updatedAt: Date.now(),
    };

    const metadataPath = this.getMetadataPath(taskSlug);
    this.fs.writeFile(metadataPath, JSON.stringify(updated, null, 2));

    return updated;
  }

  exists(taskSlug: string): boolean {
    return this.fs.exists(this.getMetadataPath(taskSlug));
  }

  list(): string[] {
    const tasksDir = path.join(this.mortDir, 'tasks');
    if (!this.fs.exists(tasksDir)) {
      return [];
    }
    return this.fs.readDir(tasksDir).filter(name => {
      return this.exists(name);
    });
  }

  private getMetadataPath(taskSlug: string): string {
    return path.join(this.mortDir, 'tasks', taskSlug, 'metadata.json');
  }
}
```

## Tasks

1. Import TaskMetadata types from `core/types/tasks.ts`
2. Implement TaskDraftService (create only)
3. Implement TaskMetadataService (get/update/exists/list)
4. Write unit tests with mock FileSystemAdapter

## Test Cases

### TaskDraftService
- Create draft creates directory and metadata file
- Metadata has correct initial values
- status is 'draft'
- slug is generated from title
- branchName follows task/{slug} pattern

### TaskMetadataService
- Get returns parsed metadata
- Update merges changes and updates timestamp
- exists returns correct boolean
- list returns all task slugs

## Single Responsibility

TaskDraftService ONLY:
- Creates new draft tasks

TaskMetadataService ONLY:
- Reads task metadata
- Updates task metadata
- Lists tasks

Neither service:
- Manages threads
- Handles worktrees
- Validates repository existence

## Verification

- [ ] All tests pass
- [ ] No async/await used
- [ ] Each service has single responsibility
- [ ] **Types imported from canonical source (core/types/tasks.ts)**
- [ ] **TaskStatus uses correct enum values (draft|backlog|todo|in-progress|in-review|done|cancelled)**
