/**
 * Changes Tab Component
 *
 * Displays all file changes made during a thread's execution.
 * Shows a consolidated diff view from the initial commit at thread start.
 */

import { useEffect, useState, useMemo } from "react";
import { Loader2, FileCode2, AlertCircle, GitBranch } from "lucide-react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { ThreadState } from "@/lib/types/agent-messages";
import {
  generateThreadDiff,
  extractChangedFilePaths,
  type ThreadDiffResult,
} from "@/lib/utils/thread-diff-generator";
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";
import { parseDiff } from "@/lib/diff-parser";

interface ChangesTabProps {
  /** Thread metadata containing git info */
  threadMetadata: ThreadMetadata;
  /** Thread state containing file changes */
  threadState?: ThreadState;
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
 */
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-surface-400 p-8">
      <Loader2 size={32} className="mb-4 animate-spin" />
      <p className="text-sm">Generating diff...</p>
    </div>
  );
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

/**
 * Changes tab for viewing all file changes in a thread.
 */
export function ChangesTab({ threadMetadata, threadState }: ChangesTabProps) {
  const [diffResult, setDiffResult] = useState<ThreadDiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Extract file paths from thread state's fileChanges
  const changedFilePaths = useMemo(() => {
    return extractChangedFilePaths(threadState?.fileChanges);
  }, [threadState?.fileChanges]);

  // Check if we have the required data for diffing
  const initialCommitHash = threadMetadata.git?.initialCommitHash;
  const workingDirectory = threadMetadata.workingDirectory;

  useEffect(() => {
    const generateDiffs = async () => {
      setLoading(true);
      setError(null);

      // No git info - can't generate diff
      if (!initialCommitHash) {
        setLoading(false);
        return;
      }

      // No changed files - nothing to diff
      if (changedFilePaths.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const result = await generateThreadDiff(
          initialCommitHash,
          changedFilePaths,
          workingDirectory
        );

        if (result.error) {
          setError(result.error);
        } else {
          setDiffResult(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate diff");
      } finally {
        setLoading(false);
      }
    };

    generateDiffs();
  }, [initialCommitHash, changedFilePaths, workingDirectory]);

  // Loading state
  if (loading) {
    return <LoadingState />;
  }

  // No git info available
  if (!initialCommitHash) {
    return <EmptyState message="No git information available for this thread" />;
  }

  // No file changes
  if (changedFilePaths.length === 0) {
    return <EmptyState message="No file changes in this thread" />;
  }

  // Error state
  if (error) {
    return <ErrorState error={error} />;
  }

  // No diff result
  if (!diffResult || diffResult.diff.files.length === 0) {
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DiffSummaryHeader
        fileCount={diffResult.diff.files.length}
        additions={totalStats.additions}
        deletions={totalStats.deletions}
        initialCommit={diffResult.initialCommit}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {diffResult.diff.files.map((file, index) => {
          const filePath = file.newPath ?? file.oldPath ?? `file-${index}`;

          // Reconstruct the raw diff for this single file
          // We need to create a diff string that InlineDiffBlock can parse
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
