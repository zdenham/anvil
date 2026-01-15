# UI Isolation Testing - Sub-Plans Overview

## Purpose

This plan enables fast, deterministic UI testing without Tauri, Rust, or filesystem dependencies. Tests run in milliseconds using happy-dom, with all backend interactions mocked at module boundaries.

**Why this matters:** The Mort UI depends heavily on Tauri IPC and filesystem state. Without isolation testing, UI changes require full app startup and manual verification. These tests enable confident refactoring and catch regressions before they reach E2E tests.

## Success Criteria

This work is complete when:

1. `TestStores` class exists and clears all Zustand stores between tests
2. `renderWithRouter` helper supports testing routed components
3. All major component areas have `data-testid` attributes
4. At least one working `.ui.test.tsx` file validates the full setup
5. User decisions (coverage, entity listeners, CSS strategy, factories) are resolved

## Sub-Plans

### Critical Path

These must complete before writing actual tests:

| Plan | Description | Est. Time | Priority |
|------|-------------|-----------|----------|
| [`01-test-stores.md`](./01-test-stores.md) | Create `TestStores` class for Zustand seeding/clearing | 30 min | **Critical** |
| [`04-user-decisions.md`](./04-user-decisions.md) | Resolve coverage, entity listeners, CSS, and factory decisions | 15 min | **Critical** |

### Infrastructure (Parallel with Critical Path)

| Plan | Description | Est. Time | Priority |
|------|-------------|-----------|----------|
| [`02-router-integration.md`](./02-router-integration.md) | Add `renderWithRouter` helper for route params | 15 min | Medium |

### Test IDs (Parallel, Start Any Time)

Each can be done independently. Start with components you plan to test first.

| Plan | Description | Est. Time | Components Affected |
|------|-------------|-----------|---------------------|
| [`03a-testid-task-components.md`](./03a-testid-task-components.md) | Test IDs for task list, card, status | 20 min | TaskList, TaskCard, TaskStatusBadge |
| [`03b-testid-thread-components.md`](./03b-testid-thread-components.md) | Test IDs for thread panel, messages | 20 min | ThreadPanel, MessageList, MessageItem |
| [`03c-testid-kanban-components.md`](./03c-testid-kanban-components.md) | Test IDs for kanban board | 20 min | KanbanBoard, KanbanColumn, KanbanCard |
| [`03d-testid-common-components.md`](./03d-testid-common-components.md) | Test IDs for shared components | 15 min | LoadingSpinner, ErrorMessage, EmptyState |

### First Tests (Blocked Until Phase 1 Complete)

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [`05-first-tests.md`](./05-first-tests.md) | Write first real `.ui.test.tsx` files | 01, at least one 03x, 04 |

## Dependency Graph

```
                        +-----------------------+
                        |   04-user-decisions   |
                        |  (blocks test style)  |
                        +-----------+-----------+
                                    |
     +------------------+           |           +-------------------+
     |  01-test-stores  |           |           |    03-testid-*    |
     |    (critical)    +-----------+-----------+   (4 sub-plans)   |
     +--------+---------+           |           +---------+---------+
              |                     v                     |
              |           +------------------+            |
              +---------->|  05-first-tests  |<-----------+
                          +------------------+
     +------------------+           ^
     |    02-router     |-----------+
     |    (optional)    |  (only for routed components)
     +------------------+
```

## Status Tracking

| Plan | Status | Owner | Blockers | Last Updated |
|------|--------|-------|----------|--------------|
| 01-test-stores | Not Started | | None | |
| 02-router-integration | Not Started | | None | |
| 03a-testid-task | Not Started | | None | |
| 03b-testid-thread | Not Started | | None | |
| 03c-testid-kanban | Not Started | | None | |
| 03d-testid-common | Not Started | | None | |
| 04-user-decisions | Not Started | | Needs user input | |
| 05-first-tests | **Complete** | | None | 2026-01-07 |

## Execution Strategy

### Recommended Approach (Solo Developer)

1. Start with `04-user-decisions.md` - get user input while working on infrastructure
2. Complete `01-test-stores.md` - this unblocks actual tests
3. Pick one `03x` plan based on which component you want to test first
4. Complete `05-first-tests.md` to validate the setup
5. Add remaining test IDs as needed for new tests

### Parallel Agents (Maximum Throughput)

- **Agent 1:** `01-test-stores.md` then `02-router-integration.md`
- **Agent 2-5:** One each for `03a`, `03b`, `03c`, `03d`
- **User:** Review `04-user-decisions.md` in parallel
- **Final Agent:** `05-first-tests.md` once dependencies complete

## Context

- **Parent Plan:** [`../ui-isolation-testing.md`](../ui-isolation-testing.md) - Full context, type documentation, troubleshooting
- **Architecture Docs:** [`docs/patterns/entity-stores.md`](../../docs/patterns/entity-stores.md) - Zustand store patterns
- **Test Infrastructure:** Already complete in `src/test/` - VirtualFS, TestEvents, mocks
