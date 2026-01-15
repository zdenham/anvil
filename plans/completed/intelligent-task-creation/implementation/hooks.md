# UserPromptSubmit Hook

## Purpose

The hook injects task state at the start of every conversation, giving the agent full awareness before it even begins.

## Implementation

**`agents/src/hooks/task-context.ts`** - **NEW**

```typescript
import { readTasksDirectory, getGitState } from "../lib/workspace";

export async function injectTaskContext(
  input: HookInput,
  toolUseId: string,
  context: HookContext
): Promise<HookOutput> {
  if (input.hook_event_name !== "UserPromptSubmit") {
    return {};
  }

  const tasks = await readTasksDirectory(context.workspaceDir);
  const gitState = await getGitState(context.workspaceDir);

  const activeTasks = tasks.filter((t) => t.status === "active");
  const recentTasks = tasks
    .filter((t) => t.status === "completed")
    .slice(0, 5);

  return {
    systemMessage: `## Current Workspace State

### Git
- Branch: ${gitState.currentBranch}
- Uncommitted changes: ${gitState.isDirty ? "yes" : "no"}

### Active Tasks (${activeTasks.length})
${activeTasks.map((t) => `- [${t.slug}] ${t.title} (${t.type})`).join("\n") || "None"}

### Recent Tasks
${recentTasks.map((t) => `- [${t.slug}] ${t.title}`).join("\n") || "None"}

**Remember: Invoke /route skill before doing any work.**`,
  };
}
```

## Workspace Utilities

**`agents/src/lib/workspace.ts`** - **NEW**

Provides:
- `readTasksDirectory(workspaceDir)` - Read all tasks from `.tasks/` directory
- `getGitState(workspaceDir)` - Get current branch and dirty state

## Files to Modify

- `agents/src/hooks/task-context.ts` - **NEW** - UserPromptSubmit hook
- `agents/src/lib/workspace.ts` - **NEW** - readTasksDirectory, getGitState utilities
