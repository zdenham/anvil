# System Prompt Consistency

**File:** `agents/src/agent-types/shared-prompts.ts`
**Parallel:** Yes (no dependencies)

## Problem

Agent system prompts don't match actual CLI functionality:
- Status values incomplete
- Missing `--json` flag documentation
- Update command missing flags

## Solution

### Step 1: Update `ANVIL_CLI_CORE`

Replace with:

```typescript
export const ANVIL_CLI_CORE = `## Anvil CLI Reference

\`\`\`bash
# Get task details
anvil tasks get --id=<task-id>
anvil tasks get --slug=<task-slug>

# Update task status
anvil tasks update --id=<task-id> --status=<status>
# Kanban: draft|backlog|todo|in-progress|done
# Workspace: pending|in_progress|paused|completed|merged|cancelled

# List tasks
anvil tasks list
anvil tasks list | grep '<pattern>'

# All commands support --json for programmatic output
\`\`\``;
```

### Step 2: Update `ANVIL_CLI_TASK_MANAGEMENT`

Replace with:

```typescript
export const ANVIL_CLI_TASK_MANAGEMENT = `### Task Management

\`\`\`bash
# Rename task (updates title AND regenerates slug)
anvil tasks rename --id=<task-id> --title="<new-title>"

# Update task properties
anvil tasks update --id=<task-id> --parent-id=<parent-task-id>
anvil tasks update --id=<task-id> --type=work|investigate
anvil tasks update --id=<task-id> --tags="tag1,tag2"
anvil tasks update --id=<task-id> --description="Description"

# Thread association
anvil tasks associate --task=<task-slug> --thread=<thread-id>
anvil tasks disassociate --task-id=<task-id> --thread=<thread-id>

# Delete task
anvil tasks delete --id=<task-id>
\`\`\``;
```

## Verification

- Review that prompts match actual CLI behavior
- Ensure status values are complete
- Confirm all flags are documented
