# Merge Agent Improvements

## Background

The merge agent was implemented per `plans/merge-strategy/04-merge-agent.md` but the current implementation has several issues that need addressing.

## Current Issues

### 1. No Worktree Context Provided

The agent receives branch names but not the actual paths:
- Must discover worktree paths via `git worktree list` at runtime
- No explicit path for current worktree or main worktree
- Instructions use placeholder `<base-worktree-path>` instead of concrete values

### 2. Two Inconsistent Implementations

Prompt builders exist in two places with different logic:

| Location | Behavior | Status |
|----------|----------|--------|
| `agents/src/agent-types/merge.ts:103-169` | Has worktree discovery step, uses `git -C <path>` | **DEAD CODE** - never imported |
| `src/lib/agent-service.ts:741-820` | Assumes single worktree, uses `git checkout ${baseBranch}` | **ACTUALLY USED** |

The agent-service version is what runs in production, but it will fail in multi-worktree setups because you can't checkout a branch that's checked out elsewhere.

### 3. Overly Conservative Conflict Handling

Current approach (from `agents/src/agent-types/merge.ts:26-32`):
```
If you encounter merge conflicts:
1. List the conflicting files clearly
2. Request human review with the conflict details
3. Do NOT force resolve conflicts without user guidance
```

This defeats the purpose of an autonomous agent. Simple conflicts (different parts of file, additive changes) should be resolvable without human intervention.

### 4. Strategy Instructions Not in Base Prompt

The base `appendedPrompt` says "see strategy-specific instructions below" but those instructions are injected separately via `buildMergeAgentPrompt()`. If the injection doesn't happen, the agent has incomplete guidance.

---

## Implementation Plan

**Key Decision:** Consolidate all prompt logic into the **system prompt** (`agents/src/agent-types/merge.ts`). Remove the user prompt building from `agent-service.ts` entirely.

### Phase 1: Add MergeContext and Worktree Support

**Goal:** Provide explicit paths instead of requiring runtime discovery.

#### 1.1 Add MergeContext Interface

**File:** `agents/src/agent-types/merge-types.ts`

```typescript
export interface MergeContext {
  taskBranch: string;
  baseBranch: string;
  taskWorktreePath: string;   // Where task branch is checked out
  mainWorktreePath: string;   // Where base branch is checked out (source repo)
  mergeDestination: MergeDestination;
  mergeMethod: MergeMethod;
}
```

#### 1.2 Update WorkspaceService Interface

**File:** `src/lib/workspace-service.ts`

Add two new methods to the `WorkspaceService` interface:

```typescript
export interface WorkspaceService {
  // ... existing methods ...

  /**
   * Find the worktree currently claimed by a task.
   * Returns null if no worktree is claimed by this task.
   *
   * Note: This is a read-only operation - no locking required.
   */
  getWorktreeForTask(repoName: string, taskId: string): Promise<WorktreeState | null>;

  /**
   * Get the source repository path (the original repo, not a worktree).
   * This is where the base branch (e.g., main) is checked out.
   */
  getSourceRepoPath(repoName: string): Promise<string>;
}
```

#### 1.3 Implement getWorktreeForTask

**File:** `src/lib/workspace-service.ts`

Add to `createWorkspaceService()` return object:

```typescript
async getWorktreeForTask(
  repoName: string,
  taskId: string
): Promise<WorktreeState | null> {
  // Read-only operation - no lock needed
  const settings = await loadSettings(repoName);

  // Find worktree with a claim matching this taskId
  const worktree = settings.worktrees.find(
    (w) => w.claim?.taskId === taskId
  );

  return worktree ?? null;
},
```

**Behavior:**
- Returns the `WorktreeState` if a worktree has an active claim for this task
- Returns `null` if no worktree is claimed (task may not have started, or worktree was released)
- Does not require locking since it's read-only

#### 1.4 Implement getSourceRepoPath

**File:** `src/lib/workspace-service.ts`

Add to `createWorkspaceService()` return object:

```typescript
async getSourceRepoPath(repoName: string): Promise<string> {
  // Delegates to existing fsCommands helper
  return fsCommands.getRepoSourcePath(repoName);
},
```

**Behavior:**
- Returns the absolute path to the original repository (e.g., `/Users/dev/projects/myrepo`)
- This is NOT a anvil-managed worktree - it's the user's actual repo
- The base branch (main/master) is typically checked out here

#### 1.5 Export from workspace-service

Ensure both methods are available on the singleton:

```typescript
// The singleton already exports the service, so the new methods
// will be available via workspaceService.getWorktreeForTask() etc.
export const workspaceService = createWorkspaceService();
```

---

### Phase 2: Rewrite System Prompt with Dynamic Context

**Goal:** The system prompt should be complete and executable. The user prompt is just "execute the merge".

#### 2.1 Update buildMergeAgentPrompt Signature

**File:** `agents/src/agent-types/merge.ts`

```typescript
export function buildMergeAgentPrompt(context: MergeContext): string {
  const { taskBranch, baseBranch, taskWorktreePath, mainWorktreePath, mergeDestination, mergeMethod } = context;

  return composePrompt(
    ROLE,
    buildEnvironmentSection(context),
    buildStrategyInstructions(context),
    CONFLICT_HANDLING,
    SAFETY_GUIDELINES,
    ANVIL_CLI_CORE,
    HUMAN_REVIEW_TOOL,
    GUIDELINES
  );
}
```

#### 2.2 Add Environment Section

```typescript
function buildEnvironmentSection(context: MergeContext): string {
  return `## Environment

- **Task Worktree:** \`${context.taskWorktreePath}\`
  - Branch: \`${context.taskBranch}\`
- **Main Worktree:** \`${context.mainWorktreePath}\`
  - Branch: \`${context.baseBranch}\`

You are currently in the task worktree. Use \`git -C ${context.mainWorktreePath}\` for operations on the main worktree.`;
}
```

#### 2.3 Strategy Instructions Router

```typescript
function buildStrategyInstructions(context: MergeContext): string {
  const { mergeDestination, mergeMethod } = context;

  if (mergeDestination === 'local') {
    return mergeMethod === 'rebase'
      ? buildRebaseLocalInstructions(context)
      : buildMergeLocalInstructions(context);
  } else {
    return mergeMethod === 'rebase'
      ? buildRebasePRInstructions(context)
      : buildMergePRInstructions(context);
  }
}
```

#### 2.4 Rebase + Local Strategy

```typescript
function buildRebaseLocalInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch, mainWorktreePath } = context;

  return `## Merge Workflow: Rebase + Local

1. **Verify clean state:**
   \`\`\`bash
   git status  # Must show "nothing to commit, working tree clean"
   \`\`\`

2. **Fetch latest from remote:**
   \`\`\`bash
   git fetch origin ${baseBranch}
   \`\`\`

3. **Rebase task branch onto base:**
   \`\`\`bash
   git rebase origin/${baseBranch}
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section
   - After resolving each conflict: \`git add <file> && git rebase --continue\`

4. **Push rebased branch and merge in main worktree:**
   \`\`\`bash
   git push origin ${taskBranch} --force-with-lease
   git -C ${mainWorktreePath} fetch origin ${taskBranch}
   git -C ${mainWorktreePath} merge origin/${taskBranch} --ff-only
   \`\`\`
   - If --ff-only fails, the rebase didn't complete successfully

5. **Report result:**
   \`\`\`bash
   git -C ${mainWorktreePath} log -1 --format="%H %s"
   \`\`\`
   - Report the commit hash and request human review to confirm`;
}
```

#### 2.5 Merge + Local Strategy

```typescript
function buildMergeLocalInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch, mainWorktreePath } = context;

  return `## Merge Workflow: Merge + Local

1. **Verify clean state:**
   \`\`\`bash
   git status
   \`\`\`

2. **Merge base into task branch (resolve conflicts here):**
   \`\`\`bash
   git fetch origin ${baseBranch}
   git merge origin/${baseBranch}
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section

3. **Push task branch and merge in main worktree:**
   \`\`\`bash
   git push origin ${taskBranch}
   git -C ${mainWorktreePath} fetch origin ${taskBranch}
   git -C ${mainWorktreePath} merge origin/${taskBranch}
   \`\`\`

4. **Report result:**
   \`\`\`bash
   git -C ${mainWorktreePath} log -1 --format="%H %s"
   \`\`\`
   - Report the commit hash and request human review to confirm`;
}
```

#### 2.6 PR Strategies

```typescript
function buildRebasePRInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch } = context;

  return `## Merge Workflow: Rebase + Pull Request

1. **Verify clean state:**
   \`\`\`bash
   git status
   \`\`\`

2. **Fetch and rebase onto base:**
   \`\`\`bash
   git fetch origin ${baseBranch}
   git rebase origin/${baseBranch}
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section

3. **Push rebased branch:**
   \`\`\`bash
   git push origin ${taskBranch} --force-with-lease
   \`\`\`

4. **Create or find PR:**
   \`\`\`bash
   # Check for existing PR
   gh pr list --head ${taskBranch} --json url --jq '.[0].url'

   # If no PR exists, create one
   gh pr create --base ${baseBranch} --head ${taskBranch} \\
     --title "Merge ${taskBranch}" \\
     --body "Automated merge from Anvil task completion."
   \`\`\`

5. **Store and report PR URL:**
   \`\`\`bash
   anvil tasks update --id $TASK_ID --pr-url <PR_URL> --json
   \`\`\`
   - Report the PR URL and request human review`;
}

function buildMergePRInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch } = context;

  return `## Merge Workflow: Merge + Pull Request

1. **Verify clean state:**
   \`\`\`bash
   git status
   \`\`\`

2. **Merge base into task branch (resolve conflicts here):**
   \`\`\`bash
   git fetch origin ${baseBranch}
   git merge origin/${baseBranch}
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section

3. **Push task branch:**
   \`\`\`bash
   git push origin ${taskBranch}
   \`\`\`

4. **Create or find PR:**
   \`\`\`bash
   # Check for existing PR
   gh pr list --head ${taskBranch} --json url --jq '.[0].url'

   # If no PR exists, create one
   gh pr create --base ${baseBranch} --head ${taskBranch} \\
     --title "Merge ${taskBranch}" \\
     --body "Automated merge from Anvil task completion."
   \`\`\`

5. **Store and report PR URL:**
   \`\`\`bash
   anvil tasks update --id $TASK_ID --pr-url <PR_URL> --json
   \`\`\`
   - Report the PR URL and request human review`;
}
```

---

### Phase 3: Intelligent Conflict Resolution

**Goal:** Resolve simple conflicts autonomously, escalate complex ones.

#### 3.1 Replace CONFLICT_HANDLING Constant

**File:** `agents/src/agent-types/merge.ts`

```typescript
const CONFLICT_HANDLING = `## Conflict Resolution

When you encounter merge/rebase conflicts, analyze and resolve them intelligently.

### Analysis Steps

For each conflicting file:

1. **Read the conflict markers** to understand both versions:
   \`\`\`bash
   cat <file>  # Shows <<<<<<< HEAD ... ======= ... >>>>>>> markers
   \`\`\`

2. **Understand the intent** of each side:
   \`\`\`bash
   git log --oneline -5 -- <file>  # Recent changes to this file
   git show HEAD:<file>            # Our version
   git show REBASE_HEAD:<file>     # Their version (during rebase)
   \`\`\`

### Resolve Autonomously When:

- **Non-overlapping changes:** Both sides modified different parts of the file
- **Additive changes:** One side added imports, the other added functions
- **Complementary changes:** Both changes can coexist (e.g., different config keys)
- **Superset changes:** One version includes all changes from the other plus more
- **Formatting/whitespace:** Trivial differences that don't affect logic

### Request Human Review When:

- **Semantic conflicts:** Both sides changed the same business logic differently
- **API changes:** Function signatures or interfaces were modified incompatibly
- **Complex merges:** More than 5 files with non-trivial conflicts
- **Uncertain intent:** You cannot determine which version is correct
- **Test conflicts:** Test files where correctness depends on implementation choice

### Resolution Process

1. **Edit the file** to resolve conflicts (remove markers, merge code)
2. **Stage the resolution:**
   \`\`\`bash
   git add <file>
   \`\`\`
3. **Continue the rebase/merge:**
   \`\`\`bash
   git rebase --continue  # For rebase
   git commit             # For merge (if needed)
   \`\`\`

### Abort and Escalate

If resolution becomes too complex:

\`\`\`bash
git rebase --abort  # or git merge --abort
\`\`\`

Then request human review with:
- List of conflicting files
- Summary of what each side changed
- Why autonomous resolution isn't feasible
`;
```

---

### Phase 4: Remove User Prompt Building from agent-service.ts

**Goal:** Single source of truth - all merge prompt logic lives in `agents/src/agent-types/merge.ts`.

**File:** `src/lib/agent-service.ts`

**Remove these functions entirely:**
- `buildMergeAgentPrompt()` (lines 741-767)
- `buildLocalMergeInstructions()` (lines 769-791)
- `buildPRMergeInstructions()` (lines 793-820)

**Replace `buildMergePromptForTask()` with `buildMergeContextForTask()`:**

This function should now only gather context, NOT build a prompt:

```typescript
import { type MergeContext } from '@anvil/agents';

/**
 * Builds the merge context for a task.
 * Returns null if context cannot be determined.
 */
export async function buildMergeContextForTask(
  task: TaskMetadata
): Promise<MergeContext | null> {
  if (!task.repositoryName) {
    logger.warn("[agent] Cannot build merge context: task has no repositoryName");
    return null;
  }

  // Get branch info
  let branchInfo = await workspaceService.getTaskBranchInfo(
    task.repositoryName,
    task.id
  );

  if (!branchInfo) {
    logger.info("[agent] No branch info in settings, deriving from task ID");
    try {
      const repoPath = await fsCommands.getRepoSourcePath(task.repositoryName);
      const baseBranch = await gitCommands.getDefaultBranch(repoPath);
      branchInfo = {
        branch: `anvil/task-${task.id}`,
        baseBranch,
        mergeBase: "",
        createdAt: Date.now(),
      };
    } catch (error) {
      logger.warn(`[agent] Failed to derive branch info: ${error}`);
      return null;
    }
  }

  // Get worktree paths
  const taskWorktree = await workspaceService.getWorktreeForTask(
    task.repositoryName,
    task.id
  );
  const mainWorktreePath = await workspaceService.getSourceRepoPath(
    task.repositoryName
  );

  if (!taskWorktree) {
    logger.warn("[agent] No worktree found for task");
    return null;
  }

  const settings = useSettingsStore.getState();

  return {
    taskBranch: branchInfo.branch,
    baseBranch: branchInfo.baseBranch,
    taskWorktreePath: taskWorktree.path,
    mainWorktreePath,
    mergeDestination: settings.getMergeDestination(),
    mergeMethod: settings.getMergeMethod(),
  };
}
```

---

### Phase 5: Update Agent Spawning

**Goal:** Pass the dynamic system prompt when starting the merge agent.

#### 5.1 Export buildMergeAgentPrompt from agents package

**File:** `agents/src/index.ts` (or appropriate entry point)

```typescript
export { buildMergeAgentPrompt, type MergeContext } from './agent-types/merge.js';
```

#### 5.2 Update StartAgentOptions

**File:** `src/lib/agent-service.ts`

Add optional system prompt override:

```typescript
export interface StartAgentOptions {
  agentType: string;
  workingDirectory: string;
  prompt: string;
  taskId: string | null;
  mergeBase?: string;
  parentTaskId?: string;
  threadId?: string;
  /** Override the agent's system prompt (used for merge agent with dynamic context) */
  appendedPromptOverride?: string;
}
```

#### 5.3 Pass Override to Runner

When `appendedPromptOverride` is provided, pass it as a runner argument:

```typescript
if (options.appendedPromptOverride) {
  commandArgs.push("--appended-prompt", options.appendedPromptOverride);
}
```

#### 5.4 Update Runner to Accept Override

**File:** `agents/src/runner.ts`

Handle `--appended-prompt` arg and use it instead of the agent config's `appendedPrompt`.

---

### Phase 6: Usage Example

When starting a merge agent:

```typescript
import { buildMergeAgentPrompt } from '@anvil/agents';

// 1. Gather context
const context = await buildMergeContextForTask(task);
if (!context) {
  throw new Error("Cannot build merge context");
}

// 2. Build the system prompt
const mergeSystemPrompt = buildMergeAgentPrompt(context);

// 3. Start agent with the dynamic system prompt
await startAgent({
  agentType: 'merge',
  workingDirectory: context.taskWorktreePath,
  prompt: 'Execute the merge workflow.',  // Simple user prompt
  taskId: task.id,
  appendedPromptOverride: mergeSystemPrompt,
});
```

---

## Final System Prompt Structure

```
## Role
You are the merge agent for Anvil. You integrate completed work into the target branch.

## Environment
- Task Worktree: /Users/dev/.anvil/repositories/myrepo/worktree-1
  - Branch: anvil/task-abc123
- Main Worktree: /Users/dev/projects/myrepo
  - Branch: main

## Merge Workflow: Rebase + Local
1. Verify clean state...
2. Fetch latest...
3. Rebase task branch...
4. Push and fast-forward merge in main worktree...
5. Report result...

## Conflict Resolution
- Analysis steps
- When to resolve autonomously
- When to escalate
- Resolution process

## Safety Guidelines
- Use git and gh CLI directly
- Verify repository before changes
- No force push without confirmation

## Anvil CLI
- anvil tasks update --status ...
- anvil review request ...

## Guidelines
- Be concise
- Report success with commit hash
- Request human review when complete
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `agents/src/agent-types/merge-types.ts` | Add `MergeContext` interface |
| `agents/src/agent-types/merge.ts` | Rewrite `buildMergeAgentPrompt(context)` with environment section, concrete strategy instructions, intelligent conflict handling |
| `agents/src/index.ts` | Export `buildMergeAgentPrompt` and `MergeContext` |
| `agents/src/runner.ts` | Handle `--appended-prompt` argument |
| `src/lib/agent-service.ts` | Remove `buildMergeAgentPrompt`, `buildLocalMergeInstructions`, `buildPRMergeInstructions`. Replace `buildMergePromptForTask` with `buildMergeContextForTask`. Add `appendedPromptOverride` to options. |
| `src/lib/workspace-service.ts` | Add `getWorktreeForTask()` and `getSourceRepoPath()` methods |

---

## Testing

1. **Rebase + Local with no conflicts:** Should complete autonomously
2. **Rebase + Local with simple conflicts:** Should resolve and complete
3. **Rebase + Local with complex conflicts:** Should abort and request review
4. **PR strategies:** Should work with correct paths
5. **Multi-worktree:** Verify `git -C` commands work correctly

---

## Checklist

### Phase 1: Worktree Support
- [ ] Add `MergeContext` interface to `agents/src/agent-types/merge-types.ts`
- [ ] Update `WorkspaceService` interface with new method signatures
- [ ] Implement `getWorktreeForTask(repoName, taskId)` in `workspace-service.ts`
- [ ] Implement `getSourceRepoPath(repoName)` in `workspace-service.ts`

### Phase 2: System Prompt
- [ ] Rewrite `buildMergeAgentPrompt(context)` in `agents/src/agent-types/merge.ts`:
  - [ ] `buildEnvironmentSection(context)` - explicit worktree paths
  - [ ] `buildStrategyInstructions(context)` - router for 4 strategies
  - [ ] `buildRebaseLocalInstructions(context)`
  - [ ] `buildMergeLocalInstructions(context)`
  - [ ] `buildRebasePRInstructions(context)`
  - [ ] `buildMergePRInstructions(context)`

### Phase 3: Conflict Resolution
- [ ] Replace `CONFLICT_HANDLING` constant with intelligent resolution guidance

### Phase 4: Remove Duplicate Code
- [ ] Delete from `agent-service.ts`:
  - [ ] `buildMergeAgentPrompt()`
  - [ ] `buildLocalMergeInstructions()`
  - [ ] `buildPRMergeInstructions()`
- [ ] Replace `buildMergePromptForTask()` with `buildMergeContextForTask()`

### Phase 5: Agent Spawning
- [ ] Export `buildMergeAgentPrompt` and `MergeContext` from `agents/src/index.ts`
- [ ] Add `appendedPromptOverride` to `StartAgentOptions` interface
- [ ] Pass `--appended-prompt` arg to runner when override provided
- [ ] Handle `--appended-prompt` in `agents/src/runner.ts`
- [ ] Update merge agent spawn site to use new flow

### Testing
- [ ] Rebase + Local with no conflicts
- [ ] Rebase + Local with simple conflicts (auto-resolve)
- [ ] Rebase + Local with complex conflicts (escalate)
- [ ] Merge + Local strategy
- [ ] Rebase + PR strategy
- [ ] Merge + PR strategy
- [ ] Multi-worktree: verify `git -C` commands work correctly
