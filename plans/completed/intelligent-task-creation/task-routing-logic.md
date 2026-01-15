# Task Routing Logic

**Default: Every thread should have a task.** The router's job is to find the right task—existing or new.

## Associate with Existing Task (Check First)

Always check for existing tasks before creating new ones:

- Request relates to an active or recent task
- User references a task by name, ID, or related topic
- Semantic match to existing task (similar keywords, same feature area)
- Explicit continuation of previous work
- Follow-up questions on a task's topic

## Create New Task

Create a new task when no existing task is a good fit:

- Distinctly new work not covered by existing tasks
- New feature or bug unrelated to current tasks
- Questions requiring investigation with no existing context
- User explicitly requests starting fresh

## Create Subtask

- Scoped sub-work under an existing task
- Bug discovered while working on a parent task
- Discrete deliverable within a larger effort

## Handle Directly (Rare)

Only for truly trivial requests that need no tracking:

- "What time is it?"
- "How do I exit vim?" (one-liner answers)
- Greetings

## Task Types

- **work**: Code changes, implementations, bug fixes, refactoring
- **investigate**: Research, understanding, explanations, debugging

## Decision Tree

```
Is this a trivial question (greeting, one-liner)?
  → YES: Skip routing, answer directly
  → NO: Continue...

Does this relate to an ACTIVE task?
  → YES: Associate with that task
  → NO: Continue...

Does this relate to a RECENT task?
  → YES: Consider re-activating or associating
  → NO: Continue...

Is this scoped work under an existing task?
  → YES: Create subtask
  → NO: Create new task
```

## Guidelines

- **Default to association** when there's semantic overlap
- **Descriptive titles** that capture intent (not generic like "fix bug")
- **One task per distinct effort** - don't fragment related work
- **Check git state** before switching branches (warn if dirty)
