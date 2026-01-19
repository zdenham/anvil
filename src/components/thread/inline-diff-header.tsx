import { memo } from "react";
import { FileEdit, ArrowUpRight, ChevronsUpDown, ChevronsDownUp } from "lucide-react";

interface InlineDiffHeaderProps {
  /** File path being changed */
  filePath: string;
  /** Diff statistics */
  stats: { additions: number; deletions: number };
  /** Callback when user wants to open full diff viewer */
  onExpand?: () => void;
  /** Whether there are any collapsible regions */
  hasCollapsedRegions?: boolean;
  /** Whether all regions are currently expanded */
  allExpanded?: boolean;
  /** Callback to expand all collapsed regions */
  onExpandAll?: () => void;
  /** Callback to collapse all regions */
  onCollapseAll?: () => void;
}

/**
 * Compact header for inline diff display.
 * Shows file name, change stats, and optional expand button.
 */
export const InlineDiffHeader = memo(function InlineDiffHeader({
  filePath,
  stats,
  onExpand,
  hasCollapsedRegions,
  allExpanded,
  onExpandAll,
  onCollapseAll,
}: InlineDiffHeaderProps) {
  // Extract just the filename for compact display
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-surface-700">
      {/* File icon */}
      <FileEdit className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />

      {/* File name with tooltip for full path */}
      <span
        className="font-mono text-sm text-surface-200 truncate flex-1 min-w-0"
        title={filePath}
      >
        {fileName}
      </span>

      {/* Stats */}
      {(stats.additions > 0 || stats.deletions > 0) && (
        <div className="flex items-center gap-1.5 text-xs font-mono flex-shrink-0">
          {stats.additions > 0 && (
            <span className="text-emerald-400">+{stats.additions}</span>
          )}
          {stats.deletions > 0 && (
            <span className="text-red-400">-{stats.deletions}</span>
          )}
        </div>
      )}

      {/* Expand/Collapse all button */}
      {hasCollapsedRegions && (
        <button
          type="button"
          onClick={allExpanded ? onCollapseAll : onExpandAll}
          className="
            text-xs text-surface-400 hover:text-surface-200
            flex items-center gap-1
            px-1.5 py-0.5 rounded
            hover:bg-surface-700
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
          "
          aria-label={allExpanded ? "Collapse unchanged regions" : "Expand unchanged regions"}
          title={allExpanded ? "Collapse unchanged regions" : "Expand unchanged regions"}
        >
          {allExpanded ? (
            <ChevronsDownUp className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronsUpDown className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          <span>{allExpanded ? "Collapse" : "Expand"}</span>
        </button>
      )}

      {/* Expand button */}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="
            p-1 rounded
            text-surface-400 hover:text-surface-200
            hover:bg-surface-700
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
          "
          aria-label="Expand to full diff view"
          title="Open in full diff viewer"
        >
          <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
