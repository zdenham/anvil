/**
 * ChangesView — Main container for the Changes content pane.
 *
 * Shows a full-width diff area with a summary header and virtualized
 * file cards. Commits navigation lives in the tree menu, not here.
 */

import { useMemo, useEffect, useRef } from "react";
import { PanelRight } from "lucide-react";
import type { ChangesContentProps } from "@/components/content-pane/types";
import { useChangesData } from "./use-changes-data";
import { ChangesDiffContent, type ChangesDiffContentRef } from "./changes-diff-content";
import { ChangesFileList } from "./changes-file-list";
import { MAX_DISPLAYED_FILES } from "./changes-diff-fetcher";
import { useChangesViewStore } from "@/stores/changes-view-store";

function ChangesView({ repoId, worktreeId, uncommittedOnly, commitHash }: ChangesContentProps) {
  const data = useChangesData({ repoId, worktreeId, uncommittedOnly, commitHash });
  const diffContentRef = useRef<ChangesDiffContentRef>(null);
  const selectedFilePath = useChangesViewStore((s) => s.selectedFilePath);
  const isFilePaneOpen = useChangesViewStore((s) => s.isFilePaneOpen);
  const toggleFilePane = useChangesViewStore((s) => s.toggleFilePane);

  // Sync changed file paths to the cross-component store
  useEffect(() => {
    useChangesViewStore.getState().setActive(worktreeId, data.changedFilePaths);
    return () => {
      useChangesViewStore.getState().clearActive();
    };
  }, [worktreeId, data.changedFilePaths]);

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
        isFilePaneOpen={isFilePaneOpen}
        onToggleFilePane={toggleFilePane}
      />

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <ChangesDiffContent
            ref={diffContentRef}
            files={data.files}
            rawDiffsByFile={data.rawDiffsByFile}
            totalFileCount={data.totalFileCount}
            worktreePath={data.worktreePath}
            commitHash={commitHash}
            uncommittedOnly={uncommittedOnly}
          />
        </div>
        {isFilePaneOpen && (
          <ChangesFileList
            files={data.files}
            onSelectFile={(path) => useChangesViewStore.getState().selectFile(path)}
          />
        )}
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
  isFilePaneOpen: boolean;
  onToggleFilePane: () => void;
}

function SummaryHeader({
  fileCount,
  files,
  mergeBase,
  defaultBranch,
  branchName,
  uncommittedOnly,
  commitHash,
  isFilePaneOpen,
  onToggleFilePane,
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
      <button
        type="button"
        onClick={onToggleFilePane}
        className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
        aria-label={isFilePaneOpen ? "Hide file list" : "Show file list"}
        title={isFilePaneOpen ? "Hide file list" : "Show file list"}
      >
        <PanelRight size={16} />
      </button>
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
