# Thread Branch Attachment: Parallel Execution Overview

## Problem Summary

Commits are orphaned on detached HEAD because worktrees never attach to task branches. Additionally, merge base computation is stale (uses local HEAD instead of `origin/{defaultBranch}`).

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 1 (Parallel)                                │
│  ┌─────────────────────────┐     ┌─────────────────────────────────────┐    │
│  │  01-types-and-schema    │     │  02-git-adapter-extensions          │    │
│  │  - RepositorySettings   │     │  - GitAdapter interface             │    │
│  │  - WorktreeClaim        │     │  - Node implementation              │    │
│  │  - WorktreeState        │     │  - Unit tests                       │    │
│  └─────────────────────────┘     └─────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 2 (Parallel)                                │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │ 03-branch-manager  │  │ 04-pool-manager     │  │ 05-settings-migration│  │
│  │ - BranchManager    │  │ - WorktreePoolMgr   │  │ - Schema migration   │  │
│  │ - ensureBranch()   │  │ - Selection logic   │  │ - Load/save updates  │  │
│  │ - Unit tests       │  │ - Claim logic       │  │ - Unit tests         │  │
│  └────────────────────┘  └─────────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 3 (Sequential)                              │
│           ┌─────────────────────────────────────────────────┐               │
│           │  06-allocation-service-refactor                 │               │
│           │  - Refactor to thin orchestration layer         │               │
│           │  - Inject BranchManager, WorktreePoolManager    │               │
│           │  - Fix merge base computation                   │               │
│           │  - Update tests                                 │               │
│           └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 4 (Sequential)                              │
│           ┌─────────────────────────────────────────────────┐               │
│           │  07-orchestration-integration                   │               │
│           │  - Pass taskId and taskBranch to allocate()     │               │
│           │  - Update orchestrate() in agents               │               │
│           └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Execution Strategy

### Phase 1: Foundation (Parallel)
Two engineers can work simultaneously:
- **Engineer A**: Types and schema (`01-types-and-schema.md`)
- **Engineer B**: GitAdapter extensions (`02-git-adapter-extensions.md`)

### Phase 2: Service Classes (Parallel)
Three engineers can work simultaneously after Phase 1:
- **Engineer A**: BranchManager (`03-branch-manager.md`)
- **Engineer B**: WorktreePoolManager (`04-pool-manager.md`)
- **Engineer C**: Settings migration (`05-settings-migration.md`)

### Phase 3: Integration (Sequential)
After Phase 2, one engineer integrates:
- AllocationService refactor (`06-allocation-service-refactor.md`)

### Phase 4: Final Integration (Sequential)
After Phase 3:
- Orchestration integration (`07-orchestration-integration.md`)

## Files Modified Per Plan

| Plan | Files |
|------|-------|
| 01 | `src/entities/repositories/types.ts` |
| 02 | `core/adapters/types.ts`, `core/adapters/node/git-adapter.ts`, `core/adapters/node/git-adapter.test.ts` |
| 03 | `core/services/worktree/branch-manager.ts` (NEW), `core/services/worktree/branch-manager.test.ts` (NEW) |
| 04 | `core/services/worktree/worktree-pool-manager.ts` (NEW), `core/services/worktree/worktree-pool-manager.test.ts` (NEW) |
| 05 | `core/services/worktree/settings-service.ts` |
| 06 | `core/services/worktree/allocation-service.ts`, `core/services/worktree/allocation-service.test.ts` |
| 07 | `agents/src/orchestration.ts` |

## Merge Conflicts Risk

Low risk - each plan touches distinct files except:
- Plan 01 and 04/05 both touch types → Plan 01 must complete first
- Plan 06 imports from 03, 04, 05 → Must wait for Phase 2
