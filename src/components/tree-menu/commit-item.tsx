import { GitCommit } from "lucide-react";
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface CommitItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}

/** Shorten a git author name: first name only, or full string if no spaces. */
function shortAuthor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(" ")) return trimmed;
  return trimmed.split(" ")[0];
}

/**
 * Commit child item under the Changes folder.
 * Shows truncated commit message with author + relative date as secondary text.
 * Clicking navigates to the commit diff view.
 */
export function CommitItem({ item, isSelected, onNavigate }: CommitItemProps) {
  const handleClick = () => {
    onNavigate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate();
    }
  };

  const indentPx = TREE_INDENT_BASE + TREE_INDENT_STEP;
  const displayAuthor = item.commitAuthor
    ? shortAuthor(item.commitAuthor)
    : undefined;

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${indentPx}px` }}
      className={cn(
        "flex items-center gap-1.5 w-full pr-2 py-0.5 cursor-pointer select-none",
        "text-[13px] leading-[22px]",
        "transition-colors duration-75",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-400 hover:text-surface-200 hover:bg-accent-500/10"
      )}
    >
      <GitCommit size={12} className="flex-shrink-0 w-3 h-3" />
      <span className="truncate flex-1" title={item.commitMessage}>
        {item.commitMessage}
      </span>
      {(displayAuthor || item.commitRelativeDate) && (
        <span className="flex-shrink-0 text-surface-500 text-xs whitespace-nowrap">
          {displayAuthor}
          {displayAuthor && item.commitRelativeDate && " \u00B7 "}
          {item.commitRelativeDate}
        </span>
      )}
    </div>
  );
}
