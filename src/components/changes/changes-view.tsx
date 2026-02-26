/**
 * ChangesView — Main container for the Changes content pane.
 *
 * Shows a full-width diff area with a summary header and virtualized
 * file cards. Commits navigation lives in the tree menu, not here.
 */

import { useMemo, useEffect, useRef } from "react";
import type { ChangesContentProps } from "@/components/content-pane/types";
import type { FileStats } from "@/stores/changes-view-store";
import { useChangesData } from "./use-changes-data";
import { ChangesDiffContent, type ChangesDiffContentRef } from "./changes-diff-content";
import { MAX_DISPLAYED_FILES } from "./changes-diff-fetcher";
import { useChangesViewStore } from "@/stores/changes-view-store";

function ChangesView({ repoId, worktreeId, uncommittedOnly, commitHash }: ChangesContentProps) {
  const data = useChangesData({ repoId, worktreeId, uncommittedOnly, commitHash });
  const diffContentRef = useRef<ChangesDiffContentRef>(null);
  const selectedFilePath = useChangesViewStore((s) => s.selectedFilePath);

  // Build per-file stats map from parsed diff files
  const fileStatsMap = useMemo(() => {
    const map = new Map<string, FileStats>();
    for (const file of data.files) {
      const path = file.newPath ?? file.oldPath;
      if (path) {
        map.set(path, { additions: file.stats.additions, deletions: file.stats.deletions });
      }
    }
    return map;
  }, [data.files]);

  // Sync changed file paths + stats to the cross-component store
  useEffect(() => {
    useChangesViewStore.getState().setActive(worktreeId, data.changedFilePaths, fileStatsMap);
    return () => {
      useChangesViewStore.getState().clearActive();
    };
  }, [worktreeId, data.changedFilePaths, fileStatsMap]);

  // Scroll to file when selected from the file browser
  useEffect(() => {
    if (!selectedFilePath || !diffContentRef.current) return;

    const index = data.files.findIndex(
      (f) => (f.newPath ?? f.oldPath) === selectedFilePath
    );
    if (index >= 0) {
      diffContentRef.current.scrollToIndex(index);
    }

    // Clear selection after scrolling (one-shot trigger)
    useChangesViewStore.getState().selectFile(null);
  }, [selectedFilePath, data.files]);

  if (data.loading && !data.parsedDiff) {
    return <LoadingState />;
  }

  if (data.error) {
    return <ErrorState message={data.error} />;
  }

  if (data.files.length === 0 && !data.loading) {
    return <EmptyState defaultBranch={data.defaultBranch} />;
  }

  return (
    <div className="flex flex-col h-full">
      <SummaryHeader
        fileCount={data.totalFileCount}
        files={data.files}
        mergeBase={data.mergeBase}
        defaultBranch={data.defaultBranch}
        branchName={data.branchName}
        uncommittedOnly={uncommittedOnly}
        commitHash={commitHash}
      />

      <div className="flex-1 min-h-0">
        <ChangesDiffContent
          ref={diffContentRef}
          files={data.files}
          rawDiffsByFile={data.rawDiffsByFile}
          fileContents={data.fileContents}
          totalFileCount={data.totalFileCount}
          worktreePath={data.worktreePath}
          commitHash={commitHash}
          uncommittedOnly={uncommittedOnly}
        />
      </div>

      {data.totalFileCount > MAX_DISPLAYED_FILES && (
        <div className="px-4 py-2 text-xs text-surface-500 border-t border-surface-700">
          Showing {MAX_DISPLAYED_FILES} of {data.totalFileCount} files
        </div>
      )}
    </div>
  );
}

export default ChangesView;

// ─── Sub-components ─────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full text-surface-400 text-sm">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 border-2 border-surface-500 border-t-transparent rounded-full animate-spin" />
        Loading changes...
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center max-w-md">
        <p className="text-sm text-red-400 mb-2">Failed to load changes</p>
        <p className="text-xs text-surface-500">{message}</p>
      </div>
    </div>
  );
}

function EmptyState({ defaultBranch }: { defaultBranch: string | null }) {
  return (
    <div className="flex items-center justify-center h-full text-surface-400 text-sm">
      No changes from {defaultBranch ?? "main"}
    </div>
  );
}

interface SummaryHeaderProps {
  fileCount: number;
  files: { stats: { additions: number; deletions: number } }[];
  mergeBase: string | null;
  defaultBranch: string | null;
  branchName: string | null;
  uncommittedOnly?: boolean;
  commitHash?: string;
}

function SummaryHeader({
  fileCount,
  files,
  mergeBase,
  defaultBranch,
  branchName,
  uncommittedOnly,
  commitHash,
}: SummaryHeaderProps) {
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const f of files) {
      adds += f.stats.additions;
      dels += f.stats.deletions;
    }
    return { totalAdditions: adds, totalDeletions: dels };
  }, [files]);

  const subtext = getSubtext({ mergeBase, defaultBranch, branchName, uncommittedOnly, commitHash });

  return (
    <div className="px-4 py-3 border-b border-surface-700 flex-shrink-0 flex items-center justify-between">
      <div>
        <div className="text-sm text-surface-200">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed
          {totalAdditions > 0 && (
            <span className="text-green-400 ml-2">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400 ml-2">-{totalDeletions}</span>
          )}
        </div>
        {subtext && (
          <div className="text-xs text-surface-500 mt-0.5">{subtext}</div>
        )}
      </div>
    </div>
  );
}

function getSubtext(params: {
  mergeBase: string | null;
  defaultBranch: string | null;
  branchName: string | null;
  uncommittedOnly?: boolean;
  commitHash?: string;
}): string | null {
  const { mergeBase, defaultBranch, branchName, uncommittedOnly, commitHash } = params;

  if (commitHash) {
    return `Commit ${commitHash.slice(0, 8)}`;
  }
  if (uncommittedOnly) {
    return "relative to HEAD";
  }
  if (mergeBase && branchName) {
    return `${branchName} \u2192 ${defaultBranch ?? "main"}`;
  }
  return null;
}
