# Intelligent Task Creation

## Overview

Move task creation from being programmatic (before conversation) to being a tool the main agent can call. The agent ensures almost every thread is associated with a task, routing intelligently between:

1. **Associate with an existing task** (preferred when relevant) → checks out existing task branch
2. **Create a new task** → creates new git branch with slugified name
3. **Create a subtask** under an existing task → uses parent task's branch
4. **Handle directly** (rare - only truly trivial questions)

**Core principle: Threads should rarely exist without a task.** This doesn't mean creating new tasks constantly—it means intelligently matching requests to existing tasks or creating new ones only when needed. The agent investigates existing tasks before deciding.

## Sub-Plans

| Plan | Description |
|------|-------------|
| [Routing Architecture](./routing-architecture.md) | Hook + Skill approach for zero-overhead routing |
| [Task Routing Logic](./task-routing-logic.md) | When to associate, create, or handle directly |
| [Branch Management](./branch-management.md) | Naming conventions, conflicts, and git operations |
| [Implementation](./implementation/) | Detailed implementation specs |
| [Challenges](./challenges.md) | Known challenges and mitigations |

## Implementation Sub-Plans

| Plan | Description |
|------|-------------|
| [CLI Commands](./implementation/cli-commands.md) | Task management CLI interface |
| [Data Model](./implementation/data-model.md) | Task and Thread type changes |
| [Hooks](./implementation/hooks.md) | UserPromptSubmit hook for context injection |
| [Route Skill](./implementation/route-skill.md) | The /route skill instructions |
| [Main Agent](./implementation/main-agent.md) | Main agent configuration |
| [Git Utilities](./implementation/git-utilities.md) | Git helper functions |
| [Runner Updates](./implementation/runner-updates.md) | Changes to the agent runner |
| [Spotlight Changes](./implementation/spotlight-changes.md) | UI changes for null taskId |

## Files to Modify

See [implementation/files-to-modify.md](./implementation/files-to-modify.md) for the complete list.
