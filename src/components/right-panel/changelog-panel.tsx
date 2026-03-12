import { GitCommit } from "lucide-react";
import { useGitCommits, type GitCommit as GitCommitType } from "@/hooks/use-git-commits";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { navigationService } from "@/stores/navigation-service";
import { cn } from "@/lib/utils";

interface ChangelogPanelProps {
  repoId: string | null;
  worktreeId: string | null;
  workingDirectory: string | null;
}

function shortAuthor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(" ")) return trimmed;
  return trimmed.split(" ")[0];
}

function CommitRow({ commit, onSelect }: { commit: GitCommitType; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 text-left",
        "text-[13px] leading-[22px] transition-colors duration-75",
        "text-surface-400 hover:text-surface-200 hover:bg-accent-500/10",
        "cursor-pointer select-none",
      )}
    >
      <GitCommit size={12} className="flex-shrink-0 w-3 h-3" />
      <span className="truncate flex-1" title={commit.message}>
        {commit.message}
      </span>
      <span className="flex-shrink-0 text-surface-500 text-xs whitespace-nowrap">
        {shortAuthor(commit.author)}
        {commit.relativeDate && ` \u00B7 ${commit.relativeDate}`}
      </span>
    </button>
  );
}

export function ChangelogPanel({ repoId, worktreeId, workingDirectory }: ChangelogPanelProps) {
  const branchName = useRepoWorktreeLookupStore((s) => {
    if (!repoId || !worktreeId) return null;
    return s.repos.get(repoId)?.worktrees.get(worktreeId)?.currentBranch ?? null;
  });

  const { commits, loading } = useGitCommits(branchName, workingDirectory ?? "");

  const handleCommitClick = (commit: GitCommitType) => {
    if (!repoId || !worktreeId) return;
    navigationService.navigateToChanges(repoId, worktreeId, {
      commitHash: commit.hash,
    });
  };

  if (!repoId || !worktreeId) {
    return (
      <div className="flex items-center justify-center h-32 text-surface-500 text-sm">
        No worktree selected
      </div>
    );
  }

  if (loading && commits.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5 px-2 py-1 animate-pulse">
            <div className="w-3 h-3 rounded-full bg-surface-700" />
            <div className="flex-1 h-3 rounded bg-surface-700" />
            <div className="w-16 h-3 rounded bg-surface-700" />
          </div>
        ))}
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-surface-500 text-sm">
        No commits
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {commits.map((commit) => (
        <CommitRow
          key={commit.hash}
          commit={commit}
          onSelect={() => handleCommitClick(commit)}
        />
      ))}
    </div>
  );
}
