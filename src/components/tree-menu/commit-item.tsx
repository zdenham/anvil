import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface CommitItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
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
      <span className="truncate flex-1" title={item.commitMessage}>
        {item.commitMessage}
      </span>
      {(item.commitAuthor || item.commitRelativeDate) && (
        <span className="flex-shrink-0 text-surface-500 text-xs truncate max-w-[120px]">
          {item.commitAuthor}
          {item.commitAuthor && item.commitRelativeDate && " \u00B7 "}
          {item.commitRelativeDate}
        </span>
      )}
    </div>
  );
}
