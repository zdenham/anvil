/**
 * Workflow mode for handling completed tasks.
 * "solo" - Rebase onto local main and fast-forward merge (for solo devs)
 * "team" - Rebase onto origin/main and create a PR (for teams)
 *
 * Note: This is duplicated from src/entities/settings/types.ts to avoid
 * cross-package dependencies. Agents should not depend on frontend types.
 */
export type WorkflowMode = "solo" | "team";

/**
 * Context required for the merge agent to execute a merge.
 * Provides explicit paths instead of requiring runtime discovery.
 */
export interface MergeContext {
  /** The task branch to merge (e.g., mort/task-abc123) */
  taskBranch: string;
  /** The base branch to merge into (e.g., main) */
  baseBranch: string;
  /** Absolute path to the worktree where task branch is checked out */
  taskWorktreePath: string;
  /** Absolute path to the main worktree (source repo) where base branch is checked out */
  mainWorktreePath: string;
  /** Workflow mode: solo (local merge) or team (PR) */
  workflowMode: WorkflowMode;
}
