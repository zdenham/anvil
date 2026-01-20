# Explicit Worktree Management - Sub-Plans

This directory contains decomposed sub-plans for the explicit worktree management feature. These plans are optimized for parallel execution by multiple agents.

## Dependency Graph

```
                    ┌─────────────────────┐
                    │   00 - Dead Code    │
                    │     Deletion        │
                    │   (MUST RUN FIRST)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌────────────────┐ ┌────────────────┐     │
     │ 01 - Data Model│ │ 02 - Tauri Cmds│     │
     │ & Core Service │ │ & FE Service   │     │
     └───────┬────────┘ └───────┬────────┘     │
             │                  │              │
             │    ┌─────────────┼──────────────┘
             │    │             │
             │    ▼             ▼
             │ ┌────────────────────────────┐
             │ │  03 - Worktrees Tab UI     │◄──┐
             │ └────────────────────────────┘   │
             │                                  │ PARALLEL
             │ ┌────────────────────────────┐   │
             │ │  04 - Spotlight Selection  │◄──┘
             │ └──────────────┬─────────────┘
             │                │
             └────────┬───────┘
                      │
                      ▼
           ┌─────────────────────┐
           │ 05 - Task Creation  │
           │  Flow Integration   │
           │    (FINAL STEP)     │
           └─────────────────────┘
```

## Execution Order for Maximum Parallelism

### Wave 1 (Sequential - Blocking)
- **00-dead-code-deletion.md** - Must complete first. Unblocks everything.

### Wave 2 (Parallel - 2 agents)
After Wave 1 completes, run simultaneously:
- **01-data-model-and-core-service.md** - Core types and WorktreeService
- **02-tauri-commands-and-frontend-service.md** - Rust commands and TS client

### Wave 3 (Parallel - 2 agents)
After Wave 2 completes, run simultaneously:
- **03-worktrees-tab-ui.md** - Main window UI for managing worktrees
- **04-spotlight-worktree-selection.md** - Spotlight integration for selection

### Wave 4 (Sequential - Blocking)
After Waves 2 and 3 complete:
- **05-task-creation-flow-integration.md** - Final wiring and cleanup

## Sub-Plan Summary

| Plan | Description | Dependencies | Parallelizable With |
|------|-------------|--------------|---------------------|
| 00 | Delete pooling/allocation dead code | None | Nothing (runs first) |
| 01 | Data model + core WorktreeService | 00 | 02 |
| 02 | Tauri commands + frontend service | 00 | 01 |
| 03 | Worktrees tab in main window | 02 | 04 |
| 04 | Spotlight worktree selection | 02 | 03 |
| 05 | Task creation flow integration | 01, 04 | Nothing (runs last) |

## Estimated Effort

| Plan | Complexity | Files Changed |
|------|------------|---------------|
| 00 | Medium | 10+ files (mostly deletions) |
| 01 | Medium | 4 files |
| 02 | Medium | 3 files |
| 03 | Low-Medium | 3 files |
| 04 | Medium | 2-3 files |
| 05 | Medium | 4-5 files |

## Original Plan Reference

The parent plan is at `../explicit-worktree-management.md`. These sub-plans extract and organize the implementation phases for parallel execution.
