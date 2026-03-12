/**
 * useChangesData — Data hook for the Changes content pane.
 *
 * Resolves the merge base, fetches diffs, parses them, and provides
 * per-file raw diff strings for rendering with InlineDiffBlock.
 *
 * Stale-while-revalidate: returns stale data immediately on re-entry,
 * single commit diffs cached (immutable).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";
import { gitCommands } from "@/lib/tauri-commands";
import { fetchRawDiff, processParsedDiff, fetchFileContents, backgroundFetchOrigin, getCachedCommitFileContents } from "./changes-diff-fetcher";
import { getCachedRangeDiff, invalidateRangeDiffCache, updateCachedFileContents } from "./changes-diff-cache";
import type { FileContentEntry } from "./changes-diff-fetcher";
import type { ParsedDiff, ParsedDiffFile } from "@/lib/diff-parser";

interface UseChangesDataOptions {
  repoId: string;
  worktreeId: string;
  uncommittedOnly?: boolean;
  commitHash?: string;
}

interface UseChangesDataResult {
  parsedDiff: ParsedDiff | null;
  rawDiffsByFile: Record<string, string>;
  fileContents: Record<string, FileContentEntry>;
  totalFileCount: number;
  files: ParsedDiffFile[];
  changedFilePaths: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  branchName: string | null;
  mergeBase: string | null;
  defaultBranch: string | null;
  worktreePath: string;
}

export function useChangesData(options: UseChangesDataOptions): UseChangesDataResult {
  const { repoId, worktreeId, uncommittedOnly, commitHash } = options;

  const worktreePath = useRepoWorktreeLookupStore((s) => s.getWorktreePath(repoId, worktreeId));
  const defaultBranch = useRepoWorktreeLookupStore((s) => s.getDefaultBranch(repoId));
  const currentBranch = useRepoWorktreeLookupStore((s) => s.getCurrentBranch(repoId, worktreeId));

  const [parsedDiff, setParsedDiff] = useState<ParsedDiff | null>(null);
  const [rawDiffString, setRawDiffString] = useState<string | null>(null);
  const [mergeBase, setMergeBase] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, FileContentEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freshBranch, setFreshBranch] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const generationRef = useRef(0);
  const contentGenRef = useRef(0);
  const previousBranchRef = useRef<string | null>(null);

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  useEffect(() => {
    const generation = ++generationRef.current;
    loadDiff(generation);

    async function loadDiff(gen: number) {
      if (!worktreePath) {
        setError("Worktree path not found");
        setLoading(false);
        return;
      }

      // Phase 1: Query git for the real current branch
      let liveBranch: string | null = currentBranch;
      try {
        liveBranch = await gitCommands.getCurrentBranch(worktreePath);
      } catch {
        logger.warn("[useChangesData] Failed to get current branch from git, using store value");
      }
      if (generationRef.current !== gen) return;
      setFreshBranch(liveBranch);

      const isRangeMode = !commitHash && !uncommittedOnly;

      // Phase 2: Invalidate cache if branch changed
      if (liveBranch !== previousBranchRef.current && previousBranchRef.current !== null) {
        invalidateRangeDiffCache(worktreePath);
      }
      previousBranchRef.current = liveBranch;

      // Stale-while-revalidate: show cached range diff immediately (no spinner)
      const cached = isRangeMode ? getCachedRangeDiff(worktreePath) : undefined;
      if (cached) {
        setParsedDiff(cached.parsed);
        setRawDiffString(cached.raw);
        setMergeBase(cached.mergeBase);
        if (Object.keys(cached.fileContents).length > 0) {
          setFileContents(cached.fileContents);
        }
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await fetchRawDiff({
          worktreePath,
          defaultBranch,
          currentBranch: liveBranch,
          uncommittedOnly,
          commitHash,
        });

        if (generationRef.current !== gen) return;

        setParsedDiff(result.parsed);
        setRawDiffString(result.raw);
        setMergeBase(result.mergeBase);

        // Background: fetch origin and re-diff if merge-base changed
        if (isRangeMode && result.mergeBase) {
          backgroundFetchOrigin({
            worktreePath,
            defaultBranch,
            currentBranch: liveBranch,
            previousMergeBase: result.mergeBase,
          }).then((bgResult) => {
            if (generationRef.current !== gen) return;
            if (bgResult.changed && bgResult.result) {
              setParsedDiff(bgResult.result.parsed);
              setRawDiffString(bgResult.result.raw);
              setMergeBase(bgResult.result.mergeBase);
            }
          });
        }

        // Phase 3: Sync store if stale (fire-and-forget)
        if (liveBranch !== currentBranch) {
          useRepoWorktreeLookupStore.getState().hydrate().catch(() => {});
        }
      } catch (err) {
        if (generationRef.current !== gen) return;
        const message = err instanceof Error ? err.message : "Failed to fetch diff";
        logger.error("[useChangesData] error:", message);
        setError(message);
      } finally {
        if (generationRef.current === gen) {
          setLoading(false);
        }
      }
    }
  }, [worktreePath, defaultBranch, currentBranch, uncommittedOnly, commitHash, refreshCounter]);

  const processed = useMemo(
    () => processParsedDiff(parsedDiff, rawDiffString),
    [parsedDiff, rawDiffString]
  );

  // Fetch full file contents for syntax highlighting (runs after diff loads)
  useEffect(() => {
    const gen = ++contentGenRef.current;
    if (processed.files.length === 0 || !worktreePath) {
      setFileContents({});
      return;
    }

    // Check commit cache first — skip fetch entirely on cache hit
    if (commitHash) {
      const cached = getCachedCommitFileContents(commitHash);
      if (cached && Object.keys(cached).length > 0) {
        setFileContents(cached);
        return;
      }
    }

    fetchFileContents({
      worktreePath,
      files: processed.files,
      mergeBase,
      commitHash,
      uncommittedOnly,
    }).then((contents) => {
      if (contentGenRef.current === gen) {
        setFileContents(contents);
        if (!commitHash && !uncommittedOnly) {
          updateCachedFileContents(worktreePath, contents);
        }
      }
    }).catch((err) => {
      logger.warn("[useChangesData] file content fetch failed:", err);
    });
  }, [processed.files, worktreePath, mergeBase, commitHash, uncommittedOnly]);

  return {
    parsedDiff,
    rawDiffsByFile: processed.rawDiffsByFile,
    fileContents,
    totalFileCount: processed.totalFileCount,
    files: processed.files,
    changedFilePaths: processed.changedFilePaths,
    loading,
    error,
    refresh,
    branchName: freshBranch ?? currentBranch,
    mergeBase,
    defaultBranch,
    worktreePath,
  };
}
