# Merge Strategy Implementation Plan

## Overview

Add a configurable "merge strategy" that determines how agent work gets integrated back into the main branch. Tasks can only transition to `complete` after the merge has been successfully executed by the merge agent.

## Requirements

1. **Merge Destination Setting**: How the work gets merged
   - "Merge on local" - Merge directly into local branch
   - "Open a PR" - Create a pull request on the remote

2. **Merge Method Setting**: The git strategy used
   - "Merge" - Standard merge commit
   - "Rebase" - Rebase onto base branch

3. **Task Completion**: Task status transitions to `complete` only after successful execution of the merge strategy by the merge agent

4. **Unified Status System**: Single status system used everywhere (kanban, workspace, etc.)

---

## Sub-Plans

| Plan | Description | Dependencies | Parallel Group |
|------|-------------|--------------|----------------|
| [01-unified-status-system](./01-unified-status-system.md) | New TaskStatus type, remove dual status system | None | A |
| [02-settings](./02-settings.md) | Merge destination/method settings and UI | None | A |
| [03-state-machine](./03-state-machine.md) | Agent mapping, status transitions | 01 | B |
| [04-merge-agent](./04-merge-agent.md) | Merge agent config and prompt builder | 02 | B |
| [05-review-merge-flow](./05-review-merge-flow.md) | Two-phase in_review, action panel logic | 03, 04 | C |
| [06-kanban-ui](./06-kanban-ui.md) | Kanban columns, drag-drop rules | 01 | B |

## Execution Order

```
Group A (parallel):
├── 01-unified-status-system
└── 02-settings

Group B (parallel, after A):
├── 03-state-machine (needs 01)
├── 04-merge-agent (needs 02)
└── 06-kanban-ui (needs 01)

Group C (after B):
└── 05-review-merge-flow (needs 03, 04)
```

## Edge Cases

See [07-edge-cases](./07-edge-cases.md) for handling of:
- Merge conflicts
- PR creation failures
- Dirty working directory
- Branch protection
- Offline mode
- Cancelling during merge
