import { useMemo, useState, useCallback, useEffect } from "react";
import type { AnnotatedFile, ParsedDiffFile } from "./types";
import { parseDiff } from "@/lib/diff-parser";
import { buildAnnotatedFiles } from "@/lib/annotated-file-builder";
import { highlightAnnotatedFiles } from "@/lib/highlight-annotated-files";
import { DiffHeader } from "./diff-header";
import { DiffFileCard } from "./diff-file-card";
import { FileCardErrorBoundary } from "./file-card-error-boundary";
import { DiffEmptyState } from "./diff-empty-state";
import { DiffErrorState } from "./diff-error-state";
import { DiffViewerSkeleton } from "./diff-viewer-skeleton";
import { SkipLinks } from "./skip-links";
import { useLiveAnnouncer, LiveAnnouncerRegion } from "./use-live-announcer";
import type { FileChange } from "@/lib/types/agent-messages";
import { logger } from "@/lib/logger-client";
import {
  generateThreadDiff,
  extractFileChanges,
} from "@/lib/utils/thread-diff-generator";
import { gitCommands } from "@/lib/tauri-commands";

export interface DiffViewerProps {
  /**
   * File changes from the agent, keyed by path.
   * Contains path and operation info (diffs are generated on-demand).
   */
  fileChanges: Map<string, FileChange>;
  /**
   * REQUIRED: Full file contents for building annotated view.
   * Key: file path, Value: array of lines (already split).
   */
  fullFileContents: Record<string, string[]>;
  /** Working directory for the thread */
  workingDirectory: string;
  /** Optional: Initial commit hash for diff generation (required for proper diffing) */
  initialCommitHash?: string;
  /** Optional: Custom priority scoring function */
  priorityFn?: (file: ParsedDiffFile) => number;
}

export interface DiffViewerState {
  /** Annotated files (full file + diff annotations merged) */
  files: AnnotatedFile[];
  /** Loading state */
  loading: boolean;
  /** Error message if parsing failed */
  error: string | null;
  /** Whether all collapsed regions are expanded */
  allExpanded: boolean;
}

/**
 * Main diff viewer container.
 * Parses diffs, manages expand/collapse state, and renders file cards.
 *
 * Accessibility features:
 * - Skip links for keyboard navigation between files
 * - Live announcements for screen readers
 * - Full keyboard navigation support
 * - ARIA table semantics for diff content
 */
export function DiffViewer({
  fileChanges,
  fullFileContents,
  workingDirectory,
  initialCommitHash,
  priorityFn,
}: DiffViewerProps) {
  const [allExpanded, setAllExpanded] = useState(false);
  const [highlightedFiles, setHighlightedFiles] = useState<AnnotatedFile[]>([]);
  const [isHighlighting, setIsHighlighting] = useState(true);
  const [diffLoading, setDiffLoading] = useState(true);
  const [generatedDiff, setGeneratedDiff] = useState<string>("");
  const [diffError, setDiffError] = useState<string | null>(null);
  const { announce, setRef } = useLiveAnnouncer();

  // Generate diffs on-demand using the Rust backend
  useEffect(() => {
    async function fetchDiffs() {
      if (fileChanges.size === 0) {
        setDiffLoading(false);
        setGeneratedDiff("");
        return;
      }

      // Need initialCommitHash for proper diff generation
      // If not provided, try to get current HEAD as fallback
      let baseCommit = initialCommitHash;
      if (!baseCommit && workingDirectory) {
        try {
          baseCommit = await gitCommands.getHeadCommit(workingDirectory);
        } catch {
          // Can't get HEAD - diffs won't work properly
          setDiffError("Unable to determine base commit for diff");
          setDiffLoading(false);
          return;
        }
      }

      if (!baseCommit) {
        setDiffError("No base commit available for diff generation");
        setDiffLoading(false);
        return;
      }

      try {
        // Extract file change info from the Map
        const changes = extractFileChanges(
          Array.from(fileChanges.values())
        );

        // Generate diffs via Rust backend
        const result = await generateThreadDiff(
          baseCommit,
          changes,
          workingDirectory
        );

        if (result.error) {
          setDiffError(result.error);
        } else {
          // Reconstruct raw diff string from parsed diff for downstream use
          const rawDiff = result.diff.files
            .map((file) => {
              const lines: string[] = [];
              const oldPath = file.oldPath ?? "/dev/null";
              const newPath = file.newPath ?? "/dev/null";
              lines.push(`diff --git a/${oldPath} b/${newPath}`);
              if (file.type === "added") lines.push("new file mode 100644");
              else if (file.type === "deleted") lines.push("deleted file mode 100644");
              lines.push(`--- ${file.oldPath ? `a/${file.oldPath}` : "/dev/null"}`);
              lines.push(`+++ ${file.newPath ? `b/${file.newPath}` : "/dev/null"}`);
              for (const hunk of file.hunks) {
                lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.sectionHeader ? ` ${hunk.sectionHeader}` : ""}`);
                for (const line of hunk.lines) {
                  const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
                  lines.push(`${prefix}${line.content}`);
                }
              }
              return lines.join("\n");
            })
            .join("\n");
          setGeneratedDiff(rawDiff);
        }
      } catch (err) {
        setDiffError(err instanceof Error ? err.message : "Failed to generate diff");
      } finally {
        setDiffLoading(false);
      }
    }

    setDiffLoading(true);
    setDiffError(null);
    fetchDiffs();
  }, [fileChanges, workingDirectory, initialCommitHash]);

  // Parse and annotate all files (sync) - uses generated diff
  const { files, stats, error, rawDiffs } = useMemo(() => {
    const emptyRawDiffs: Record<string, string> = {};
    if (diffLoading || !generatedDiff) {
      return { files: [], stats: { additions: 0, deletions: 0 }, error: diffError, rawDiffs: emptyRawDiffs };
    }

    try {
      const parsedDiff = parseDiff(generatedDiff);

      // Build raw diffs map for error fallback
      const rawDiffsMap: Record<string, string> = {};
      for (const file of parsedDiff.files) {
        const path = file.newPath ?? file.oldPath ?? "";
        if (path) {
          // Reconstruct individual file diff
          const lines: string[] = [];
          const oldPath = file.oldPath ?? "/dev/null";
          const newPath = file.newPath ?? "/dev/null";
          lines.push(`diff --git a/${oldPath} b/${newPath}`);
          if (file.type === "added") lines.push("new file mode 100644");
          else if (file.type === "deleted") lines.push("deleted file mode 100644");
          lines.push(`--- ${file.oldPath ? `a/${file.oldPath}` : "/dev/null"}`);
          lines.push(`+++ ${file.newPath ? `b/${file.newPath}` : "/dev/null"}`);
          for (const hunk of file.hunks) {
            lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.sectionHeader ? ` ${hunk.sectionHeader}` : ""}`);
            for (const line of hunk.lines) {
              const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
              lines.push(`${prefix}${line.content}`);
            }
          }
          rawDiffsMap[path] = lines.join("\n");
        }
      }

      const annotatedFiles = buildAnnotatedFiles(
        parsedDiff,
        fullFileContents,
        priorityFn
      );

      // Sort by priority (highest first)
      annotatedFiles.sort((a, b) => b.priority - a.priority);

      // Calculate total stats
      const totalStats = annotatedFiles.reduce(
        (acc, file) => ({
          additions: acc.additions + file.file.stats.additions,
          deletions: acc.deletions + file.file.stats.deletions,
        }),
        { additions: 0, deletions: 0 }
      );

      return { files: annotatedFiles, stats: totalStats, error: null, rawDiffs: rawDiffsMap };
    } catch (err) {
      logger.error("Failed to parse diff:", err);
      return {
        files: [],
        stats: { additions: 0, deletions: 0 },
        error: err instanceof Error ? err.message : "Failed to parse diff",
        rawDiffs: emptyRawDiffs,
      };
    }
  }, [generatedDiff, diffLoading, diffError, fullFileContents, priorityFn]);

  // Apply syntax highlighting asynchronously
  useEffect(() => {
    if (files.length === 0 || error) {
      setIsHighlighting(false);
      setHighlightedFiles([]);
      return;
    }

    let cancelled = false;
    setIsHighlighting(true);

    async function applyHighlighting() {
      try {
        // Deep clone files to avoid mutating the memoized value
        const clonedFiles: AnnotatedFile[] = files.map((file) => ({
          ...file,
          lines: file.lines.map((line) => ({ ...line })),
        }));

        await highlightAnnotatedFiles(clonedFiles, fullFileContents);

        if (!cancelled) {
          setHighlightedFiles(clonedFiles);
          setIsHighlighting(false);
        }
      } catch (err) {
        logger.warn("Syntax highlighting failed, falling back to plain text:", err);
        if (!cancelled) {
          // Fall back to unhighlighted files
          setHighlightedFiles(files);
          setIsHighlighting(false);
        }
      }
    }

    applyHighlighting();

    return () => {
      cancelled = true;
    };
  }, [files, fullFileContents, error]);

  const handleExpandAll = useCallback(() => {
    setAllExpanded(true);
    announce("Expanded all collapsed regions");
  }, [announce]);

  const handleCollapseAll = useCallback(() => {
    setAllExpanded(false);
    announce("Collapsed all regions");
  }, [announce]);

  // Error state with raw diff fallback
  if (error) {
    const combinedRawDiff = Object.values(rawDiffs).join("\n\n");
    return (
      <DiffErrorState
        error={error}
        rawDiff={combinedRawDiff}
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Loading state while generating diffs or syntax highlighting
  if (diffLoading || isHighlighting) {
    return <DiffViewerSkeleton />;
  }

  // Empty state
  if (files.length === 0) {
    return <DiffEmptyState />;
  }

  // Use highlighted files for rendering (has tokens attached)
  const displayFiles = highlightedFiles.length > 0 ? highlightedFiles : files;

  return (
    <div className="flex flex-col gap-4">
      {/* Live announcer for screen readers */}
      <LiveAnnouncerRegion setRef={setRef} />

      {/* Skip links for keyboard navigation between files */}
      <SkipLinks files={displayFiles} />

      <DiffHeader
        fileCount={displayFiles.length}
        totalAdditions={stats.additions}
        totalDeletions={stats.deletions}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        allExpanded={allExpanded}
      />

      <div className="flex flex-col gap-4">
        {displayFiles.map((file, index) => (
          <FileCardErrorBoundary
            key={file.file.newPath ?? file.file.oldPath ?? index}
            filePath={file.file.newPath ?? file.file.oldPath ?? "Unknown"}
            rawDiff={rawDiffs[file.file.newPath ?? file.file.oldPath ?? ""]}
          >
            <DiffFileCard
              file={file}
              fileIndex={index}
              allExpanded={allExpanded}
            />
          </FileCardErrorBoundary>
        ))}
      </div>
    </div>
  );
}
