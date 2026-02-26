import { memo } from "react";
import { ArrowUpRight, ChevronRight, FileCode } from "lucide-react";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  /** Whether the file diff body is collapsed */
  isFileCollapsed?: boolean;
  /** Callback to toggle file collapse */
  onToggleFileCollapse?: () => void;
  /** Additional CSS classes for the root element */
  className?: string;
}

/**
 * Compact header for inline diff display.
 * Click anywhere on the header (besides buttons) to collapse/expand.
 */
export const InlineDiffHeader = memo(function InlineDiffHeader({
  filePath,
  stats,
  onExpand,
  hasCollapsedRegions,
  allExpanded,
  onExpandAll,
  onCollapseAll,
  isFileCollapsed,
  onToggleFileCollapse,
  className,
}: InlineDiffHeaderProps) {
  // Extract just the filename for compact display
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-surface-700",
        onToggleFileCollapse && "cursor-pointer select-none",
        className,
      )}
      role={onToggleFileCollapse ? "button" : undefined}
      tabIndex={onToggleFileCollapse ? 0 : undefined}
      onClick={onToggleFileCollapse}
      onKeyDown={onToggleFileCollapse ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleFileCollapse();
        }
      } : undefined}
    >
      {/* Collapse chevron */}
      {onToggleFileCollapse && (
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-surface-400 transition-transform duration-150 flex-shrink-0",
            !isFileCollapsed && "rotate-90",
          )}
          aria-hidden="true"
        />
      )}

      {/* File icon */}
      <img
        src={getFileIconUrl(fileName)}
        alt=""
        className="w-4 h-4 flex-shrink-0"
        aria-hidden="true"
      />

      {/* File name + copy button, left-justified */}
      <span
        className="font-mono text-sm text-surface-200 truncate min-w-0"
        title={filePath}
      >
        {fileName}
      </span>
      <CopyButton text={filePath} label="Copy path" alwaysVisible />

      {/* Spacer pushes stats and actions to the right */}
      <div className="flex-1" />

      {/* Show full file toggle */}
      {hasCollapsedRegions && (
        <Tooltip content={allExpanded ? "Show hunks only" : "Show full file"}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); (allExpanded ? onCollapseAll : onExpandAll)?.(); }}
            className={cn(
              "p-1 hover:bg-zinc-700 rounded shrink-0",
              allExpanded && "text-accent-400",
            )}
            aria-label={allExpanded ? "Show hunks only" : "Show full file"}
          >
            <FileCode className="h-3.5 w-3.5 text-zinc-400" />
          </button>
        </Tooltip>
      )}

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

      {/* Open in full diff viewer */}
      {onExpand && (
        <Tooltip content="Open in full diff viewer">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onExpand(); }}
            className={cn(
              "p-1 hover:bg-zinc-700 rounded transition-opacity shrink-0",
              "opacity-0 group-hover:opacity-100",
            )}
            aria-label="Open in full diff viewer"
          >
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
          </button>
        </Tooltip>
      )}
    </div>
  );
});
