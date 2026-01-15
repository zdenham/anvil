import { GitCommit as GitCommitIcon, RefreshCw, AlertCircle } from "lucide-react";
import { useGitCommits, type GitCommit } from "@/hooks/use-git-commits";

interface GitCommitsListProps {
  branchName?: string | null;
  workingDirectory: string;
}

export function GitCommitsList({ branchName, workingDirectory }: GitCommitsListProps) {
  const { commits, loading, error, refresh } = useGitCommits(branchName, workingDirectory);

  if (!branchName) {
    return (
      <div className="h-full flex items-center justify-center text-surface-500">
        <div className="text-center">
          <GitCommitIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No branch associated with this task</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-surface-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-surface-400 hover:text-surface-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-surface-500">
        <div className="text-center">
          <GitCommitIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No commits on this branch</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-surface-300">
            Commits on <code className="text-accent-400">{branchName}</code>
          </h3>
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-300"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="space-y-1">
          {commits.map((commit) => (
            <CommitRow key={commit.hash} commit={commit} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommitRow({ commit }: { commit: GitCommit }) {
  return (
    <div className="px-3 py-2 rounded-lg hover:bg-surface-800/50 group">
      <div className="flex items-start gap-3">
        <code className="text-xs text-accent-400 font-mono pt-0.5 flex-shrink-0">
          {commit.shortHash}
        </code>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-surface-200 truncate">
            {commit.message}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-surface-500">
            <span>{commit.author}</span>
            <span>-</span>
            <span>{commit.relativeDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
