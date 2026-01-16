# Phase 4: Merge Agent

**Dependencies:** 02-settings
**Parallel Group:** B

## Goal

Create the merge agent that executes the configured merge strategy.

---

## 4.1 Agent Registration

**File:** `agents/src/agent-types/index.ts`

```typescript
import { entrypoint } from "./entrypoint.js";
import { execution } from "./execution.js";
import { review } from "./review.js";
import { merge } from "./merge.js";

const agents: Record<string, AgentConfig> = {
  entrypoint,
  execution,
  review,
  merge, // New
};
```

---

## 4.2 Merge Agent Configuration

**File:** `agents/src/agent-types/merge.ts`

```typescript
import type { AgentConfig } from "./index.js";

export const merge: AgentConfig = {
  name: "Merge Agent",
  description: "Integrates completed work into the target branch",
  model: "claude-opus-4-5-20251101",
  tools: { type: "preset", preset: "claude_code" },
  // systemPrompt is built dynamically with merge strategy context
};
```

---

## 4.3 Merge Agent System Prompt Builder

```typescript
export function buildMergeAgentPrompt(
  mergeDestination: MergeDestination,
  mergeMethod: MergeMethod,
  taskBranch: string,
  baseBranch: string
): string {
  return `You are a merge agent responsible for integrating completed work.

## Current Configuration

- **Task Branch:** ${taskBranch}
- **Base Branch:** ${baseBranch}
- **Merge Destination:** ${
    mergeDestination === "local" ? "Local merge" : "Pull Request"
  }
- **Merge Method:** ${mergeMethod === "merge" ? "Merge commit" : "Rebase"}

## Your Job

1. **Verify readiness**: Check that all work is committed on the task branch
   - Run \`git status\` to ensure clean working directory
   - Run \`git log ${baseBranch}..${taskBranch}\` to see commits to be merged

2. **Execute the merge strategy**:
${
  mergeDestination === "local"
    ? `
   **Local Merge Strategy:**
   ${
     mergeMethod === "rebase"
       ? `
   - Checkout the task branch: \`git checkout ${taskBranch}\`
   - Rebase onto base: \`git rebase ${baseBranch}\`
   - If conflicts occur, report them and ask user for guidance
   - After successful rebase, checkout base: \`git checkout ${baseBranch}\`
   - Fast-forward merge: \`git merge ${taskBranch}\`
   `
       : `
   - Checkout the base branch: \`git checkout ${baseBranch}\`
   - Merge the task branch: \`git merge ${taskBranch}\`
   - If conflicts occur, report them and ask user for guidance
   `
   }
`
    : `
   **Pull Request Strategy:**
   - Push the task branch to remote: \`git push -u origin ${taskBranch}\`
   - Create PR using GitHub CLI: \`gh pr create --base ${baseBranch} --head ${taskBranch}\`
   - Include a clear title and description based on the work done
   ${
     mergeMethod === "rebase"
       ? `
   - Before pushing, rebase onto latest base: \`git rebase ${baseBranch}\`
   `
       : ""
   }
`
}

3. **Report the result**:
   - On success: Report what was done (merge commit hash, or PR URL)
   - On failure: Explain what went wrong and ask for user guidance

## Important Notes

- Use \`git\` and \`gh\` CLI commands directly
- If you encounter conflicts, list the conflicting files and stop
- Do NOT force push or use destructive operations without user confirmation
- Verify you're in the correct repository before making changes
`;
}
```

---

## 4.4 Injecting Merge Context

**File:** `src/lib/agent-service.ts` (or equivalent)

```typescript
async function spawnMergeAgent(task: TaskMetadata, threadId: string) {
  const settings = settingsStore.getState();
  const branchInfo = await workspaceService.getTaskBranchInfo(
    task.repositoryName!,
    task.id
  );

  if (!branchInfo) {
    throw new Error("Task branch info not found");
  }

  const systemPrompt = buildMergeAgentPrompt(
    settings.getMergeDestination(),
    settings.getMergeMethod(),
    branchInfo.branch,
    branchInfo.baseBranch
  );

  await spawnAgent({
    type: "merge",
    taskId: task.id,
    threadId,
    systemPromptOverride: systemPrompt,
  });
}
```

---

## Checklist

- [ ] Create `agents/src/agent-types/merge.ts`
- [ ] Register merge agent in `agents/src/agent-types/index.ts`
- [ ] Implement `buildMergeAgentPrompt()` function
- [ ] Add `spawnMergeAgent()` helper in agent service
- [ ] Update agent spawning logic to handle merge agent type
- [ ] Test with local merge strategy
- [ ] Test with PR merge strategy
