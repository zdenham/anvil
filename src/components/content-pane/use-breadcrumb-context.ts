import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

/**
 * Hook to get repo and worktree names for breadcrumb display.
 * Uses the lookup store which is hydrated at app start.
 */
export function useBreadcrumbContext(
  repoId: string | undefined,
  worktreeId: string | undefined
) {
  const getRepoName = useRepoWorktreeLookupStore((s) => s.getRepoName);
  const getWorktreeName = useRepoWorktreeLookupStore((s) => s.getWorktreeName);

  const repoName = repoId ? getRepoName(repoId) : undefined;
  const worktreeName =
    repoId && worktreeId ? getWorktreeName(repoId, worktreeId) : undefined;

  return {
    repoName,
    worktreeName,
  };
}
