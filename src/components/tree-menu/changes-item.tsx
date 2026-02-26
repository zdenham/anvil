import { ChevronRight, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { treeMenuService } from "@/stores/tree-menu/service";
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface ChangesItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}

/**
 * "Changes" folder entry in the tree menu.
 * Acts as a collapsible parent for Uncommitted Changes and commit sub-items.
 * Clicking the label navigates to the full worktree diff.
 * Clicking the chevron toggles expansion.
 */
export function ChangesItem({ item, isSelected, onNavigate }: ChangesItemProps) {
  const handleClick = async () => {
    if (isSelected) {
      await treeMenuService.toggleSection(item.id);
    } else {
      onNavigate();
    }
  };

  const handleChevronToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await treeMenuService.toggleSection(item.id);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      await handleClick();
    }
  };

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={item.isExpanded}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${TREE_INDENT_BASE}px` }}
      className={cn(
        "flex items-center gap-1.5 w-full pr-2 py-1 text-xs",
        "hover:bg-surface-800 rounded cursor-pointer select-none",
        "transition-colors duration-75",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-400 hover:text-surface-200"
      )}
    >
      {isSelected || item.isExpanded ? (
        <button
          type="button"
          className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
          onClick={handleChevronToggle}
          aria-label={item.isExpanded ? "Collapse changes" : "Expand changes"}
        >
          <ChevronRight
            size={12}
            className={cn(
              "tree-chevron transition-transform duration-150",
              item.isExpanded && "rotate-90"
            )}
          />
        </button>
      ) : (
        <span className="flex-shrink-0 w-3 flex items-center justify-center">
          <GitCompare size={11} />
        </span>
      )}
      <span className="truncate">Changes</span>
    </div>
  );
}
