/**
 * Changes Tab Component
 *
 * Displays all file changes made during a thread's execution.
 * Shows a consolidated diff view from the initial commit at thread start.
 */

import { useEffect, useState, useMemo, useRef } from "react";
import { FileCode2, AlertCircle, GitBranch } from "lucide-react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { ThreadState } from "@/lib/types/agent-messages";
import {
  generateThreadDiff,
  extractFileChanges,
  type ThreadDiffResult,
} from "@/lib/utils/thread-diff-generator";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
import { parseDiff } from "@/lib/diff-parser";
import { buildAnnotatedFiles, type AnnotatedFile } from "@/lib/annotated-file-builder";
import { FilesystemClient } from "@/lib/filesystem-client";
import { logger } from "@/lib/logger-client";
import { useWorkingDirectory } from "@/hooks/use-working-directory";

interface ChangesTabProps {
  /** Thread metadata containing git info */
  threadMetadata: ThreadMetadata;
  /** Thread state containing file changes */
  threadState?: ThreadState;
  /** Whether thread state is still being loaded from disk */
  isLoadingThreadState?: boolean;
}

/**
 * Empty state shown when there are no file changes.
 */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-surface-400 p-8">
      <FileCode2 size={48} className="mb-4 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/**
 * Error state shown when diff generation fails.
 */
function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-red-400 p-8">
      <AlertCircle size={48} className="mb-4 opacity-50" />
      <p className="text-sm">{error}</p>
    </div>
  );
}

/**
 * Loading state shown while generating diffs.
 * Renders blank screen - loading is fast enough that a spinner is jarring.
 */
function LoadingState() {
  return <div className="h-full" />;
}

/**
 * Header showing diff summary stats.
 */
function DiffSummaryHeader({
  fileCount,
  additions,
  deletions,
  initialCommit,
}: {
  fileCount: number;
  additions: number;
  deletions: number;
  initialCommit: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface-800/50 border-b border-surface-700 text-xs">
      <div className="flex items-center gap-4">
        <span className="text-surface-400">
          {fileCount} {fileCount === 1 ? "file" : "files"} changed
        </span>
        {additions > 0 && (
          <span className="text-green-400">+{additions}</span>
        )}
        {deletions > 0 && (
          <span className="text-red-400">-{deletions}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-surface-500">
        <GitBranch size={12} />
        <span className="font-mono" title={`From commit ${initialCommit}`}>
          {initialCommit.slice(0, 7)}
        </span>
      </div>
    </div>
  );
}

// Singleton filesystem client
const fsClient = new FilesystemClient();

/**
 * Reads file contents for all non-deleted files in the diff.
 * Returns a map of file path to array of lines.
 */
async function fetchFileContents(
  diffResult: ThreadDiffResult,
  workingDirectory: string
): Promise<Record<string, string[]>> {
  const fileContents: Record<string, string[]> = {};

  for (const file of diffResult.diff.files) {
    // Skip deleted and binary files - we can't read their current contents
    if (file.type === "deleted" || file.type === "binary") {
      continue;
    }

    const filePath = file.newPath ?? file.oldPath;
    if (!filePath) continue;

    // Build full path relative to working directory
    const fullPath = workingDirectory
      ? `${workingDirectory}/${filePath}`
      : filePath;

    try {
      const content = await fsClient.readFile(fullPath);
      fileContents[filePath] = content.split("\n");
    } catch {
      // File might not exist or be unreadable - skip it
      // The annotated file builder will handle missing content gracefully
    }
  }

  return fileContents;
}

/**
 * Changes tab for viewing all file changes in a thread.
 */
export function ChangesTab({ threadMetadata, threadState, isLoadingThreadState }: ChangesTabProps) {
  const [diffResult, setDiffResult] = useState<ThreadDiffResult | null>(null);
  const [annotatedFiles, setAnnotatedFiles] = useState<AnnotatedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track whether the initial load has completed (isLoadingThreadState went from true to false, OR we received state)
  const [initialLoadComplete, setInitialLoadComplete] = useState(!!threadState);
  const prevLoadingRef = useRef(isLoadingThreadState);

  logger.info(`[FC-DEBUG] ChangesTab render`, {
    threadId: threadMetadata.id,
    hasThreadState: !!threadState,
    isLoadingThreadState,
    fileChangesCount: threadState?.fileChanges?.length ?? 0,
    initialCommitHash: threadMetadata.git?.initialCommitHash,
    // Add current state values
    loading,
    hasDiffResult: !!diffResult,
    diffResultFileCount: diffResult?.diff?.files?.length ?? 0,
    error,
    initialLoadComplete,
  });

  // Track when loading completes or when state arrives
  useEffect(() => {
    // If we receive threadState, initial load is complete
    if (threadState) {
      setInitialLoadComplete(true);
    }
    // If isLoadingThreadState transitions from true to false, load is complete
    if (prevLoadingRef.current && !isLoadingThreadState) {
      setInitialLoadComplete(true);
    }
    prevLoadingRef.current = isLoadingThreadState;
  }, [threadState, isLoadingThreadState]);

  // Extract file change info from thread state's fileChanges
  const fileChanges = useMemo(() => {
    const changes = extractFileChanges(threadState?.fileChanges);
    logger.info(`[FC-DEBUG] ChangesTab extractFileChanges`, {
      threadId: threadMetadata.id,
      hasThreadState: !!threadState,
      fileChangesCount: threadState?.fileChanges?.length ?? 0,
      extractedChangesCount: changes.length,
      changes,
    });
    return changes;
  }, [threadState?.fileChanges, threadMetadata.id]);

  // Check if we have the required data for diffing
  const initialCommitHash = threadMetadata.git?.initialCommitHash;
  // Derive working directory from thread's worktreeId via repo settings
  const workingDirectory = useWorkingDirectory(threadMetadata);

  // We're still waiting for thread state if initial load hasn't completed yet
  const isWaitingForThreadState = !initialLoadComplete;

  useEffect(() => {
    logger.info(`[FC-DEBUG] generateDiffs useEffect triggered`, {
      threadId: threadMetadata.id,
      initialCommitHash,
      fileChangesCount: fileChanges.length,
      isLoadingThreadState,
      isWaitingForThreadState,
      initialLoadComplete,
    });

    const generateDiffs = async () => {
      logger.info(`[FC-DEBUG] generateDiffs effect starting`, {
        threadId: threadMetadata.id,
        initialCommitHash,
        fileChangesCount: fileChanges.length,
        fileChanges,
        isLoadingThreadState,
        isWaitingForThreadState,
        initialLoadComplete,
      });

      setLoading(true);
      setError(null);

      // No git info - can't generate diff
      if (!initialCommitHash) {
        logger.info(`[FC-DEBUG] No initialCommitHash, aborting diff generation`);
        setLoading(false);
        return;
      }

      // If thread state is still loading or hasn't arrived yet, wait for it
      if (isLoadingThreadState || isWaitingForThreadState) {
        logger.info(`[FC-DEBUG] Waiting for thread state`, { isLoadingThreadState, isWaitingForThreadState });
        // Don't set loading to false - let the parent loading state take precedence
        return;
      }

      // No changed files - nothing to diff
      if (fileChanges.length === 0) {
        logger.info(`[FC-DEBUG] No file changes, nothing to diff`);
        setLoading(false);
        return;
      }

      try {
        logger.info(`[FC-DEBUG] Calling generateThreadDiff`, {
          initialCommitHash,
          fileChanges,
          workingDirectory,
        });
        const result = await generateThreadDiff(
          initialCommitHash,
          fileChanges,
          workingDirectory
        );
        logger.info(`[FC-DEBUG] generateThreadDiff returned`, {
          hasError: !!result.error,
          fileCount: result.diff.files.length,
          error: result.error,
        });

        if (result.error) {
          setError(result.error);
        } else {
          setDiffResult(result);

          // Fetch full file contents for all changed files
          logger.info(`[FC-DEBUG] Fetching file contents`);
          const fileContents = await fetchFileContents(result, workingDirectory);
          logger.info(`[FC-DEBUG] fetchFileContents returned`, {
            fileCount: Object.keys(fileContents).length,
            filePaths: Object.keys(fileContents),
          });

          // Build annotated files with full content
          logger.info(`[FC-DEBUG] Building annotated files`);
          const annotated = buildAnnotatedFiles(result.diff, fileContents);
          logger.info(`[FC-DEBUG] buildAnnotatedFiles returned`, {
            annotatedFileCount: annotated.length,
            filesWithLines: annotated.filter((f) => f.lines.length > 0).length,
          });
          setAnnotatedFiles(annotated);
        }
      } catch (err) {
        logger.error(`[FC-DEBUG] generateDiffs error`, err);
        setError(err instanceof Error ? err.message : "Failed to generate diff");
      } finally {
        setLoading(false);
        logger.info(`[FC-DEBUG] generateDiffs completed`);
      }
    };

    generateDiffs();
  }, [initialCommitHash, fileChanges, workingDirectory, isLoadingThreadState, isWaitingForThreadState, threadMetadata.id, initialLoadComplete]);

  // Loading state - show when diff is generating OR when thread state is still loading from disk
  if (loading || isLoadingThreadState || isWaitingForThreadState) {
    logger.info(`[FC-DEBUG] ChangesTab rendering LoadingState`, {
      loading,
      isLoadingThreadState,
      isWaitingForThreadState,
    });
    return <LoadingState />;
  }

  // No git info available
  if (!initialCommitHash) {
    logger.info(`[FC-DEBUG] ChangesTab rendering EmptyState: no git info`);
    return <EmptyState message="No git information available for this thread" />;
  }

  // No file changes
  if (fileChanges.length === 0) {
    logger.info(`[FC-DEBUG] ChangesTab rendering EmptyState: no file changes`);
    return <EmptyState message="No file changes in this thread" />;
  }

  // Error state
  if (error) {
    logger.info(`[FC-DEBUG] ChangesTab rendering ErrorState`, { error });
    return <ErrorState error={error} />;
  }

  // No diff result
  if (!diffResult || diffResult.diff.files.length === 0) {
    logger.info(`[FC-DEBUG] ChangesTab rendering EmptyState: no diff result`);
    return <EmptyState message="No changes to display" />;
  }

  // Calculate total stats
  const totalStats = diffResult.diff.files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.stats.additions,
      deletions: acc.deletions + file.stats.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  logger.info(`[FC-DEBUG] ChangesTab rendering diff view`, {
    fileCount: diffResult.diff.files.length,
    annotatedFilesCount: annotatedFiles.length,
    totalAdditions: totalStats.additions,
    totalDeletions: totalStats.deletions,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DiffSummaryHeader
        fileCount={diffResult.diff.files.length}
        additions={totalStats.additions}
        deletions={totalStats.deletions}
        initialCommit={diffResult.initialCommit}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {annotatedFiles.length > 0
          ? // Use annotated files with full content when available
            annotatedFiles.map((annotatedFile, index) => {
              const filePath =
                annotatedFile.file.newPath ??
                annotatedFile.file.oldPath ??
                `file-${index}`;

              return (
                <InlineDiffBlock
                  key={filePath}
                  filePath={filePath}
                  lines={annotatedFile.lines}
                  stats={annotatedFile.file.stats}
                  fileType={annotatedFile.file.type}
                />
              );
            })
          : // Fallback to diff-only display
            diffResult.diff.files.map((file, index) => {
              const filePath = file.newPath ?? file.oldPath ?? `file-${index}`;
              const fileDiff = reconstructFileDiff(file);

              return (
                <InlineDiffBlock
                  key={filePath}
                  filePath={filePath}
                  diff={fileDiff}
                />
              );
            })}
      </div>
    </div>
  );
}

/**
 * Reconstructs a raw diff string from a ParsedDiffFile.
 * This is needed because InlineDiffBlock expects a raw diff string.
 */
function reconstructFileDiff(file: ReturnType<typeof parseDiff>["files"][0]): string {
  const lines: string[] = [];

  // Diff header
  const oldPath = file.oldPath ?? "/dev/null";
  const newPath = file.newPath ?? "/dev/null";
  lines.push(`diff --git a/${oldPath} b/${newPath}`);

  if (file.type === "added") {
    lines.push("new file mode 100644");
  } else if (file.type === "deleted") {
    lines.push("deleted file mode 100644");
  }

  lines.push(`--- ${file.oldPath ? `a/${file.oldPath}` : "/dev/null"}`);
  lines.push(`+++ ${file.newPath ? `b/${file.newPath}` : "/dev/null"}`);

  // Hunks
  for (const hunk of file.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.sectionHeader ? ` ${hunk.sectionHeader}` : ""}`
    );

    for (const line of hunk.lines) {
      const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join("\n");
}
