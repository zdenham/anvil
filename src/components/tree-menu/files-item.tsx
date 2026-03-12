import { FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface FilesItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}

/**
 * "Files" leaf entry in the tree menu.
 * Clicking opens the right panel's Files tab for the parent worktree.
 */
export function FilesItem({ item, isSelected, onNavigate }: FilesItemProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNavigate();
    }
  };

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-tree-item-id={item.id}
      tabIndex={-1}
      onClick={onNavigate}
      onKeyDown={handleKeyDown}
      style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
      className={cn(
        "flex items-center gap-1.5 w-full pr-2 py-1 text-xs",
        "hover:bg-surface-800 rounded cursor-pointer select-none",
        "transition-colors duration-75",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-400 hover:text-surface-200",
      )}
    >
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        <FolderTree size={11} />
      </span>
      <span className="truncate">Files</span>
    </div>
  );
}
