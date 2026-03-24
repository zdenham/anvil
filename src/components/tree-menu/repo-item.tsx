import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ChevronDown, EyeOff, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";

export interface RepoItemProps {
  item: TreeItemNode;
  onHideRepo?: (repoId: string) => void;
  onRemoveRepo?: (repoId: string, repoName: string) => void;
}

/**
 * Repo group header in the tree menu.
 * Renders the repo name as a collapsible section header with right-click context menu.
 */
export function RepoItem({ item, onHideRepo, onRemoveRepo }: RepoItemProps) {
  const handleToggle = () => treeMenuService.toggleSection(item.id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      treeMenuService.toggleSection(item.id);
    }
  };

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ top: 0, left: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ top: e.clientY, left: e.clientX });
    setShowContextMenu(true);
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showContextMenu]);

  return (
    <>
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
        onContextMenu={handleContextMenu}
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

      {showContextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5 min-w-[180px]"
          style={{ top: contextMenuPosition.top, left: contextMenuPosition.left }}
        >
          {onHideRepo && (
            <RepoCtxItem
              icon={EyeOff}
              label="Hide project"
              onClick={() => { setShowContextMenu(false); onHideRepo(item.id); }}
            />
          )}
          {onHideRepo && onRemoveRepo && <div className="h-px bg-surface-700 my-1" />}
          {onRemoveRepo && (
            <RepoCtxItem
              icon={Trash2}
              label="Remove from Anvil"
              className="text-red-400"
              iconClass="text-red-400"
              onClick={() => { setShowContextMenu(false); onRemoveRepo(item.id, item.title); }}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function RepoCtxItem({
  icon: Icon, iconClass, label, className, onClick,
}: {
  icon: LucideIcon;
  iconClass?: string;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap",
        className,
      )}
    >
      <Icon size={11} className={cn("flex-shrink-0", iconClass)} />
      <span className="flex-1">{label}</span>
    </button>
  );
}
