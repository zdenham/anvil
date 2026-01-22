import { getCurrentBranch, hasUncommittedChanges } from "../git.js";

export interface GitState {
  currentBranch: string;
  isDirty: boolean;
}

/**
 * Get the current git state of the workspace.
 */
export function getGitState(workspaceDir: string): GitState {
  return {
    currentBranch: getCurrentBranch(workspaceDir),
    isDirty: hasUncommittedChanges(workspaceDir),
  };
}
