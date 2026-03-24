# Workspace & Branch Management - Overview

A unified strategy for managing git worktrees, branches, and diff bases across concurrent tasks.

## Problems Solved

1. **Worktree Contention** - Multiple concurrent agents racing on the same worktree
2. **Incorrect Diff Base** - `HEAD~1` fallback fails for multi-commit branches
3. **No Subtask Support** - No mechanism for subtasks to branch from parent task branches

## Out of Scope (for now)

- Worktree pool limits (pool grows as needed)
- Remote branch sync (task branches are local-only)

---

## Architecture

### Core Insight: Separate Physical from Logical

| Resource | Nature | Cost | Lifetime |
|----------|--------|------|----------|
| **Worktree** | Physical workspace on disk | Heavy (full copy) | Long-lived, reusable |
| **Branch** | Logical workspace in git | Cheap (pointer) | Until merged/deleted |
| **Task** | User's unit of work | Metadata only | Until completed |
| **Conversation** | Agent interaction session | Metadata + logs | Ephemeral |

### Entity Relationships

```
Repository (1) ─── contains ───▶ (*) Worktree      [physical]
     │
     └─── contains ───▶ (*) Branch                 [logical, in git]

Task (1) ─── owns ───▶ (1) TaskBranch              [tracked in settings.json]
     │         └── includes mergeBase, baseBranch
     │
     └─── has ───▶ (*) Conversation                [1:many]

Conversation (1) ─── temporarily claims ───▶ (0..1) Worktree
                                                    [only while writing]
```

### Branch Hierarchy

```
main (or detected default)
├── anvil/task-123           ← branches from main, mergeBase stored
│   ├── anvil/task-123-sub-1 ← branches from anvil/task-123
│   └── anvil/task-123-sub-2 ← branches from anvil/task-123
└── anvil/task-456           ← branches from main
```

### Lifecycle

1. **Task Created** → Determine base branch, create `anvil/task-{id}`, store merge base
2. **Conversation Starts** → Claim available worktree, checkout task's branch
3. **Agent Works** → Makes commits, diff uses stored merge base
4. **Conversation Ends** → Release worktree, branch persists
5. **Task Resumed** → New conversation claims worktree, checks out same branch
6. **Task Completed** → Branch ready for PR
7. **PR Approved & Merged** → Branch deleted, `taskBranches` entry removed

---

## Sub-Plans & Execution Order

### Tier 1 (No Dependencies - Execute in Parallel)

| Plan | Description | Files |
|------|-------------|-------|
| [00a-task-entity](./00a-task-entity.md) | Task entity & persistence | `src/entities/tasks/types.ts`, `src/entities/tasks/task-service.ts`, `src-tauri/src/tasks.rs` |
| [01-types](./01-types.md) | Data model and type definitions | `src/entities/repositories/types.ts`, `src/entities/conversations/types.ts` |
| [02-git-utilities](./02-git-utilities.md) | Default branch detection (Node.js) | `agents/src/git.ts` |

### Tier 1.5 (Minimal Dependencies)

| Plan | Description | Depends On | Files |
|------|-------------|------------|-------|
| [02a-tauri-commands](./02a-tauri-commands.md) | All Tauri/Rust commands | 02 concepts | `src-tauri/src/git_commands.rs`, `src-tauri/src/filesystem_commands.rs`, `src-tauri/src/process_commands.rs` |

### Tier 2 (Depends on Tier 1 - Execute in Parallel)

| Plan | Description | Depends On | Files |
|------|-------------|------------|-------|
| [03-workspace-service](./03-workspace-service.md) | Core workspace orchestration | 01-types, 02a-tauri-commands | `src/lib/workspace-service.ts`, `src/lib/persistence.ts` |
| [04-runner-updates](./04-runner-updates.md) | Runner CLI argument changes | 01-types, 02-git-utilities | `agents/src/runner.ts` |

### Tier 3 (Depends on Tier 2)

| Plan | Description | Depends On | Files |
|------|-------------|------------|-------|
| [05-agent-service](./05-agent-service.md) | Agent service integration | 03-workspace-service, 04-runner-updates, 00a-task-entity | `src/lib/agent-service.ts` |

### Tier 4 (Depends on Tier 3 - Execute in Parallel)

| Plan | Description | Depends On | Files |
|------|-------------|------------|-------|
| [06-ui-integration](./06-ui-integration.md) | Spotlight component updates | 05-agent-service, 00a-task-entity | `src/components/spotlight/spotlight.tsx` |
| [07-maintenance](./07-maintenance.md) | Cleanup and task lifecycle | 03-workspace-service, 00a-task-entity | `src/lib/task-service.ts`, `src/lib/maintenance.ts` |

---

## Execution DAG

```
┌───────────────┐   ┌──────────┐   ┌─────────────────┐
│ 00a-task-entity│   │ 01-types │   │ 02-git-utilities│
└───────┬───────┘   └────┬─────┘   └────────┬────────┘
        │                │                  │
        │                │         ┌────────┴────────┐
        │                │         │                 │
        │                │         ▼                 │
        │                │  ┌────────────────┐       │
        │                │  │02a-tauri-cmds  │       │
        │                │  └───────┬────────┘       │
        │                │          │                │
        │     ┌──────────┴──────────┘                │
        │     │                                      │
        │     ▼                                      ▼
        │  ┌───────────────────┐            ┌─────────────────┐
        │  │ 03-workspace-svc  │            │ 04-runner-updates│
        │  └─────────┬─────────┘            └────────┬────────┘
        │            │                               │
        │            └───────────┬───────────────────┘
        │                        │
        │                        ▼
        │               ┌────────────────┐
        └──────────────▶│ 05-agent-service│◀─────────────────┐
                        └───────┬────────┘                   │
                                │                            │
                   ┌────────────┴────────────┐               │
                   │                         │               │
                   ▼                         ▼               │
          ┌────────────────┐      ┌─────────────────┐        │
          │ 06-ui-integration│    │ 07-maintenance  │────────┘
          └────────────────┘      └─────────────────┘
                   │                         │
                   └──────────┬──────────────┘
                              │
                              ▼
                     (00a-task-entity)
```

Note: 00a-task-entity is used by 05, 06, and 07 but is also a Tier 1 plan with no dependencies.

---

## Testing Strategy

1. **Default branch detection**: Test repos with main, master, develop, custom, no remote
2. **Branch hierarchy**: Root tasks branch from default, subtasks from parent
3. **Multi-commit diffing**: Create task, make multiple commits, verify full diff
4. **Concurrent allocation**: Stress test parallel task creation
5. **Stale claim recovery**: Simulate crashes, verify cleanup
6. **Conversation resume**: Start, pause, resume—verify merge base preserved
7. **Migration**: Verify metadata.json → settings.json migration

---

## Migration Path

1. Add settings.json support, read metadata.json as fallback
2. Implement workspace service with branch tracking
3. Update spotlight to use workspace service
4. Update agent-service with release hooks
5. Clean up old metadata.json files

Existing conversations work in read-only mode. New tasks use full workspace management.
