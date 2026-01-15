# Execution Agent Content Path Fix

## Problem Summary

Two related issues prevent the execution agent from finding `content.md`:

### Issue 1: Agent doesn't know the path to content.md

The execution agent system prompt says "Read the plan in content.md" but never specifies WHERE that file is. The agent incorrectly assumes:
```
{workingDirectory}/.mort/tasks/{slug}/content.md
```

But the actual path is:
```
{mortDir}/tasks/{slug}/content.md
```

Where `mortDir` is the centralized data directory (e.g., `~/.mort-dev`), separate from the code repository.

### Issue 2: Human message includes instructions that should be in system prompt

The `buildProgressionPrompt` function in `task-workspace.tsx` creates a human message:
```
The research and planning phase is complete. The user has approved the plan.

Task: Add aloha to README
Approval: Approve

Please read the task content.md for the detailed plan and begin implementation.
```

This has two problems:
1. Instructions belong in system prompt, not human message
2. It still doesn't specify the actual path to content.md

## Root Cause Analysis

**Execution agent** (`agents/src/agent-types/execution.ts`):
- Missing `DIRECTORY_STRUCTURE` from shared prompts
- WORKFLOW says "Check the task's `content.md`" without path
- GUIDELINES says "Read the plan in content.md" without path

**Planning agent** correctly includes:
- `DIRECTORY_STRUCTURE` which shows `{{mortDir}}/tasks/{slug}/content.md`
- Explicit path: `{{mortDir}}/tasks/{{slug}}/content.md`

## Cleanest Solution: Use `mort tasks get`

The `mort` CLI already solves the path resolution problem. Looking at `mort.ts:399-403`:
```typescript
// Try to include content if available
const content = await persistence.getTaskContent(task.slug);
if (content) {
  console.log(`\nContent:\n---\n${content}`);
}
```

So `mort tasks get --id=<task-id>` returns BOTH metadata AND content.md contents!

The execution agent should use this instead of trying to Read the file directly.

## Implementation Plan

### Step 1: Update execution agent system prompt

**File:** `agents/src/agent-types/execution.ts`

Changes:
1. Import `DIRECTORY_STRUCTURE` from shared-prompts
2. Add it to `composePrompt()`
3. Update WORKFLOW to be explicit about using CLI:

```typescript
const WORKFLOW = `## Workflow

1. **Get the plan** - Run \`mort tasks get --id={{taskId}}\` to see the task details and implementation plan
2. **Implement incrementally** - Make changes file by file
3. **Commit per file** - After editing each file, commit it with a clear message
4. **Update status** - Use \`mort\` to update task status as you progress
5. **Verify** - Run tests/builds to ensure changes work`;
```

4. Update GUIDELINES similarly

### Step 2: Simplify human message in task-workspace.tsx

**File:** `src/components/workspace/task-workspace.tsx`

Change `buildProgressionPrompt` for execution case:

```typescript
case "execution":
  return `Task: ${task.title}
Approval: ${approvalMessage}

Begin implementation.`;
```

The system prompt already tells the agent to use `mort tasks get` - no need to repeat instructions in the human message.

### Step 3: Ensure MORT_DATA_DIR is set (already done)

**File:** `agents/src/runner.ts:251-253`
```typescript
// Set MORT_DATA_DIR env var so the `mort` CLI can find the correct data directory
process.env.MORT_DATA_DIR = args.mortDir;
```

This is already implemented correctly.

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/agent-types/execution.ts` | Add `DIRECTORY_STRUCTURE`, update WORKFLOW to use CLI for plan retrieval |
| `src/components/workspace/task-workspace.tsx` | Simplify `buildProgressionPrompt` for execution case |

## Verification

After changes:
1. The execution agent should run `mort tasks get --id=<task-id>` as its first action
2. It should NOT try to Read from `.mort/tasks/...` in the working directory
3. Human message should be simple task context, not instructions
