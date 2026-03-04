import { FilePenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface UncommittedItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}

/**
 * "Uncommitted Changes" child item under the Changes folder.
 * Clicking navigates to the uncommitted-only diff view.
 */
export function UncommittedItem({ item, isSelected, onNavigate }: UncommittedItemProps) {
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
      data-testid="uncommitted-item"
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
      <FilePenLine size={10} className="flex-shrink-0 w-2.5 h-2.5" />
      <span className="truncate">{item.title}</span>
    </div>
  );
}
