import { useState, useRef, useEffect, useCallback } from "react";
import {
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GitMerge,
  Archive,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
import { pullRequestService } from "@/entities/pull-requests/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface PullRequestItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: "pull-request") => void;
  tabIndex?: number;
  /** Index in the flat list for keyboard navigation */
  itemIndex?: number;
}

function prIcon(reviewIcon: TreeItemNode["reviewIcon"]): { Icon: LucideIcon; colorClass: string } {
  switch (reviewIcon) {
    case "approved":
      return { Icon: GitPullRequest, colorClass: "text-green-400" };
    case "changes-requested":
      return { Icon: GitPullRequestArrow, colorClass: "text-red-400" };
    case "review-required":
      return { Icon: GitPullRequest, colorClass: "text-blue-400" };
    case "draft":
      return { Icon: GitPullRequestDraft, colorClass: "text-surface-500" };
    case "merged":
      return { Icon: GitMerge, colorClass: "text-purple-400" };
    case "closed":
      return { Icon: GitPullRequestClosed, colorClass: "text-red-400" };
    default:
      return { Icon: GitPullRequest, colorClass: "text-surface-400" };
  }
}

/**
 * Pull request row in the tree menu.
 * Displays PR icon colored by status, and title.
 * Supports hover archive button with confirm pattern.
 */
export function PullRequestItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
  itemIndex = 0,
}: PullRequestItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Click outside to cancel confirmation
  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  const handleArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      await pullRequestService.archive(item.id);
    } finally {
      setIsArchiving(false);
      setConfirming(false);
    }
  }, [item.id]);

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving) return;

    if (confirming) {
      await handleArchive();
    } else {
      setConfirming(true);
    }
  };

  const handleClick = useCallback(() => {
    onSelect(item.id, "pull-request");
    if (item.isViewed === false) {
      pullRequestService.update(item.id, { isViewed: true });
    }
  }, [item.id, item.isViewed, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          handleClick();
          break;
      }
    },
    [handleClick],
  );

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-tree-item-index={itemIndex}
      tabIndex={tabIndex}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${TREE_INDENT_BASE}px` }}
      className={cn(
        "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
        "text-[13px] leading-[22px]",
        "transition-colors duration-75",
        "outline-none focus:bg-accent-500/10",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-300 hover:bg-accent-500/10",
      )}
    >
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        {(() => {
          const { Icon, colorClass } = prIcon(item.reviewIcon);
          return <Icon size={10} className={colorClass} />;
        })()}
      </span>
      <span className={cn("truncate flex-1")} title={item.title}>
        {item.title}
      </span>
      {/* Archive button - same confirm pattern as terminal-item.tsx */}
      <button
        ref={buttonRef}
        className={cn(
          "h-[12px] flex items-center justify-center transition-colors flex-shrink-0",
          isArchiving
            ? "text-surface-500"
            : confirming
              ? "opacity-100 text-surface-300 text-[11px] font-medium"
              : "opacity-0 group-hover:opacity-100 text-surface-500 hover:text-surface-300",
        )}
        onClick={handleArchiveClick}
        aria-label={confirming ? "Confirm archive" : "Archive pull request"}
        disabled={isArchiving}
      >
        {isArchiving ? (
          <Loader2 size={12} className="animate-spin" />
        ) : confirming ? (
          "confirm"
        ) : (
          <Archive size={12} />
        )}
      </button>
    </div>
  );
}
