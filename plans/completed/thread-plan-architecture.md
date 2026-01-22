# Thread + Plan Architecture

## Overview

This document describes the new data model for Mortician, replacing the current Task-centric architecture with a simpler Thread + Plan model. This is a breaking change with no backwards compatibility.

## Philosophy

**Plans are the durable brain, threads are ephemeral hands.**

- **Plans** are markdown files on disk that persist context, decisions, and progress
- **Threads** are disposable agent conversations that do work and update plans
- Long threads degrade in quality (context pollution, slower inference). Fresh threads with plan context are more effective.
- Users should be able to run multiple agents in parallel, not sit waiting for one

## Core Entities

**All IDs are UUIDs.** Every `id`, `repoId`, `worktreeId`, `planId`, `threadId`, and `parentPlanId` in this system is a UUID (v4). No slugs, no sequential IDs, no human-readable identifiers for entity references.

### Thread

A conversation with an agent. Threads are relatively ephemeral but preserved in an archive.

```typescript
interface ThreadMetadata {
  id: string                    // UUID (all IDs in this system are UUIDs)
  repoId: string                // UUID - Repository this thread belongs to
  worktreeId: string            // UUID - Worktree this thread runs in (required - main repo is also a worktree)
  status: ThreadStatus          // running | completed | error
  turns: ThreadTurn[]           // Conversation turns with timing/cost
  git?: {
    branch: string
    initialCommitHash: string
    commitHash: string
  }
  isRead: boolean               // For inbox unread state
  pid?: number                  // Process ID when running
  createdAt: string
  updatedAt: string
}

type ThreadStatus = 'running' | 'completed' | 'error';
```

**Deriving paths:** The working directory is derived from `worktreeId`:
- Look up worktree by ID to get its path
- The main repository directory is itself a worktree (created when the repo is added)

**Note on file changes:** File change data lives exclusively in `state.json` as `fileChanges: FileChange[]`. The metadata is intentionally kept small for memory-efficient inbox listings. When displaying file change counts or paths in the inbox, we derive them from `state.json` on demand or cache them transiently.

**Storage:**
```
~/.mort/threads/
  └── {threadId}/
      ├── metadata.json     # Small, loaded for inbox listings (~1KB)
      └── state.json        # Large, loaded only when viewing thread (10KB - 10MB+)
```

**Metadata vs State separation:**
- `metadata.json`: Contains only what's needed for listing threads (id, status, isRead, git info, timestamps). Loaded into memory for all threads.
- `state.json`: Contains the full conversation (messages, fileChanges, toolStates). Only loaded when actively viewing a thread.

This separation enables memory-efficient inbox rendering - we can show hundreds of threads without loading their full conversation history.

**Key changes from current model:**
- No `taskId` - threads are independent
- No `agentType` - simplified, just a thread
- No `planId` on the thread itself - relationships are in a separate table
- Added `repoId` and `worktreeId` (both required) - threads are explicitly scoped to a repo/worktree
- No `workingDirectory` - derived from worktree lookup
- Main repo directory is treated as a worktree (created when repo is added)

### Plan

A markdown file in the repository's configured plans directory. Users configure their plans directory when adding a repository to Mortician.

```typescript
interface PlanMetadata {
  id: string                    // UUID
  repoId: string                // UUID - Repository this plan belongs to
  worktreeId: string            // UUID - Worktree this plan lives in (required - main repo is also a worktree)
  relativePath: string          // Path relative to repo's plans directory
  isRead: boolean               // For inbox unread state
  parentPlanId?: string         // UUID - For nested plans (parent's UUID, derived from file hierarchy)
  createdAt: string
  updatedAt: string
}
```

**Deriving paths:** The absolute path is derived from `worktreeId` and `relativePath`:
- Look up worktree by ID to get its path
- Look up repository config to get `plansDirectory`
- Absolute path = `{worktreePath}/{plansDirectory}/{relativePath}`

**Storage:**
```
~/.mort/plans/
  └── {planId}/
      └── metadata.json
```

Plan content lives at the derived absolute path in the repository (e.g., `{repo}/plans/auth-system/README.md`).

**Plan hierarchy:**
- Parent-child relationships are determined by file structure in the repository
- The metadata in `~/.mort/plans/` mirrors the repository's plan directory structure
- `parentPlanId` is derived from the file hierarchy and stored in metadata

**Naming conventions:**
- Plan files should follow a consistent naming style (e.g., `01-data-model.md`, `02-api-layer.md`)
- Directory names represent parent plans (e.g., `auth-system/` contains child plans)
- A `README.md` in a directory represents the parent plan for that directory

### Thread-Plan Relations

A many-to-many relationship linking threads to plans they touched.

```typescript
interface ThreadPlanRelation {
  threadId: string              // UUID
  planId: string                // UUID
  relationType: RelationType    // created | modified | referenced
  createdAt: string
}

type RelationType =
  | 'created'      // Thread created this plan
  | 'modified'     // Thread made changes to this plan
  | 'referenced'   // Thread read/referenced this plan (user mentioned in message)
```

**Storage:**
```
~/.mort/plan-thread-edges/
  └── {planId}-{threadId}.json
```

Each relation is its own JSON file, named with the pattern `{planId}-{threadId}.json`. This allows:
- Simple file-based queries (glob for `{planId}-*.json` or `*-{threadId}.json`)
- Atomic writes without read-modify-write cycles
- Easy inspection and debugging

**Relation creation triggers:**
- `created`: Thread creates a new plan file in the plans directory
- `modified`: Thread edits an existing plan file
- `referenced`: User mentions a plan in their message to the thread (detected via existing plan detection logic)

## Repository Configuration

When adding a repository to Mortician, users configure:

```typescript
interface RepositoryConfig {
  path: string                  // Absolute path to repository
  plansDirectory: string        // Relative path to plans directory (e.g., "plans/")
  completedDirectory: string    // Relative path for completed plans (e.g., "plans/completed/")
}
```

This configuration is stored per-repository and determines where Mortician looks for plan files.

## Removed Entities

### Task (DEPRECATED)

The `Task` entity is completely removed:
- No more `TaskMetadata`
- No more `tasks/` directory structure
- No more task slugs, task content, task status
- No more task-thread hierarchy

**Migration:** Existing tasks are not migrated. Users start fresh.

## Directory Structure

### Before (Current)
```
~/.mort/
  ├── tasks/
  │   └── {taskSlug}/
  │       ├── metadata.json
  │       ├── content.md
  │       └── threads/
  │           └── {agentType}-{threadId}/
  │               ├── metadata.json
  │               └── state.json
  └── plans/
      └── {planId}/
          └── metadata.json
```

### After (New)
```
~/.mort/
  ├── threads/
  │   └── {threadId}/
  │       ├── metadata.json
  │       └── state.json
  ├── plans/
  │   └── {planId}/
  │       └── metadata.json
  ├── plan-thread-edges/
  │   └── {planId}-{threadId}.json
  └── archive/
      ├── threads/
      │   └── {threadId}/
      │       ├── metadata.json
      │       └── state.json
      ├── plans/
      │   └── {planId}/
      │       └── metadata.json
      └── plan-thread-edges/
          └── {planId}-{threadId}.json
```

**Archive structure:**
- The `archive/` directory mirrors the main `.mort/` structure
- When archiving, items move to their respective folder in `archive/`
- Entity fetching services can easily switch between active and archive queries by changing the base path

## Inbox Model

The inbox shows two types of items: Threads and Plans.

### Inbox Item States

Both threads and plans have:
- **Unread**: New or updated, user hasn't reviewed
- **Read**: User has seen it
- **Archived**: Out of active view (moved to `~/.mort/archive/`)

### Inbox Views

```
Inbox
├── Threads
│   ├── "implement auth step 1" (running)
│   ├── "debug token issue" (completed, unread)
│   └── "quick question" (completed, read)
│
└── Plans
    ├── [▶] auth-system/ (2 pending sub-plans)
    │   ├── 01-data-model.md ✓
    │   ├── 02-api-layer.md (in progress)
    │   └── 03-testing.md (pending)
    └── quick-fix.md (completed)
```

### Plan Nesting in Inbox

Plans can be deeply nested. The inbox handles this by:

1. **Collapsible tree view** - Parent plans show aggregate status, expand to see children
2. **Top-level counting** - Only root plans count toward inbox badge
3. **Bulk actions** - "Mark all children read" on parent plan
4. **Smart surfacing** - Option to show only "leaf" plans being actively worked on

### Thread-Plan Relationships in Inbox

When viewing a thread:
- Show "Related Plans" section with links to plans this thread touched

When viewing a plan:
- Show "Related Threads" section with threads that created/modified this plan
- Threads are shown even if archived (click to view archived thread)

## Workflows

### Creating a Plan

1. User starts new thread: "Create a plan for user authentication"
2. Agent creates `{plansDirectory}/auth-system/README.md` in repository
3. System detects new plan file, calls `ensurePlanExists({ repoId, worktreeId?, relativePath })`
4. Relation created: `{planId}-{threadId}.json` with `relationType: 'created'`
5. Thread completes, can be archived
6. Plan appears in inbox as unread

### Working on a Plan

1. User views plan in inbox, sees pending steps
2. User starts new thread: "Implement step 2 of auth plan" (with plan context injected)
3. System detects plan reference in user message, creates relation with `relationType: 'referenced'`
4. Agent reads plan, does work, updates plan to mark step 2 complete
5. Relation updated to `relationType: 'modified'` (or new relation created)
6. Thread completes, can be archived
7. Plan marked unread (something changed)

### Archiving

**Archiving a Thread:**
- Thread directory moves from `~/.mort/threads/{id}/` to `~/.mort/archive/threads/{id}/`
- Related edges move from `~/.mort/plan-thread-edges/` to `~/.mort/archive/plan-thread-edges/`
- Relations preserved (can still query "threads that touched this plan" from archive)
- Diffs preserved in archived thread state

**Archiving a Plan (Plan Completion):**
- Plan file moves from `{plansDirectory}/` to `{completedDirectory}/` in the repository
- Plan metadata directory moves from `~/.mort/plans/{id}/` to `~/.mort/archive/plans/{id}/`
- Plan metadata's `relativePath` updated to reflect new location within completed directory
- Related edges move to archive as well

**Bulk Archive:**
- "Archive plan and related threads" - archives plan + all threads that only touched this plan
- Threads that touched multiple plans are not auto-archived

### Planless Threads

Not all threads need plans. Quick questions, debugging, exploration.

- Thread created without plan relation
- Lives in inbox as standalone item
- Archive when done

## Diffs

Diffs are stored on threads (in `state.json` as part of conversation history).

**Viewing diffs for a plan:**
1. Query relations: glob `{planId}-*.json` in both active and archive edges
2. Load each related thread's state
3. Aggregate diffs (or show per-thread)

**Viewing diffs for a worktree:**
- Use git directly: `git diff` on the worktree branch
- This is the source of truth for "what changed"

**Thread diffs vs Git diffs:**
- Thread diffs: annotated with conversation context (which message caused which change)
- Git diffs: canonical, complete, survives thread archival

## Context Hydration

When starting a thread related to a plan:

1. User indicates "work on plan X" (explicit) or system detects from prompt (implicit)
2. Plan content is injected into thread's initial context
3. Optionally: summary of previous threads that touched this plan

This keeps threads fresh while maintaining continuity.

## Events

```typescript
// Thread events
THREAD_CREATED
THREAD_UPDATED
THREAD_STATUS_CHANGED
THREAD_ARCHIVED

// Plan events
PLAN_CREATED
PLAN_UPDATED
PLAN_ARCHIVED

// Relation events
RELATION_CREATED
RELATION_UPDATED
```

## Decisions (Resolved)

1. **Relation storage format**: Individual JSON files per relation
   - File naming: `{planId}-{threadId}.json`
   - Stored in `~/.mort/plan-thread-edges/`
   - Simple glob queries for lookups in either direction

2. **Plan parent detection**: File path hierarchy in repository
   - Plans in subdirectories are children of the directory's parent plan
   - `parentPlanId` stored in metadata, derived from file structure
   - Naming conventions enforced for consistent hierarchy

3. **Archived thread/plan retention**: Forever
   - Disk is cheap, history is valuable
   - Future: may add user controls for manual deletion

4. **Plan completion**: Moving to completed directory
   - Plan file moves from `{plansDirectory}/` to `{completedDirectory}/` in repo
   - Metadata moves to `~/.mort/archive/plans/`
   - Clear, file-system-based completion signal

5. **Relation creation**: System detection
   - `created`: Detected when thread creates a plan file
   - `modified`: Detected when thread edits a plan file
   - `referenced`: Detected when user mentions plan in message (existing detection logic)

## Deprecation & Removal Inventory

Everything below gets deleted. No backwards compatibility, no migration.

### Core Type Definitions

| File | What to Remove |
|------|----------------|
| `core/types/tasks.ts` | **DELETE ENTIRE FILE** - TaskStatus, TaskMetadata, TaskMetadataSchema, Subtask, PendingReview, generateTaskId, TASK_STATUSES, ACTIVE_STATUSES |
| `core/types/events.ts` | Remove: TASK_CREATED, TASK_UPDATED, TASK_DELETED, TASK_STATUS_CHANGED, TASK_MARKED_UNREAD |
| `core/types/index.ts` | Remove task type exports |

### Frontend Entity Layer

| File | Action |
|------|--------|
| `src/entities/tasks/` | **DELETE ENTIRE DIRECTORY** |
| ├── `store.ts` | useTaskStore (tasks, taskContent, hydrate, getRootTasks, getSubtasks, etc.) |
| ├── `service.ts` | taskService (CRUD, hydrate, refresh, create, update, delete, etc.) |
| ├── `listeners.ts` | setupTaskListeners() |
| ├── `types.ts` | Re-exports of core task types |
| ├── `sort-tasks.ts` | sortTasksByPriority() |
| ├── `sort-kanban.ts` | sortTasksInKanbanOrder() |
| ├── `archive-service.ts` | archiveTask() |
| └── `mark-unread-service.ts` | markTaskUnread(), isTaskUnread() |
| `src/entities/index.ts` | Remove all task exports |

### Core Backend Services

| File | Action |
|------|--------|
| `core/services/task/` | **DELETE ENTIRE DIRECTORY** |
| ├── `metadata-service.ts` | TaskMetadataService |
| ├── `draft-service.ts` | TaskDraftService |
| └── `task-service.test.ts` | Tests |

### UI Components

| File/Directory | Action |
|----------------|--------|
| `src/components/tasks-panel/` | **DELETE ENTIRE DIRECTORY** - TasksPanel, tests |
| `src/components/tasks/` | **DELETE ENTIRE DIRECTORY** - TaskCard, TaskRow, DeleteTaskDialog, EmptyTaskState |
| `src/components/workspace/task-workspace.tsx` | **DELETE** |
| `src/components/workspace/task-overview.tsx` | **DELETE** |
| `src/components/workspace/task-overview.ui.test.tsx` | **DELETE** |
| `src/components/workspace/task-header.tsx` | **DELETE** |
| `src/components/workspace/task-changes.tsx` | **REFACTOR** - rename to thread-changes.tsx, remove task references |
| `src/components/main-window/tasks-page.tsx` | **DELETE** |
| `src/components/shared/task-legend.tsx` | **DELETE** |
| `src/components/shared/unified-task-list.tsx` | **DELETE** |

### Simple Task → Control Panel (Rename)

The "simple task" panel becomes the **Control Panel** - a unified view for threads and plans.
The main tab in the UI becomes **Mission Control**.

| File | Action |
|------|--------|
| `src/components/simple-task/` | **RENAME DIRECTORY** to `control-panel/` |
| ├── `simple-task-window.tsx` | Rename to `control-panel-window.tsx`, remove task refs |
| ├── `simple-task-header.tsx` | Rename to `control-panel-header.tsx` |
| ├── `use-simple-task-params.ts` | Rename to `use-control-panel-params.ts` |
| └── All test files | Rename and update |

### Hooks

| File | Action |
|------|--------|
| `src/hooks/use-task-threads.ts` | **DELETE** |
| `src/hooks/use-task-board.ts` | **DELETE** |
| `src/hooks/use-delete-task.ts` | **DELETE** |
| `src/hooks/use-simple-task-navigation.ts` | Rename to `use-control-panel-navigation.ts` |
| `src/hooks/use-navigate-to-next-task.ts` | Rename to `use-navigate-to-next-thread.ts` |

### Utilities

| File | Action |
|------|--------|
| `src/utils/task-colors.ts` | **DELETE** - getTaskDotColor(), getTaskUnreadCount(), etc. |
| `src/utils/task-colors.test.ts` | **DELETE** |

### Test Factories

| File | Action |
|------|--------|
| `src/test/factories/task.ts` | **DELETE** |
| `src/test/factories/index.ts` | Remove task exports |
| `src/test/helpers/stores.ts` | Remove task store helpers |

### Window Entry Points

| File | Action |
|------|--------|
| `task.html` | **DELETE** |
| `tasks-panel.html` | **DELETE** |
| `simple-task.html` | Rename to `control-panel.html` |
| `src/task-main.tsx` | **DELETE** |
| `src/tasks-panel-main.tsx` | **DELETE** |
| `src/simple-task-main.tsx` | Rename to `control-panel-main.tsx` |

### Build Configuration

| File | Changes |
|------|---------|
| `vite.config.ts` | Remove `task`, `tasks-panel` entries; rename `simple-task` to `control-panel` |

### Tauri/Rust Backend

| File | Changes |
|------|---------|
| `src-tauri/src/mort_commands.rs` | Remove `update_task()` command |
| `src-tauri/src/lib.rs` | Remove `open_task()`, `hide_task()`, `show_tasks_panel()`, `hide_tasks_panel()`; rename simple-task to control-panel |
| `src-tauri/src/panels.rs` | Remove `hide_task()`, `hide_tasks_list()` |
| `src-tauri/src/config.rs` | Remove task navigation hotkeys (task_navigation_down_hotkey, task_navigation_up_hotkey, etc.) |
| `src-tauri/tauri.conf.json` | Remove task window configurations |

### TypeScript Libraries

| File | Changes |
|------|---------|
| `src/lib/hotkey-service.ts` | Remove `openTask()`, `hideTask()`, `showTasksPanel()`, `hideTasksPanel()`; rename simple-task → control-panel functions |
| `src/lib/tauri-commands.ts` | Remove task panel visibility checks |
| `src/lib/event-bridge.ts` | Remove `open-task`, `task-panel-ready` events; rename simple-task → control-panel events |
| `src/lib/persistence.ts` | Remove task-related file I/O |

### Agent/CLI Code

| File | Changes |
|------|---------|
| `agents/src/validators/merge-task-status.ts` | **DELETE** |
| `agents/src/runners/task-runner-strategy.ts` | **DELETE** - replaced by simple-runner-strategy |
| `agents/src/agent-types/*.ts` | Remove task references from agent type definitions |

### Thread Entity Updates

| File | Changes |
|------|---------|
| `src/entities/threads/service.ts` | Remove `getByTask()`, remove taskId dependencies |
| `src/entities/threads/store.ts` | Remove taskId from thread queries |
| `core/types/threads.ts` | Remove `taskId` from ThreadMetadata |

### Event System

| File | Changes |
|------|---------|
| `src/entities/events.ts` | Remove all task event emissions |

### Disk Storage

| Path | Action |
|------|--------|
| `~/.mort/tasks/` | Backup to `~/.mort/tasks-backup-{date}/`, then delete |

### Summary

| Category | Files to Delete | Files to Modify |
|----------|-----------------|-----------------|
| Core Types | 1 | 2 |
| Entity Layer | 8 | 1 |
| Core Services | 3 | 0 |
| UI Components | ~15 | ~5 |
| Hooks | 3 | 2 |
| Utilities | 2 | 0 |
| Entry Points | 4 | 2 |
| Tauri/Rust | 0 | 5 |
| Libraries | 0 | 4 |
| Agents | 2 | ~3 |
| **Total** | **~38** | **~24** |

~62 files total affected.
