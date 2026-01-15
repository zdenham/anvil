# Route Skill

**`agents/skills/route.md`** - **NEW**

This skill is invoked liberally—on almost every request. It guides the agent through task routing decisions.

## Skill Content

```markdown
# /route - Task Routing

**Invoke this skill BEFORE doing any work.** The only exception is truly trivial questions.

## Your Task

You have workspace context injected via hook. Now decide how to route this request:

1. **Check existing tasks first** - Does this relate to an active or recent task?
2. **Associate if relevant** - Semantic match? Same feature area? Continuation?
3. **Create only when needed** - No existing task fits? Distinctly new work?
4. **Subtask for scoped work** - Part of a larger task? Bug found during other work?

## Decision Tree

\`\`\`
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
\`\`\`

## Execute Routing

Once decided, run the appropriate CLI command:

\`\`\`bash
# Associate with existing task
mort tasks associate --task=<slug>

# Create new task
mort tasks create --title="<title>" --type=work|investigate

# Create subtask
mort tasks create-subtask --parent=<slug> --title="<title>"
\`\`\`

## After Routing

The CLI will output the task context. Then:
1. Switch to the task's git branch (if different)
2. Acknowledge the task context to the user briefly
3. Proceed with the actual work

## Task Types

- **work**: Code changes, implementations, bug fixes, refactoring
- **investigate**: Research, understanding, explanations, debugging

## Guidelines

- **Default to association** when there's semantic overlap
- **Descriptive titles** that capture intent (not generic like "fix bug")
- **One task per distinct effort** - don't fragment related work
- **Check git state** before switching branches (warn if dirty)
```

## Files to Modify

- `agents/skills/route.md` - **NEW** - routing skill instructions
