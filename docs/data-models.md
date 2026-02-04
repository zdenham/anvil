# Data Models

This document describes the core data models in Mort. All persistent data is stored in the `~/.mort/` directory.

## Thread

A user's interaction with an agent. Threads are the primary interaction model.

**Storage**: `~/.mort/threads/{threadId}/metadata.json`

**Properties**:
- `id`: UUID identifying the thread
- `repoId`: Repository UUID this thread belongs to
- `worktreeId`: Worktree UUID where work happens
- `status`: Thread state (see below)
- `turns`: Array of conversation turns
- `git`: Optional git info (`{ branch, initialCommitHash?, commitHash? }`)
- `changedFilePaths`: Array of files modified by this thread
- `isRead`: Whether thread has been viewed
- `markedUnreadAt`: Timestamp when marked unread (for navigation cooldown)
- `pid`: Process ID when running, or `null`
- `name`: Auto-generated thread name (max 30 chars)
- `createdAt`, `updatedAt`: Timestamps (milliseconds)

**ThreadStatus values**:
- `idle` - Not currently running
- `running` - Agent actively processing
- `completed` - Finished successfully
- `error` - Terminated with error
- `paused` - Temporarily suspended
- `cancelled` - Abandoned

**ThreadTurn**:
- `index`: Turn number
- `prompt`: User prompt for this turn
- `startedAt`: Timestamp when turn started
- `completedAt`: Timestamp when turn completed, or `null`
- `exitCode`: Optional exit code
- `costUsd`: Optional cost in USD

**Key characteristics**:
- Threads are top-level entities, not nested under tasks
- Each thread is scoped to a repository and worktree
- Thread folder name is simply the UUID

**Implementation**: `core/types/threads.ts` (types), `src/entities/threads/` (service)

## Plan

A markdown file representing work to be done. Plans live in the repository and are tracked by Mort.

**Storage**: `~/.mort/plans/{planId}/metadata.json`

**Properties**:
- `id`: UUID identifying the plan
- `repoId`: Repository UUID this plan belongs to
- `worktreeId`: Worktree UUID where the plan file lives
- `relativePath`: Path relative to repo's plans directory
- `parentId`: For nested plans, the parent plan UUID
- `isFolder`: True if this plan has children (is a "folder" plan)
- `isRead`: Whether plan has been viewed
- `markedUnreadAt`: Timestamp when marked unread (for navigation cooldown)
- `stale`: True if file was not found on last access
- `lastVerified`: Timestamp of last successful file access
- `createdAt`, `updatedAt`: Timestamps (milliseconds)

**Key characteristics**:
- Plans are markdown files stored in the repository (not ~/.mort)
- Mort tracks metadata about plans separately
- Supports nested plans (folder structure with parent/child relationships)

**Implementation**: `core/types/plans.ts` (types), `src/entities/plans/` (service)

## Plan-Thread Relation

Tracks the relationship between plans and threads.

**Storage**: `~/.mort/plan-thread-edges/{planId}-{threadId}.json`

**Properties**:
- `planId`: Plan UUID
- `threadId`: Thread UUID
- `type`: Relation type (see below)
- `archived`: Set true when thread or plan is archived
- `createdAt`, `updatedAt`: Timestamps (milliseconds)

**RelationType values** (in precedence order):
- `created` - Thread created this plan file (highest)
- `modified` - Thread modified this plan file
- `mentioned` - Thread referenced this plan (lowest)

**Implementation**: `core/types/relations.ts` (types), `src/entities/relations/` (service)

## Repository

A code repository the user works in.

**Storage**: `~/.mort/repositories/{repo-slug}/settings.json`

**RepositorySettings properties**:
- `id`: UUID for repository identification
- `schemaVersion`: Schema version for migrations (currently `1`)
- `name`: Repository name
- `originalUrl`: Git remote URL if cloned, or `null`
- `sourcePath`: Path to source repository
- `useWorktrees`: Whether worktrees are enabled
- `defaultBranch`: Default branch name (e.g., `"main"`)
- `worktrees`: Array of `WorktreeState` (see Worktree section)
- `threadBranches`: Record of thread ID → `ThreadBranchInfo`
- `plansDirectory`: Directory where plan files are stored (relative to repo root)
- `completedDirectory`: Directory for completed/archived plans
- `createdAt`: Timestamp when repo was added
- `lastUpdated`: Last modification timestamp

**ThreadBranchInfo** (stored in `threadBranches`):
- `branch`: Branch name (e.g., `"mort/thread-abc123"`)
- `baseBranch`: Base branch it was created from (e.g., `"main"`)
- `mergeBase`: Commit hash at branch creation (for accurate diffs)
- `parentThreadId`: For child threads, the parent thread ID
- `createdAt`: Timestamp of branch creation

**Key characteristics**:
- Contains multiple worktrees for parallel work
- Git worktrees share the object database (fast, space-efficient)
- Thread branch info is tracked per repository

**Implementation**: `core/types/repositories.ts` (types), `src/entities/repositories/` (service)

## Worktree

A specific git worktree within a repository. Provides isolated working directories.

**Storage**: Lives within repository directory, tracked in `settings.json`

**WorktreeState properties**:
- `id`: UUID for worktree identification
- `path`: Absolute path to the worktree directory
- `name`: Name of the worktree
- `createdAt`: Creation timestamp
- `lastAccessedAt`: Last access timestamp
- `currentBranch`: Currently checked out branch, or `null`
- `isRenamed`: Whether this worktree has been renamed from its initial name

**Key characteristics**:
- Worktrees are pooled per repository
- Git worktrees share the object database (fast to create, space-efficient)
- Threads reference worktrees by UUID

## Relationships

```
Repository (1) ─── contains ───> (*) Worktree
     │
     └── tracks threadBranches (thread ID → branch info)

Thread (*) ─── references ───> (1) Repository
   │
   └── references ───> (1) Worktree

Plan (*) ─── references ───> (1) Repository
  │
  └── references ───> (1) Worktree

Plan (*) ─── PlanThreadRelation ───> (*) Thread
```

**Lifecycle notes**:
- Threads are top-level entities scoped to a repository/worktree
- Plans track markdown files in the repository
- Plan-Thread relations track how threads interact with plans
- Branch info (merge base, base branch) is tracked per thread in the repository settings
