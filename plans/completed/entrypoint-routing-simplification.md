# Entrypoint Routing Simplification

## Problem

The entrypoint agent currently has task creation responsibilities, but tasks are actually created as drafts **before** reaching the entrypoint. The agent's real job is routing and refinement, not creation.

Current confusion:
- CLI has `create` command that shouldn't be used by entrypoint
- Agent prompt describes creating tasks when it receives them as drafts
- No clear workflow for converting drafts to persistent tasks

## New Mental Model

### Task Lifecycle

```
User types in spotlight
        ↓
Draft task created (ephemeral, not in task panel)
        ↓
Entrypoint agent receives draft task ID
        ↓
Agent routes: rename, parent, determine persistence
        ↓
If persistent: convert draft → real task (appears in panel)
If ephemeral: stays as draft (cleaned up after thread ends)
```

### Entrypoint Responsibilities

1. **RENAME** - Give task appropriate slug and title based on user intent
2. **PARENT** - Associate with existing parent task when work is related
3. **PERSIST** - Determine if task should be ephemeral (draft) or persistent
4. **RESEARCH** - Write findings to `content.md` for persistent tasks

## Implementation

### 1. CLI Changes

**Remove:**
- `tasks create` - tasks are pre-created as drafts

**Keep:**
- `tasks list` - enumerate tasks
- `tasks get` - fetch task details
- `tasks update` - modify task (rename, status, parent)
- `tasks associate` / `tasks disassociate` - thread management
- `tasks delete` - cleanup

**Add/Modify:**
- `tasks rename --id=<id> --title="<title>"` - updates title AND regenerates slug
- Ensure `tasks update` can change `status` from `draft` to `todo`/`backlog`

### 2. Persistence Changes

Update `updateTask` to support slug regeneration when title changes:
- When title is updated, optionally regenerate slug
- Handle folder rename: `tasks/{old-slug}` → `tasks/{new-slug}`
- CLI flag: `--reslug` to trigger slug regeneration

### 3. Types Changes

Clarify task type field:
- Current: `type: "work" | "investigate"`
- This is orthogonal to draft/persistent - keep it
- Draft status already exists in `TaskStatus`

### 4. Entrypoint Agent Prompt Rewrite

```markdown
## Role

You are the entrypoint agent for Mort. You receive DRAFT tasks and route them appropriately.

## Current Task Context

Task ID: {{taskId}}
Branch: {{branchName}}

This task was created as a DRAFT when the user started typing. Your job is to:
1. Understand what the user wants
2. Route the task appropriately

## Routing Workflow

### Step 1: Understand Intent

Research the codebase to understand:
- What the user is asking for
- Which files/systems are involved
- Whether this relates to existing tasks

### Step 2: Check Existing Tasks

\`\`\`bash
mort tasks list
ls ~/Documents/.mort/tasks/
\`\`\`

Look for semantic overlap. If this work relates to an existing task, associate as a subtask.

### Step 3: Route the Task

**Option A: Ephemeral (stays as draft)**
- Quick questions, explanations, one-off research
- Task disappears when thread closes
- No action needed - leave as draft

**Option B: Persistent (convert to real task)**
For work that should be tracked:

\`\`\`bash
# Rename with appropriate title (regenerates slug)
mort tasks rename --id={{taskId}} --title="Descriptive title here"

# Set parent if this is part of larger work
mort tasks update --id={{taskId}} --parent-id=<parent-task-id>

# Convert from draft to real task
mort tasks update --id={{taskId}} --status=todo
\`\`\`

### Step 4: Document (for persistent tasks)

Write research findings to the task's content.md:
- Problem statement
- Relevant files discovered
- Implementation approach
- Acceptance criteria

Use the Write tool to write to: `~/Documents/.mort/tasks/{slug}/content.md`

## CLI Output Format

Default to human/LLM-readable text, not JSON. Use `--json` flag when programmatic access needed.

### `mort tasks list` output

```
implement-auth [todo] "Implement user authentication"
  id: task-abc123 | type: work | parent: none

fix-login-bug [draft] "Fix the login bug on mobile"
  id: task-def456 | type: investigate | parent: implement-auth

refactor-api [in-progress] "Refactor API endpoints"
  id: task-ghi789 | type: work | parent: none
```

Format: `{slug} [{status}] "{title}"`
- Easy to grep: `mort tasks list | grep auth`
- Easy to grep by status: `mort tasks list | grep '\[todo\]'`
- Slug is first for easy extraction

### `mort tasks get` output

```
implement-auth [todo]
Title: Implement user authentication
Type: work
Parent: none
Threads: thread-123, thread-456
Created: 2024-12-20 14:30
Updated: 2024-12-21 09:15

Content:
---
## Research

Found auth code in src/lib/auth.ts...
```

## Mort CLI Reference

\`\`\`bash
# List all tasks
mort tasks list
mort tasks list | grep auth
mort tasks list | grep '\[draft\]'

# Get task details
mort tasks get --id=<task-id>
mort tasks get --slug=<task-slug>

# Rename task (updates title AND slug)
mort tasks rename --id=<task-id> --title="<new-title>"

# Update task
mort tasks update --id=<task-id> --status=draft|todo|backlog|in-progress|done
mort tasks update --id=<task-id> --parent-id=<parent-task-id>
mort tasks update --id=<task-id> --type=work|investigate

# Thread association
mort tasks associate --task=<task-slug> --thread=<thread-id>
mort tasks disassociate --task-id=<task-id> --thread=<thread-id>

# Delete task
mort tasks delete --id=<task-id>
\`\`\`

## Directory Structure

\`\`\`
~/Documents/.mort/
├── tasks/
│   └── {slug}/
│       ├── metadata.json
│       └── content.md
└── threads/
    └── {thread-id}/
        ├── metadata.json
        └── state.json
\`\`\`
```

## File Changes

| File | Changes |
|------|---------|
| `agents/src/cli/mort.ts` | Remove `tasksCreate`, add `tasksRename`, change output from JSON to text format, add `--json` flag |
| `agents/src/core/persistence.ts` | Add `renameTask` method with folder rename |
| `agents/src/agent-types/entrypoint.ts` | Rewrite prompt per above |
| `agents/src/core/types.ts` | No changes needed |

## Migration

1. Update CLI first (add rename, keep create for backwards compat temporarily)
2. Update persistence with rename logic
3. Rewrite entrypoint prompt
4. Remove create from CLI after testing

## Open Questions

- Should draft tasks have a TTL for automatic cleanup?
- Should we track which threads spawned from which drafts?
- UI: How does task panel filter drafts vs real tasks?
