# Agent Task ID vs Slug Confusion

## Problem Statement

Agents are passing the task **slug** (e.g., `fix-auth-bug`) to `mort` CLI commands that expect the **task ID** (e.g., `task-m1abcdef-xyz123`), causing command failures.

## Root Cause Analysis

### 1. Data Model

Tasks have two identifiers (`core/types/tasks.ts:50-52`):
- **`id`**: Unique identifier format `task-{timestamp}-{random}` (e.g., `task-m1abcdef-xyz123`)
- **`slug`**: URL-safe, human-readable identifier from title (e.g., `fix-auth-bug`)

The **slug** is used as the filesystem directory key:
```
.mort/tasks/{slug}/metadata.json    # Contains both id and slug
.mort/tasks/{slug}/content.md
```

### 2. Bug Location: `runner.ts:221`

```typescript
// Line 219-221 in agents/src/runner.ts
const taskSlug = orchestrationResult.taskSlug;
const taskBranch = orchestrationResult.branch;
const taskId = orchestrationResult.taskSlug; // BUG: taskSlug assigned to taskId!
```

The `OrchestrationResult` interface (`orchestration.ts:35-42`) only has `taskSlug`, not `taskId`. The code incorrectly assigns the slug to a variable named `taskId`.

### 3. Propagation to Agent Prompts

This incorrect `taskId` is passed to `buildAppendedPrompt()` (`runner.ts:294-295`):

```typescript
const appendedPrompt = buildAppendedPrompt(agentConfig, {
  taskId: taskId,    // Actually contains the slug!
  slug: taskSlug,    // Also the slug (same value)
  ...
});
```

Then template interpolation (`runner.ts:93-94`) sets both `{{taskId}}` and `{{slug}}` to the same slug value:

```typescript
prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? "none");
prompt = prompt.replace(/\{\{slug\}\}/g, context.slug ?? "none");
```

### 4. Agent Prompts Use `--id` Flag

The shared prompts (`agent-types/shared-prompts.ts:7-12`) tell agents:

```
Task ID: {{taskId}}
Use `mort tasks get --id={{taskId}}` to fetch current task state.
```

So agents see:
```
Task ID: fix-auth-bug
Use `mort tasks get --id=fix-auth-bug` to fetch current task state.
```

And run `mort tasks get --id=fix-auth-bug` which fails because `--id` expects the actual ID format.

## Impact

- `mort tasks get --id=<slug>` fails (scans all tasks, finds no matching ID)
- `mort tasks update --id=<slug> --status=...` fails
- `mort tasks rename --id=<slug> --title=...` fails
- Any mutation command using `--id` with the slug fails

## Proposed Solutions

### Option A: Fix the Source (Recommended)

Fetch the actual task ID from persistence and pass it correctly.

**Changes:**

1. **`orchestration.ts`**: Return both `taskSlug` and `taskId` in `OrchestrationResult`
   ```typescript
   export interface OrchestrationResult {
     taskSlug: string;
     taskId: string;    // Add real task ID
     // ... existing fields
   }
   ```

2. **`orchestration.ts` logic**: Look up task metadata by slug to get the real ID
   ```typescript
   const task = await persistence.findTaskBySlug(taskSlug);
   return {
     taskSlug,
     taskId: task.id,
     // ...
   };
   ```

3. **`runner.ts:221`**: Use the correct ID
   ```typescript
   const taskSlug = orchestrationResult.taskSlug;
   const taskId = orchestrationResult.taskId; // Now the real ID
   ```

**Pros:**
- Agents get accurate data
- `--id` commands work correctly
- Both `{{taskId}}` and `{{slug}}` have correct, distinct values

**Cons:**
- None - we already read task metadata in `orchestrate()` at line 109, just need to include `taskMeta.id` in the return

### Option B: Update Prompts to Use `--slug`

Change prompts to use `--slug` instead of `--id`.

**Changes in `shared-prompts.ts`:**

```typescript
export const TASK_CONTEXT = `## Current Task Context

Task Slug: {{slug}}
Branch: {{branchName}}

Use \`mort tasks get --slug={{slug}}\` to fetch current task state.`;

export const MORT_CLI_CORE = `## Mort CLI Reference

\`\`\`bash
# Get task details (prefer --slug for efficiency)
mort tasks get --slug=<task-slug>

# Update task status
mort tasks update --slug=<task-slug> --status=<status>
...
```

**Pros:**
- Minimal code changes
- Uses efficient O(1) slug lookup instead of O(n) ID scan

**Cons:**
- Doesn't fix the underlying data problem (taskId variable is still wrong)
- Some commands may truly require the ID (checking needed)

### Option C: Both Fixes

Implement Option A and also update prompts to prefer `--slug` where applicable for performance.

## Recommendation

**Option A** is recommended because:
1. Fixes the root cause - agents get accurate data
2. Both identifiers available for their appropriate uses
3. Prevents future confusion if other code relies on `taskId`

Option B could be a quick interim fix if needed immediately.

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/orchestration.ts` | Add `taskId` to `OrchestrationResult`, look up real ID |
| `agents/src/runner.ts:221` | Use `orchestrationResult.taskId` |
| `agent-types/shared-prompts.ts` | (Optional) Clarify both identifiers in prompts |

## Testing

1. Start a new agent on a task
2. Have agent run `mort tasks get --id={{taskId}}`
3. Verify the command succeeds with the real task ID
4. Test task mutations (`update`, `rename`) work correctly
