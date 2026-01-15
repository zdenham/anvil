import { memo } from "react";
import { ChevronDown, ChevronUp, Files } from "lucide-react";

interface DiffHeaderProps {
  /** Number of files in the diff */
  fileCount: number;
  /** Total additions across all files */
  totalAdditions: number;
  /** Total deletions across all files */
  totalDeletions: number;
  /** Whether all collapsed regions are expanded */
  allExpanded: boolean;
  /** Callback to expand all regions */
  onExpandAll: () => void;
  /** Callback to collapse all regions */
  onCollapseAll: () => void;
}

/**
 * Header component for the diff viewer.
 * Shows file count, stats, and expand/collapse controls.
 *
 * Accessibility features:
 * - Toolbar role with aria-label
 * - Keyboard-accessible buttons
 * - Focus management
 */
export const DiffHeader = memo(function DiffHeader({
  fileCount,
  totalAdditions,
  totalDeletions,
  allExpanded,
  onExpandAll,
  onCollapseAll,
}: DiffHeaderProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow escape to blur the toolbar
    if (e.key === "Escape") {
      (e.target as HTMLElement).blur();
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Diff viewer controls"
      className="flex items-center justify-between px-4 py-3 bg-surface-800 rounded-lg mb-4"
      onKeyDown={handleKeyDown}
    >
      {/* File count and stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-surface-300">
          <Files className="w-4 h-4" aria-hidden="true" />
          <span className="text-sm font-medium">
            {fileCount} file{fileCount !== 1 ? "s" : ""} changed
          </span>
        </div>

        {/* Stats */}
        {(totalAdditions > 0 || totalDeletions > 0) && (
          <div className="flex items-center gap-3 text-sm font-mono">
            {totalAdditions > 0 && (
              <span className="text-emerald-400" aria-label={`${totalAdditions} additions`}>
                +{totalAdditions}
              </span>
            )}
            {totalDeletions > 0 && (
              <span className="text-red-400" aria-label={`${totalDeletions} deletions`}>
                -{totalDeletions}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Expand/Collapse controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={allExpanded ? onCollapseAll : onExpandAll}
          className="
            inline-flex items-center gap-1.5 px-3 py-1.5
            text-sm text-surface-400
            hover:text-white hover:bg-surface-700
            rounded transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
          "
          aria-pressed={allExpanded}
        >
          {allExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
              Collapse All
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
              Expand All
            </>
          )}
        </button>
      </div>
    </div>
  );
});
