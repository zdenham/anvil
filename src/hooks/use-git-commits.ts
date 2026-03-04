import { useState, useEffect, useCallback } from "react";
import { invoke } from "@/lib/invoke";
import { z } from "zod";
import { logger } from "@/lib/logger-client";

/** Schema for git commit data from IPC */
export const GitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  relativeDate: z.string(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

const GitCommitArraySchema = z.array(GitCommitSchema);

interface UseGitCommitsResult {
  commits: GitCommit[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGitCommits(
  branchName: string | null | undefined,
  workingDirectory: string
): UseGitCommitsResult {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCommits = useCallback(async () => {
    if (!branchName || !workingDirectory) {
      setCommits([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rawResult = await invoke<unknown>("git_get_branch_commits", {
        branchName,
        workingDirectory,
        limit: 50,
      });
      const result = GitCommitArraySchema.parse(rawResult);
      setCommits(result);
    } catch (err) {
      logger.error("[useGitCommits] Failed to fetch commits:", err);
      setError(err instanceof Error ? err.message : String(err));
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [branchName, workingDirectory]);

  useEffect(() => {
    fetchCommits();
  }, [fetchCommits]);

  return {
    commits,
    loading,
    error,
    refresh: fetchCommits,
  };
}
