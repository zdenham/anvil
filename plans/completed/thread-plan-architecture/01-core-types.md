# 01: Core Type Definitions

**Dependencies:** None
**Can run parallel with:** 03-delete-tasks.md

## Goal

Define the new TypeScript types for the Thread + Plan architecture. All persisted types use Zod schemas with derived TypeScript types per project patterns.

## Migration Note

**No migration is needed.** All users will have a fresh start by deleting their `.anvil` directory. This simplifies the implementation - we don't need to handle existing settings files that lack the new required `id` fields.

## Tasks

### 1. Update ThreadMetadata schema

Update `core/types/threads.ts` to modify the existing `ThreadMetadataBaseSchema`:

```typescript
import { z } from 'zod';

export const ThreadTurnSchema = z.object({
  index: z.number(),
  prompt: z.string(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  exitCode: z.number().optional(),
  costUsd: z.number().optional(),
});

export const ThreadMetadataBaseSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),           // Repository this thread belongs to
  worktreeId: z.string().uuid(),       // Required - main repo is also a worktree
  status: z.enum(["idle", "running", "completed", "error", "paused", "cancelled"]),
  turns: z.array(ThreadTurnSchema),
  git: z.object({
    branch: z.string(),
    initialCommitHash: z.string().optional(),
    commitHash: z.string().optional(),
  }).optional(),
  changedFilePaths: z.array(z.string()).optional(),
  isRead: z.boolean().optional(),
  pid: z.number().nullable().optional(),
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
});

export const ThreadMetadataSchema = ThreadMetadataBaseSchema.transform((data) => ({
  ...data,
  isRead: data.isRead ?? true,
}));

export type ThreadTurn = z.infer<typeof ThreadTurnSchema>;
export type ThreadMetadata = z.infer<typeof ThreadMetadataSchema>;
export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused" | "cancelled";
```

**Fields removed from ThreadMetadata:**
- `taskId` - Tasks are being removed; threads are now top-level
- `agentType` - No longer needed; all threads use the same agent
- `workingDirectory` - Derived from worktreeId lookup
- `worktreePath` - Replaced by worktreeId
- `planId` - Thread-plan relationships stored in relations table only (Decision 1)
- `ttlMs` - No longer used
- `sessionId` - Moved to ThreadState (agent runtime only)

**Fields kept:**
- `changedFilePaths` - Still needed for diff generation
- Full `ThreadStatus` enum - Kept for backwards compatibility

**Thread folder naming:** Thread folders are stored at `~/.anvil/threads/{threadId}/`. The folder name is simply the thread's UUID - no timestamp or convention needed. Any utilities like `getThreadFolderName`/`parseThreadFolderName` should be updated to just use the thread ID directly.

### 2. Update PlanMetadata schema

Update `core/types/plans.ts` to use structured paths instead of absolutePath (Decision 2):

```typescript
import { z } from 'zod';

export const PlanMetadataSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  worktreeId: z.string().uuid(),       // Required - main repo is also a worktree
  relativePath: z.string(),            // Path relative to repo's plans directory
  parentId: z.string().uuid().optional(), // For nested plans
  isRead: z.boolean().default(false),
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
});

export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

export interface CreatePlanInput {
  repoId: string;
  worktreeId: string;
  relativePath: string;
  parentId?: string;
}

export interface UpdatePlanInput {
  isRead?: boolean;
  parentId?: string;
}
```

**Fields removed (Decision 3):**
- `absolutePath` - Replaced by `repoId + worktreeId + relativePath`
- No `status` field - Status derived from associated threads
- No `title` field - Use `relativePath` for display

### 3. Create relation types

Create new file `core/types/relations.ts`:

```typescript
import { z } from 'zod';

export const RelationTypeSchema = z.enum(['created', 'modified', 'mentioned']);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const PlanThreadRelationSchema = z.object({
  planId: z.string().uuid(),
  threadId: z.string().uuid(),
  type: RelationTypeSchema,
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
});

export type PlanThreadRelation = z.infer<typeof PlanThreadRelationSchema>;

export interface CreateRelationInput {
  planId: string;
  threadId: string;
  type: RelationType;
}

export interface UpdateRelationInput {
  type?: RelationType;
}
```

**Relation types (with precedence: created > modified > mentioned):**
- `created` - Thread created this plan file
- `modified` - Thread modified this plan file
- `mentioned` - Thread referenced this plan (in user message or context)

**Precedence enforcement:** Automatic resolution. When displaying or querying relations, sort by precedence and use the highest. Higher precedence silently wins. No errors needed since having multiple relation types is valid (a thread can be both explicitly linked AND detected). The precedence just determines which to show in limited-space UIs.

```typescript
// Add precedence helper to core/types/relations.ts
export const RELATION_TYPE_PRECEDENCE: Record<RelationType, number> = {
  mentioned: 1,
  modified: 2,
  created: 3,
};

/**
 * Get the highest-precedence relation type from a list.
 * Used when displaying a single relation type for a thread-plan pair.
 */
export function getHighestPrecedenceType(types: RelationType[]): RelationType {
  return types.sort((a, b) =>
    RELATION_TYPE_PRECEDENCE[b] - RELATION_TYPE_PRECEDENCE[a]
  )[0];
}
```

**Storage:** `~/.anvil/plan-thread-edges/{planId}-{threadId}.json`

### 4. Extend RepositorySettings for plans

Update `core/types/repositories.ts` to add plan directory configuration to the existing schema:

```typescript
// Add id field to WorktreeStateSchema
export const WorktreeStateSchema = z.object({
  id: z.string().uuid(),               // Add UUID for worktree identification
  path: z.string(),
  name: z.string(),
  lastAccessedAt: z.number().optional(),
  currentBranch: z.string().nullable().optional(),
});

// Extend RepositorySettingsSchema with plan directories
export const RepositorySettingsSchema = z.object({
  id: z.string().uuid(),               // Add UUID for repository (Decision 11)
  schemaVersion: z.literal(1),
  name: z.string(),
  originalUrl: z.string().nullable(),
  sourcePath: z.string(),
  useWorktrees: z.boolean(),
  defaultBranch: z.string().default('main'),
  createdAt: z.number(),
  worktrees: z.array(WorktreeStateSchema).default([]),
  taskBranches: z.record(z.string(), TaskBranchInfoSchema),
  lastUpdated: z.number(),
  // New fields for plan management
  plansDirectory: z.string().default('plans/'),
  completedDirectory: z.string().default('plans/completed/'),
});
```

**Note:** Extending `RepositorySettings` rather than creating a separate `RepositoryConfig` type to avoid duplicate repository configuration types.

### 5. Update events

Update `core/types/events.ts`:

```typescript
export const EventName = {
  // Task events - REMOVE these:
  // TASK_CREATED, TASK_UPDATED, TASK_DELETED, TASK_STATUS_CHANGED, TASK_MARKED_UNREAD

  // Thread events - already exist, add new ones
  THREAD_CREATED: "thread:created",
  THREAD_UPDATED: "thread:updated",
  THREAD_STATUS_CHANGED: "thread:status-changed",
  THREAD_ARCHIVED: "thread:archived",              // NEW
  THREAD_FILE_CREATED: "thread:file-created",      // NEW - emitted by agent runner
  THREAD_FILE_MODIFIED: "thread:file-modified",    // NEW - emitted by agent runner

  // Plan events - add these (PLAN_DETECTED already exists, keep it)
  PLAN_DETECTED: "plan:detected",
  PLAN_CREATED: "plan:created",                    // NEW
  PLAN_UPDATED: "plan:updated",                    // NEW
  PLAN_ARCHIVED: "plan:archived",                  // NEW (no PLAN_DELETED)

  // Relation events - add these
  RELATION_CREATED: "relation:created",            // NEW
  RELATION_UPDATED: "relation:updated",            // NEW

  // User events
  USER_MESSAGE_SENT: "user:message-sent",          // NEW - emitted by agent runner

  // ... keep all other existing events (AGENT_*, WORKTREE_*, REPOSITORY_*, etc.)
} as const;
```

**Event payloads to add:**

```typescript
export interface EventPayloads {
  // Thread events - update existing, add new
  [EventName.THREAD_CREATED]: { threadId: string; repoId: string; worktreeId: string };
  [EventName.THREAD_UPDATED]: { threadId: string };
  [EventName.THREAD_STATUS_CHANGED]: { threadId: string; status: ThreadStatus };
  [EventName.THREAD_ARCHIVED]: { threadId: string };
  [EventName.THREAD_FILE_CREATED]: { threadId: string; filePath: string };
  [EventName.THREAD_FILE_MODIFIED]: { threadId: string; filePath: string };

  // Plan events
  [EventName.PLAN_DETECTED]: { planId: string };
  [EventName.PLAN_CREATED]: { planId: string; repoId: string };
  [EventName.PLAN_UPDATED]: { planId: string };
  [EventName.PLAN_ARCHIVED]: { planId: string };

  // Relation events
  [EventName.RELATION_CREATED]: { planId: string; threadId: string; type: RelationType };
  [EventName.RELATION_UPDATED]: { planId: string; threadId: string; type: RelationType };

  // User events
  [EventName.USER_MESSAGE_SENT]: { threadId: string; message: string };

  // ... keep all other existing payloads
}
```

### 6. Update CreateThreadInput and UpdateThreadInput

Update `core/types/threads.ts`:

```typescript
export interface CreateThreadInput {
  id?: string;                         // Optional pre-generated ID
  repoId: string;                      // Required
  worktreeId: string;                  // Required (Decision 12)
  prompt: string;
  git?: {
    branch: string;
  };
}

export interface UpdateThreadInput {
  status?: ThreadStatus;
  turns?: ThreadTurn[];
  git?: {
    branch: string;
    initialCommitHash?: string;
    commitHash?: string;
  };
  isRead?: boolean;
  pid?: number | null;
  changedFilePaths?: string[];
}
```

**Removed from CreateThreadInput:**
- `taskId` - Tasks removed
- `agentType` - No longer needed
- `workingDirectory` - Derived from worktreeId
- `worktreePath` - Replaced by worktreeId

**Removed from UpdateThreadInput:**
- `worktreePath` - Immutable after creation
- `planId` - Use relations table instead (Decision 1)

### 7. Update index exports

Update `core/types/index.ts`:

```typescript
// Remove task exports
// export * from './tasks.js';  // DELETE this line

// Keep existing exports
export * from './threads.js';
export * from './repositories.js';
export * from './events.js';
export * from './plans.js';

// Add new export
export * from './relations.js';
```

## Breaking Changes

This plan introduces breaking changes that will cause TypeScript errors in consuming code:

1. **ThreadMetadata** - Removed `taskId`, `agentType`, `workingDirectory`, `worktreePath`, `planId`, `ttlMs`, `sessionId`; Added `repoId`, `worktreeId`
2. **PlanMetadata** - Removed `absolutePath`; Added `repoId`, `worktreeId`, `relativePath`, `parentId`
3. **WorktreeState** - Added required `id` field
4. **RepositorySettings** - Added `id`, `plansDirectory`, `completedDirectory` fields
5. **CreateThreadInput** - Removed `taskId`, `agentType`, `workingDirectory`, `worktreePath`; Added `repoId`, `worktreeId`
6. **Events** - Removed all TASK_* events; Added new thread/plan/relation events

These errors are expected and will be resolved by subsequent plans (04-thread-refactor.md, 05-plan-entity.md, etc.).

## Acceptance Criteria

- [ ] ThreadMetadataSchema updated with repoId, worktreeId; without taskId, agentType, workingDirectory, planId
- [ ] PlanMetadataSchema updated with repoId, worktreeId, relativePath, parentId; without absolutePath
- [ ] PlanThreadRelationSchema created in new `core/types/relations.ts`
- [ ] WorktreeStateSchema has id field
- [ ] RepositorySettingsSchema has id, plansDirectory, completedDirectory fields
- [ ] Task events removed from EventName
- [ ] New events added: THREAD_ARCHIVED, THREAD_FILE_CREATED, THREAD_FILE_MODIFIED, PLAN_CREATED, PLAN_UPDATED, PLAN_ARCHIVED, RELATION_CREATED, RELATION_UPDATED, USER_MESSAGE_SENT
- [ ] CreateThreadInput and UpdateThreadInput updated
- [ ] `core/types/index.ts` exports relations.ts
- [ ] All types use Zod schemas with `z.infer<>` derived types
- [ ] All timestamps are `z.number()` (Unix milliseconds)
- [ ] TypeScript compiles (consuming code errors expected)

## Programmatic Testing Plan

Create a test file at `core/types/__tests__/thread-plan-types.test.ts`. All tests must pass before this plan is considered complete.

### 1. ThreadTurnSchema Validation Tests

```typescript
describe('ThreadTurnSchema', () => {
  it('should accept valid ThreadTurn with all fields', () => {
    const validTurn = {
      index: 0,
      prompt: 'Test prompt',
      startedAt: Date.now(),
      completedAt: Date.now(),
      exitCode: 0,
      costUsd: 0.05,
    };
    expect(() => ThreadTurnSchema.parse(validTurn)).not.toThrow();
  });

  it('should accept ThreadTurn with null completedAt', () => {
    const turn = {
      index: 1,
      prompt: 'In progress',
      startedAt: Date.now(),
      completedAt: null,
    };
    expect(() => ThreadTurnSchema.parse(turn)).not.toThrow();
  });

  it('should accept ThreadTurn without optional exitCode and costUsd', () => {
    const turn = {
      index: 0,
      prompt: 'Test',
      startedAt: Date.now(),
      completedAt: Date.now(),
    };
    const parsed = ThreadTurnSchema.parse(turn);
    expect(parsed.exitCode).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });

  it('should reject ThreadTurn with missing required fields', () => {
    expect(() => ThreadTurnSchema.parse({ index: 0 })).toThrow();
    expect(() => ThreadTurnSchema.parse({ prompt: 'test' })).toThrow();
  });

  it('should reject ThreadTurn with invalid types', () => {
    expect(() => ThreadTurnSchema.parse({
      index: 'zero',
      prompt: 'test',
      startedAt: Date.now(),
      completedAt: null,
    })).toThrow();
  });
});
```

### 2. ThreadMetadataSchema Validation Tests

```typescript
describe('ThreadMetadataSchema', () => {
  const validThread = {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    status: 'idle' as const,
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid ThreadMetadata with required fields only', () => {
    expect(() => ThreadMetadataSchema.parse(validThread)).not.toThrow();
  });

  it('should accept all valid status values', () => {
    const statuses = ['idle', 'running', 'completed', 'error', 'paused', 'cancelled'];
    statuses.forEach(status => {
      expect(() => ThreadMetadataSchema.parse({ ...validThread, status })).not.toThrow();
    });
  });

  it('should reject invalid status values', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, status: 'invalid' })).toThrow();
  });

  it('should accept ThreadMetadata with git info', () => {
    const withGit = {
      ...validThread,
      git: {
        branch: 'feature/test',
        initialCommitHash: 'abc123',
        commitHash: 'def456',
      },
    };
    expect(() => ThreadMetadataSchema.parse(withGit)).not.toThrow();
  });

  it('should default isRead to true via transform', () => {
    const parsed = ThreadMetadataSchema.parse(validThread);
    expect(parsed.isRead).toBe(true);
  });

  it('should preserve explicit isRead value', () => {
    const parsed = ThreadMetadataSchema.parse({ ...validThread, isRead: false });
    expect(parsed.isRead).toBe(false);
  });

  it('should require valid UUIDs for id, repoId, worktreeId', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, id: 'not-a-uuid' })).toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, repoId: 'not-a-uuid' })).toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, worktreeId: 'not-a-uuid' })).toThrow();
  });

  it('should accept optional changedFilePaths array', () => {
    const withFiles = { ...validThread, changedFilePaths: ['src/foo.ts', 'src/bar.ts'] };
    const parsed = ThreadMetadataSchema.parse(withFiles);
    expect(parsed.changedFilePaths).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('should accept optional pid as number or null', () => {
    expect(() => ThreadMetadataSchema.parse({ ...validThread, pid: 12345 })).not.toThrow();
    expect(() => ThreadMetadataSchema.parse({ ...validThread, pid: null })).not.toThrow();
  });
});
```

### 3. PlanMetadataSchema Validation Tests

```typescript
describe('PlanMetadataSchema', () => {
  const validPlan = {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    relativePath: 'feature/add-auth.md',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid PlanMetadata with required fields', () => {
    expect(() => PlanMetadataSchema.parse(validPlan)).not.toThrow();
  });

  it('should default isRead to false', () => {
    const parsed = PlanMetadataSchema.parse(validPlan);
    expect(parsed.isRead).toBe(false);
  });

  it('should accept optional parentId as valid UUID', () => {
    const nested = { ...validPlan, parentId: crypto.randomUUID() };
    expect(() => PlanMetadataSchema.parse(nested)).not.toThrow();
  });

  it('should reject invalid parentId', () => {
    expect(() => PlanMetadataSchema.parse({ ...validPlan, parentId: 'invalid' })).toThrow();
  });

  it('should require valid UUIDs for id, repoId, worktreeId', () => {
    expect(() => PlanMetadataSchema.parse({ ...validPlan, id: 'bad' })).toThrow();
    expect(() => PlanMetadataSchema.parse({ ...validPlan, repoId: 'bad' })).toThrow();
    expect(() => PlanMetadataSchema.parse({ ...validPlan, worktreeId: 'bad' })).toThrow();
  });

  it('should require relativePath as string', () => {
    expect(() => PlanMetadataSchema.parse({ ...validPlan, relativePath: undefined })).toThrow();
  });
});
```

### 4. PlanThreadRelationSchema Validation Tests

```typescript
describe('PlanThreadRelationSchema', () => {
  const validRelation = {
    planId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    type: 'created' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('should accept valid relation with all fields', () => {
    expect(() => PlanThreadRelationSchema.parse(validRelation)).not.toThrow();
  });

  it('should accept all valid relation types', () => {
    const types = ['created', 'modified', 'mentioned'];
    types.forEach(type => {
      expect(() => PlanThreadRelationSchema.parse({ ...validRelation, type })).not.toThrow();
    });
  });

  it('should reject invalid relation type', () => {
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, type: 'invalid' })).toThrow();
  });

  it('should require valid UUIDs for planId and threadId', () => {
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, planId: 'bad' })).toThrow();
    expect(() => PlanThreadRelationSchema.parse({ ...validRelation, threadId: 'bad' })).toThrow();
  });
});
```

### 5. RelationTypeSchema Validation Tests

```typescript
describe('RelationTypeSchema', () => {
  it('should accept "created"', () => {
    expect(RelationTypeSchema.parse('created')).toBe('created');
  });

  it('should accept "modified"', () => {
    expect(RelationTypeSchema.parse('modified')).toBe('modified');
  });

  it('should accept "mentioned"', () => {
    expect(RelationTypeSchema.parse('mentioned')).toBe('mentioned');
  });

  it('should reject invalid values', () => {
    expect(() => RelationTypeSchema.parse('referenced')).toThrow();
    expect(() => RelationTypeSchema.parse('')).toThrow();
  });
});
```

### 6. WorktreeStateSchema Validation Tests

```typescript
describe('WorktreeStateSchema', () => {
  it('should require id field as valid UUID', () => {
    const worktree = {
      id: crypto.randomUUID(),
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).not.toThrow();
  });

  it('should reject worktree without id', () => {
    const worktree = {
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).toThrow();
  });

  it('should reject worktree with invalid id', () => {
    const worktree = {
      id: 'not-a-uuid',
      path: '/path/to/worktree',
      name: 'feature-branch',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).toThrow();
  });

  it('should accept optional lastAccessedAt and currentBranch', () => {
    const worktree = {
      id: crypto.randomUUID(),
      path: '/path/to/worktree',
      name: 'feature-branch',
      lastAccessedAt: Date.now(),
      currentBranch: 'main',
    };
    expect(() => WorktreeStateSchema.parse(worktree)).not.toThrow();
  });
});
```

### 7. RepositorySettingsSchema Validation Tests

```typescript
describe('RepositorySettingsSchema', () => {
  const validRepo = {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    name: 'test-repo',
    originalUrl: 'https://github.com/test/repo',
    sourcePath: '/path/to/repo',
    useWorktrees: true,
    createdAt: Date.now(),
    taskBranches: {},
    lastUpdated: Date.now(),
  };

  it('should require id field as valid UUID', () => {
    expect(() => RepositorySettingsSchema.parse(validRepo)).not.toThrow();
  });

  it('should reject repository without id', () => {
    const { id, ...noId } = validRepo;
    expect(() => RepositorySettingsSchema.parse(noId)).toThrow();
  });

  it('should default plansDirectory to "plans/"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.plansDirectory).toBe('plans/');
  });

  it('should default completedDirectory to "plans/completed/"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.completedDirectory).toBe('plans/completed/');
  });

  it('should allow custom plansDirectory and completedDirectory', () => {
    const custom = {
      ...validRepo,
      plansDirectory: 'docs/plans/',
      completedDirectory: 'docs/done/',
    };
    const parsed = RepositorySettingsSchema.parse(custom);
    expect(parsed.plansDirectory).toBe('docs/plans/');
    expect(parsed.completedDirectory).toBe('docs/done/');
  });

  it('should default defaultBranch to "main"', () => {
    const parsed = RepositorySettingsSchema.parse(validRepo);
    expect(parsed.defaultBranch).toBe('main');
  });
});
```

### 8. EventName and EventPayloads Tests

```typescript
describe('EventName', () => {
  it('should not include any TASK_* events', () => {
    const eventNames = Object.keys(EventName);
    const taskEvents = eventNames.filter(name => name.startsWith('TASK_'));
    expect(taskEvents).toEqual([]);
  });

  it('should include THREAD_ARCHIVED event', () => {
    expect(EventName.THREAD_ARCHIVED).toBe('thread:archived');
  });

  it('should include THREAD_FILE_CREATED event', () => {
    expect(EventName.THREAD_FILE_CREATED).toBe('thread:file-created');
  });

  it('should include THREAD_FILE_MODIFIED event', () => {
    expect(EventName.THREAD_FILE_MODIFIED).toBe('thread:file-modified');
  });

  it('should include PLAN_CREATED event', () => {
    expect(EventName.PLAN_CREATED).toBe('plan:created');
  });

  it('should include PLAN_UPDATED event', () => {
    expect(EventName.PLAN_UPDATED).toBe('plan:updated');
  });

  it('should include PLAN_ARCHIVED event', () => {
    expect(EventName.PLAN_ARCHIVED).toBe('plan:archived');
  });

  it('should include RELATION_CREATED event', () => {
    expect(EventName.RELATION_CREATED).toBe('relation:created');
  });

  it('should include RELATION_UPDATED event', () => {
    expect(EventName.RELATION_UPDATED).toBe('relation:updated');
  });

  it('should include USER_MESSAGE_SENT event', () => {
    expect(EventName.USER_MESSAGE_SENT).toBe('user:message-sent');
  });
});
```

### 9. Type Inference Tests

```typescript
describe('Type Inference', () => {
  it('ThreadTurn type should match schema inference', () => {
    const turn: ThreadTurn = {
      index: 0,
      prompt: 'test',
      startedAt: Date.now(),
      completedAt: null,
    };
    expect(ThreadTurnSchema.parse(turn)).toBeDefined();
  });

  it('ThreadMetadata type should match schema inference', () => {
    const thread: ThreadMetadata = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      status: 'idle',
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isRead: true,
    };
    expect(ThreadMetadataSchema.parse(thread)).toBeDefined();
  });

  it('PlanMetadata type should match schema inference', () => {
    const plan: PlanMetadata = {
      id: crypto.randomUUID(),
      repoId: crypto.randomUUID(),
      worktreeId: crypto.randomUUID(),
      relativePath: 'test.md',
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(PlanMetadataSchema.parse(plan)).toBeDefined();
  });

  it('PlanThreadRelation type should match schema inference', () => {
    const relation: PlanThreadRelation = {
      planId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      type: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(PlanThreadRelationSchema.parse(relation)).toBeDefined();
  });
});
```

### 10. Index Exports Test

```typescript
describe('core/types/index.ts exports', () => {
  it('should export relations module', () => {
    // Import from the index and verify exports exist
    const types = require('../index');
    expect(types.PlanThreadRelationSchema).toBeDefined();
    expect(types.RelationTypeSchema).toBeDefined();
  });

  it('should not export tasks module', () => {
    const types = require('../index');
    // TaskSchema or similar should not exist
    expect(types.TaskSchema).toBeUndefined();
    expect(types.TaskMetadataSchema).toBeUndefined();
  });
});
```

### Test Execution Requirements

1. Run tests with: `npm test -- core/types/__tests__/thread-plan-types.test.ts`
2. All tests must pass with zero failures
3. TypeScript must compile the test file without errors
4. Tests should run in under 5 seconds (no I/O or async operations needed)
