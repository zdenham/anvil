# 01 - Types & Data Model

**Tier:** 1 (No dependencies)
**Parallelizable with:** 02-git-utilities
**Blocking:** 03-workspace-service, 04-runner-updates

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: 03-workspace-service, 04-runner-updates, 05-agent-service
export interface TaskBranchInfo {
  branch: string;           // e.g., "anvil/task-abc123"
  baseBranch: string;       // e.g., "main" or "anvil/task-parent"
  mergeBase: string;        // Commit hash at branch creation
  parentTaskId?: string;    // For subtasks
  createdAt: number;
}

// Used by: 03-workspace-service
export interface WorktreeClaim {
  conversationId: string;
  taskId: string;
  claimedAt: number;
}

// Used by: 03-workspace-service, 05-agent-service
export interface WorktreeState {
  path: string;
  version: number;
  currentBranch: string | null;
  claim: WorktreeClaim | null;
}

// Used by: 03-workspace-service, 07-maintenance
export interface RepositorySettings {
  schemaVersion: 1;
  name: string;
  originalUrl: string | null;
  sourcePath: string;
  useWorktrees: boolean;
  createdAt: number;
  worktrees: WorktreeState[];
  taskBranches: Record<string, TaskBranchInfo>;
  lastUpdated: number;
}
```

### Imports (This Plan Depends On)

None - this is a foundation plan.

---

## Implementation

### File: `src/entities/repositories/types.ts`

Add the following type definitions:

```typescript
/**
 * Information about a task's git branch.
 * Stored in repository settings, keyed by task ID.
 */
export interface TaskBranchInfo {
  /** Branch name, e.g., "anvil/task-abc123" */
  branch: string;

  /** Base branch this was created from, e.g., "main" or "anvil/task-parent" */
  baseBranch: string;

  /** Commit hash at branch creation - used for accurate diffs */
  mergeBase: string;

  /** For subtasks, the parent task ID */
  parentTaskId?: string;

  /** Timestamp of branch creation */
  createdAt: number;
}

/**
 * Active claim on a worktree by a conversation.
 */
export interface WorktreeClaim {
  /** The conversation ID holding the claim */
  conversationId: string;

  /** The task this conversation belongs to */
  taskId: string;

  /** When the claim was made */
  claimedAt: number;
}

/**
 * State of a single worktree in the pool.
 */
export interface WorktreeState {
  /** Absolute path to the worktree directory */
  path: string;

  /** Version number (for compatibility/migration) */
  version: number;

  /** Currently checked out branch, or null */
  currentBranch: string | null;

  /** Active claim, or null if available */
  claim: WorktreeClaim | null;
}

/**
 * Repository settings file structure.
 * Location: ~/.anvil/repositories/{repo-slug}/settings.json
 */
export interface RepositorySettings {
  /** Schema version for migrations */
  schemaVersion: 1;

  /** Repository name */
  name: string;

  /** Original remote URL if cloned, null if local */
  originalUrl: string | null;

  /** Path to source repository */
  sourcePath: string;

  /** Whether worktrees are enabled for this repo */
  useWorktrees: boolean;

  /** When this repo was added to anvil */
  createdAt: number;

  /** Pool of available worktrees */
  worktrees: WorktreeState[];

  /** Task branch tracking, keyed by task ID */
  taskBranches: Record<string, TaskBranchInfo>;

  /** Last modification timestamp */
  lastUpdated: number;
}
```

---

## Conversation Metadata Update

The conversation metadata no longer stores merge base—it references the task.

### File: `src/entities/conversations/types.ts`

```typescript
export type ConversationStatus = "running" | "completed" | "error" | "paused";

/**
 * Conversation metadata stored in:
 * ~/.anvil/conversations/{conversation-id}/metadata.json
 */
export interface ConversationMetadata {
  /** Unique conversation identifier */
  id: string;

  /** The task this conversation belongs to */
  taskId: string;

  /** Current conversation status */
  status: ConversationStatus;

  /** When the conversation started */
  startedAt: number;

  /** When the conversation ended (if completed/error) */
  endedAt?: number;

  /** Git state snapshot */
  git?: {
    /** Branch name (copied from task for convenience) */
    branch: string;
    /** Latest commit hash when conversation ended */
    commitHash?: string;
  };
}
```

### Storage Location

```
~/.anvil/conversations/
├── conv-abc123/
│   ├── metadata.json      # ConversationMetadata
│   ├── history.jsonl      # Message history
│   └── logs/              # Agent logs
└── conv-def456/
    └── ...
```

The runner reads merge base from repository settings via the task ID, not from conversation metadata.

---

## Example Settings File

```json
{
  "schemaVersion": 1,
  "name": "my-app",
  "originalUrl": null,
  "sourcePath": "/Users/zac/projects/my-app",
  "useWorktrees": true,
  "createdAt": 1703100000000,

  "worktrees": [
    {
      "path": "/Users/zac/.anvil/repositories/my-app/my-app-1",
      "version": 1,
      "currentBranch": "anvil/task-abc123",
      "claim": {
        "conversationId": "conv-xyz789",
        "taskId": "task-abc123",
        "claimedAt": 1703184000000
      }
    },
    {
      "path": "/Users/zac/.anvil/repositories/my-app/my-app-2",
      "version": 2,
      "currentBranch": "main",
      "claim": null
    }
  ],

  "taskBranches": {
    "task-abc123": {
      "branch": "anvil/task-abc123",
      "baseBranch": "main",
      "mergeBase": "a1b2c3d4e5f6",
      "createdAt": 1703180000000
    },
    "task-sub-1": {
      "branch": "anvil/task-sub-1",
      "baseBranch": "anvil/task-abc123",
      "mergeBase": "f6e5d4c3b2a1",
      "parentTaskId": "task-abc123",
      "createdAt": 1703182000000
    }
  },

  "lastUpdated": 1703184000000
}
```

---

## Verification

- [ ] All types exported from `src/entities/repositories/types.ts`
- [ ] Types compile without errors
- [ ] Example JSON validates against types
