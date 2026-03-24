# Node Orchestration Migration - Sub-Plans

This directory contains the node orchestration migration broken into parallelizable sub-plans.

## Dependency Graph

```
                    ┌─────────────────────┐
                    │  00-import-boundary │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ 01-adapter-interfaces│
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  02a-fs-adapter │  │ 02b-git-adapter │  │  02c-path-lock  │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
    ┌─────────────┬───────────┼───────────┬─────────────┐
    │             │           │           │             │
    ▼             ▼           ▼           ▼             ▼
┌────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌──────────┐
│  03a   │  │   03b    │  │  03c   │  │  03d   │  │   03e    │
│settings│  │merge-base│  │  task  │  │ thread │  │  branch  │
└───┬────┘  └────┬─────┘  └────────┘  └────────┘  └──────────┘
    │            │
    └──────┬─────┘
           │
           ▼
┌─────────────────────────┐
│ 04-worktree-allocation  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   05-wire-up-runner     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  06-simplify-frontend   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      07-cleanup         │
└─────────────────────────┘
```

## Execution Waves

Plans in the same wave can be executed in parallel.

| Wave | Plans | Description |
|------|-------|-------------|
| 1 | `00-import-boundary` | Configure tsconfig paths |
| 2 | `01-adapter-interfaces` | Define adapter type interfaces |
| 3 | `02a-fs-adapter`, `02b-git-adapter`, `02c-path-lock` | Implement Node adapters (parallel) |
| 4 | `03a-settings-service`, `03b-merge-base-service`, `03c-task-services`, `03d-thread-service`, `03e-branch-service` | Implement services (parallel) |
| 5 | `04-worktree-allocation` | Implement allocation service (depends on 03a, 03b) |
| 6 | `05-wire-up-runner` | Integrate with runner |
| 7 | `06-simplify-frontend` | Simplify frontend code |
| 8 | `07-cleanup` | Final cleanup |

## Plan Files

- [00-import-boundary.md](./00-import-boundary.md) - Configure tsconfig paths for `@core/*` imports
- [01-adapter-interfaces.md](./01-adapter-interfaces.md) - Define FileSystemAdapter, GitAdapter, PathLock interfaces
- [02a-fs-adapter.md](./02a-fs-adapter.md) - Node filesystem adapter implementation
- [02b-git-adapter.md](./02b-git-adapter.md) - Node git adapter implementation
- [02c-path-lock.md](./02c-path-lock.md) - Node path lock with O_EXCL and stale detection
- [03a-settings-service.md](./03a-settings-service.md) - RepositorySettingsService
- [03b-merge-base-service.md](./03b-merge-base-service.md) - MergeBaseService
- [03c-task-services.md](./03c-task-services.md) - TaskDraftService and TaskMetadataService
- [03d-thread-service.md](./03d-thread-service.md) - ThreadService
- [03e-branch-service.md](./03e-branch-service.md) - BranchService
- [04-worktree-allocation.md](./04-worktree-allocation.md) - WorktreeAllocationService
- [05-wire-up-runner.md](./05-wire-up-runner.md) - Integrate orchestration into runner
- [06-simplify-frontend.md](./06-simplify-frontend.md) - Remove orchestration from frontend
- [07-cleanup.md](./07-cleanup.md) - Final cleanup and workspace→worktree rename

## Guiding Principles

1. **Worktree terminology** - Use "worktree" consistently (not "workspace")
2. **Adapter pattern** - Core business logic in TypeScript, adapters for platform I/O
3. **Thin Rust** - Rust provides low-level primitives only, business logic lives in TypeScript
4. **Single Responsibility Classes** - Each class does ONE thing well
5. **Synchronous Node operations** - Use sync fs/git operations (simpler control flow)

## Success Criteria

- [ ] Runner accepts: `node runner.js --agent planning --task-id xxx --thread-id yyy --prompt "..." --anvil-dir ~/.anvil`
- [ ] Node reads task metadata from disk to get repositoryName
- [ ] Node allocates worktree without any frontend involvement
- [ ] Node creates thread entity on disk and emits `thread:created` event
- [ ] All operations are synchronous (cleanup works on process exit)
- [ ] All "workspace" terminology replaced with "worktree"
