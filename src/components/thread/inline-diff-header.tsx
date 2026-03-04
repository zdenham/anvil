import { memo, useCallback } from "react";
import { ArrowUpRight, ChevronRight, FileCode, MessageSquare } from "lucide-react";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { CopyButton } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOptionalDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";

import { useStore } from "zustand";

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
  /** Whether the header is currently stuck (scrolled past its natural position) */
  isSticky?: boolean;
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
  isSticky,
  className,
}: InlineDiffHeaderProps) {
  // Extract just the filename for compact display
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div
      data-testid="inline-diff-header"
      className={cn(
        "group flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-surface-700 sticky top-0 z-10 shadow-[0_2px_4px_-1px_rgba(0,0,0,0.3)]",
        !isSticky && "rounded-t-lg",
        onToggleFileCollapse && "cursor-pointer select-none",
        isFileCollapsed && "rounded-b-lg border-b-0 shadow-none",
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

      {/* File path + copy button, left-justified */}
      <span
        className="font-mono text-sm text-surface-200 truncate min-w-0"
        title={filePath}
      >
        {filePath}
      </span>
      <CopyButton text={filePath} label="Copy path" alwaysVisible />

      {/* Spacer pushes stats and actions to the right */}
      <div className="flex-1" />

      {/* Comment count badge */}
      <CommentCountBadge filePath={filePath} />

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

/** Badge showing unresolved comment count for a file, if inside a DiffCommentProvider. */
function CommentCountBadge({ filePath }: { filePath: string }) {
  const store = useOptionalDiffCommentStore();
  if (!store) return null;
  return <CommentCountBadgeInner filePath={filePath} store={store} />;
}

function CommentCountBadgeInner({
  filePath,
  store,
}: {
  filePath: string;
  store: NonNullable<ReturnType<typeof useOptionalDiffCommentStore>>;
}) {
  const { worktreeId, threadId } = useStore(store);

  const count = useCommentStore(
    useCallback(
      (s) => {
        const comments = s.getByFile(worktreeId, filePath, threadId);
        return comments.filter((c) => !c.resolved).length;
      },
      [worktreeId, filePath, threadId],
    ),
  );

  if (count === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/20 text-amber-400 flex-shrink-0"
      title={`${count} unresolved comment${count !== 1 ? "s" : ""}`}
    >
      <MessageSquare className="w-2.5 h-2.5" />
      {count}
    </span>
  );
}

