import { useMemo, useState, useCallback } from "react";
import type { AnnotatedFile, ParsedDiffFile } from "./types";
import { parseDiff } from "@/lib/diff-parser";
import { buildAnnotatedFiles } from "@/lib/annotated-file-builder";
import { DiffHeader } from "./diff-header";
import { DiffFileCard } from "./diff-file-card";
import { FileCardErrorBoundary } from "./file-card-error-boundary";
import { DiffEmptyState } from "./diff-empty-state";
import { DiffErrorState } from "./diff-error-state";
import { SkipLinks } from "./skip-links";
import { useLiveAnnouncer, LiveAnnouncerRegion } from "./use-live-announcer";
import type { FileChange } from "@/lib/types/agent-messages";
import { logger } from "@/lib/logger-client";

export interface DiffViewerProps {
  /**
   * File changes from the agent, keyed by path.
   * Each FileChange contains the full cumulative diff from HEAD.
   */
  fileChanges: Map<string, FileChange>;
  /**
   * REQUIRED: Full file contents for building annotated view.
   * Key: file path, Value: array of lines (already split).
   */
  fullFileContents: Record<string, string[]>;
  /** Working directory for the thread */
  workingDirectory: string;
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
  workingDirectory: _workingDirectory,
  priorityFn,
}: DiffViewerProps) {
  const [allExpanded, setAllExpanded] = useState(false);
  const { announce, setRef } = useLiveAnnouncer();

  // Parse and annotate all files
  const { files, stats, error, rawDiffs } = useMemo(() => {
    try {
      // Combine all diffs into a single diff text
      const allDiffs: string[] = [];
      const rawDiffsMap: Record<string, string> = {};

      for (const [, change] of fileChanges) {
        if (change.diff) {
          allDiffs.push(change.diff);
          rawDiffsMap[change.path] = change.diff;
        }
      }

      if (allDiffs.length === 0) {
        return { files: [], stats: { additions: 0, deletions: 0 }, error: null, rawDiffs: {} };
      }

      const combinedDiff = allDiffs.join("\n");
      const parsedDiff = parseDiff(combinedDiff);

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
      // Collect raw diffs for error fallback
      const rawDiffsMap: Record<string, string> = {};
      for (const [path, change] of fileChanges) {
        if (change.diff) {
          rawDiffsMap[path] = change.diff;
        }
      }
      return {
        files: [],
        stats: { additions: 0, deletions: 0 },
        error: err instanceof Error ? err.message : "Failed to parse diff",
        rawDiffs: rawDiffsMap,
      };
    }
  }, [fileChanges, fullFileContents, priorityFn]);

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

  // Empty state
  if (files.length === 0) {
    return <DiffEmptyState />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Live announcer for screen readers */}
      <LiveAnnouncerRegion setRef={setRef} />

      {/* Skip links for keyboard navigation between files */}
      <SkipLinks files={files} />

      <DiffHeader
        fileCount={files.length}
        totalAdditions={stats.additions}
        totalDeletions={stats.deletions}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        allExpanded={allExpanded}
      />

      <div className="flex flex-col gap-4">
        {files.map((file, index) => (
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
