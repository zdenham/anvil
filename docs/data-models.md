# Data Models

This document describes the core data models in Mort. All persistent data is stored in the `~/.mort/` directory.

## Task

The primary construct in Mort. A task represents something the user needs to accomplish.

**Storage**: `~/.mort/tasks/{slug}/`

**Structure**:
```
{slug}/
  metadata.json    # TaskMetadata
  content.md       # User-authored description/notes
  threads/         # Thread directories (see Thread section)
```

**Properties**:
- `id`: Unique identifier (format: `task-{timestamp}-{random}`)
- `slug`: URL-safe identifier, slugified from title
- `title`: Human-readable name
- `description`: Optional description
- `branchName`: Git branch name (`task/{slug}`)
- `type`: `"work"` | `"investigate"`
- `status`: Phase the task is in (see below)
- `subtasks`: Array of inline checkbox items (`{ id, title, completed }`)
- `parentId`: Reference to parent task (for nested subtasks), or `null`
- `tags`: Array of tag strings
- `sortOrder`: Numeric order for display
- `repositoryName`: Which repository this task operates on
- `pendingReview`: Review request from agent, or `null`
- `reviewApproved`: Whether review has been approved
- `prUrl`: Pull request URL when PR has been created
- `createdAt`, `updatedAt`: Timestamps (milliseconds)

**TaskStatus values**:
- `draft` - Created at spotlight, not yet committed
- `backlog` - Ideas, not yet prioritized
- `todo` - Prioritized, ready to work on
- `in-progress` - Agent actively working
- `in-review` - Work done, under review
- `done` - Merged and complete
- `cancelled` - Abandoned

**Key characteristics**:
- Most permanent construct - tasks persist across sessions
- Context is scoped to a task and its subtasks
- Threads are stored within the task directory

**Implementation**: `core/types/tasks.ts` (types), `src/entities/tasks/` (service)

## Thread

A user's interaction with an agent. Threads are persisted within their parent task.

**Storage**: `~/.mort/tasks/{task-slug}/threads/{agentType}-{threadId}/metadata.json`

**Properties**:
- `id`: UUID identifying the thread
- `taskId`: Parent task ID (required - every thread belongs to a task)
- `agentType`: Type of agent (`"entrypoint"` | `"execution"` | `"review"` | `"merge"` | `"research"`)
- `workingDirectory`: Absolute path to working directory
- `status`: Thread state (see below)
- `turns`: Array of conversation turns
- `git`: Optional git info (`{ branch, commitHash? }`)
- `ttlMs`: Optional time-to-live
- `createdAt`, `updatedAt`: Timestamps (milliseconds)

**ThreadStatus values**:
- `idle` - Not currently running
- `running` - Agent actively processing
- `completed` - Finished successfully
- `error` - Terminated with error
- `paused` - Temporarily suspended

**ThreadTurn**:
- `index`: Turn number
- `prompt`: User prompt for this turn
- `startedAt`: Timestamp when turn started
- `completedAt`: Timestamp when turn completed, or `null`
- `exitCode`: Optional exit code
- `costUsd`: Optional cost in USD

**Key characteristics**:
- Threads live within their parent task directory
- Multiple threads can exist per task (different agent types)
- Thread folder name format: `{agentType}-{uuid}`

**Implementation**: `src/entities/threads/types.ts` (types), `src/entities/threads/` (service)

## Repository

A code repository the user works in.

**Storage**: `~/.mort/repositories/{repo-slug}/`

**Structure**:
```
{repo-slug}/
  settings.json         # RepositorySettings
  {repo-slug}-1/        # Worktree/version 1
  {repo-slug}-2/        # Worktree/version 2
  ...
```

**RepositorySettings properties**:
- `schemaVersion`: Schema version for migrations (currently `1`)
- `name`: Repository name
- `originalUrl`: Git remote URL if cloned, or `null`
- `sourcePath`: Path to source repository
- `useWorktrees`: Whether worktrees are enabled
- `worktrees`: Array of `WorktreeState` (see Worktree section)
- `taskBranches`: Record of task ID → `TaskBranchInfo`
- `createdAt`: Timestamp when repo was added
- `lastUpdated`: Last modification timestamp

**TaskBranchInfo** (stored in `taskBranches`):
- `branch`: Branch name (e.g., `"mort/task-abc123"`)
- `baseBranch`: Base branch it was created from (e.g., `"main"`)
- `mergeBase`: Commit hash at branch creation (for accurate diffs)
- `parentTaskId`: For subtasks, the parent task ID
- `createdAt`: Timestamp of branch creation

**Key characteristics**:
- Contains multiple worktrees/versions for parallel work
- Git repos use worktrees (fast, space-efficient)
- Task branch info is tracked per repository

**Implementation**: `src/entities/repositories/types.ts` (types), `src/entities/repositories/` (service)

## Worktree

A specific git worktree within a repository. Provides isolated working directories.

**Storage**: Lives within repository directory as `{repo-slug}-N/`

**WorktreeState properties**:
- `path`: Absolute path to the worktree directory
- `version`: Numeric identifier (1, 2, 3...)
- `currentBranch`: Currently checked out branch, or `null`
- `claim`: Active `WorktreeClaim`, or `null` if available

**WorktreeClaim** (when a thread is using a worktree):
- `threadId`: The thread ID holding the claim
- `taskId`: The task this thread belongs to (or `null` during routing)
- `claimedAt`: Timestamp when claim was made

**Key characteristics**:
- Finite pool - worktrees can be rotated between tasks
- Claims track which thread is actively using a worktree
- Git worktrees share the object database (fast to create, space-efficient)
- Worktrees can be reclaimed from idle tasks for active work

## Relationships

```
Repository (1) ─── contains ───> (*) Worktree
     │
     ├── tracks taskBranches (task ID → branch info)
     │
     └── worktrees can be claimed by threads

Task (1) ─── contains ───> (*) Thread
  │                              │
  │                              └── claims (0..1) ───> Worktree
  │
  ├── has (*) ───> Subtask (inline checkboxes)
  │
  └── has branch info stored in Repository.taskBranches
```

**Lifecycle notes**:
- Tasks are permanent until explicitly deleted
- Threads live within their parent task directory
- Worktrees are pooled and claimed by threads as needed
- A worktree can be reclaimed from an idle thread for active work
- Branch info (merge base, base branch) is tracked per task in the repository settings
