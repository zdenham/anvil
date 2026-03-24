# Human Review Request Protocol

## Overview

A simple protocol for agents to request human attention during task execution. The agent invokes a tool that passes markdown content, which is displayed in the action pane for user review.

**Core principles:**
- Agent invokes a simple tool with markdown content
- Markdown is stored in task metadata and displayed in action pane
- User presses Enter to proceed, or types feedback to spawn a new agent
- New agents receive full task context (including prior review history)
- No state machine - state lives in task metadata

---

## Sub-Plans

This protocol is broken into parallelizable implementation tracks:

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [01-types](./01-types.md) | Add TypeScript types for `pendingReview` and `action-requested` event | None |
| [02-cli-command](./02-cli-command.md) | Implement `anvil request-review` CLI command | 01-types |
| [03-action-pane](./03-action-pane.md) | Update frontend action pane to handle pending reviews | 01-types |

### Parallelization

```
01-types ─┬─> 02-cli-command
          │
          └─> 03-action-pane
```

Once types are complete, CLI and action pane work can proceed in parallel.

---

## Example Flow

```
1. User creates task "Add auth feature"
   └─ Agent #1 starts working

2. Agent #1 researches, creates plan
   └─ Calls: anvil request-review --task <id> --default "Start implementation" --markdown "..."
   └─ Agent #1 terminates

3. Action pane shows markdown, placeholder shows "Start implementation"
   └─ User presses Enter

4. New agent #2 spawned with task context + "Start implementation" message
   └─ Agent #2 implements the feature

5. Agent #2 finishes implementation
   └─ Calls: anvil request-review --task <id> --default "Approve" --markdown "..."
   └─ Agent #2 terminates

6. User reviews, types "also add rate limiting"
   └─ New agent #3 spawned with task context + "also add rate limiting"

7. Agent #3 implements rate limiting
   └─ Calls: anvil request-review --task <id> --default "Approve and close" --markdown "..."
   └─ Agent #3 terminates

8. User presses Enter
   └─ New agent #4 spawned with "Approve and close", marks task complete
```

Each agent receives full task context (description, metadata, message history) when spawned from the task workspace view.
