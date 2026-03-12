import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";

export interface RepoItemProps {
  item: TreeItemNode;
}

/**
 * Repo group header in the tree menu.
 * Renders the repo name as a collapsible section header.
 */
export function RepoItem({ item }: RepoItemProps) {
  const handleToggle = () => treeMenuService.toggleSection(item.id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      treeMenuService.toggleSection(item.id);
    }
  };

  return (
    <div
      role="treeitem"
      aria-expanded={item.isExpanded}
      tabIndex={-1}
      data-tree-item-id={item.id}
      style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
      className={cn(
        "group flex items-center gap-1.5 pr-1 py-2 cursor-pointer select-none",
        item.depth === 0 && "pt-3",
        "text-[11px] font-semibold uppercase tracking-wider text-surface-400",
        "transition-colors duration-75",
      )}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
    >
      <span className="truncate">{item.title}</span>

      <button
        type="button"
        className="ml-auto flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-surface-700 text-surface-500"
        onClick={(e) => { e.stopPropagation(); treeMenuService.toggleSection(item.id); }}
        aria-label={item.isExpanded ? "Collapse project" : "Expand project"}
      >
        {item.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
    </div>
  );
}
