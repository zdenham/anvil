import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronRight, ChevronDown, Loader2, Pin } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { logger } from "@/lib/logger-client";
import { worktreeService } from "@/entities/worktrees/service";
import { cn } from "@/lib/utils";
import { getTreeIndentPx } from "@/lib/tree-indent";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import type { TreeDragData } from "./use-tree-dnd";
import { PlusMenu, WorktreeContextMenu } from "./worktree-menus";

export interface WorktreeItemProps {
  item: TreeItemNode;
  childCount: number;
  isSelected: boolean;
  itemIndex: number;
  allItems: TreeItemNode[];
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onNewClaudeSession?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewManagedThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  onRefresh?: () => void;
  isCreatingWorktree?: boolean;
  onPinToggle?: (worktreeId: string) => void;
  isPinned?: boolean;
  onHideWorktree?: (worktreeId: string) => void;
}

/**
 * Worktree header row in the tree menu.
 * Renders "repoName / worktreeName" with chevron, count badge, pin indicator,
 * plus button, context menu, rename, and FilesItem when expanded.
 */
export function WorktreeItem(props: WorktreeItemProps) {
  const { item } = props;

  const dragData: TreeDragData = useMemo(
    () => ({ type: "tree-item", item }),
    [item],
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: dragData });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-tree-item-id={item.id}
      className={cn(isDragging && "opacity-50")}
    >
      <WorktreeHeader {...props} />
    </div>
  );
}

/** Renders the worktree header row with menus and rename logic. */
function WorktreeHeader({
  item, isSelected, isCreatingWorktree, isPinned,
  onPinToggle, onNewThread, onNewTerminal, onNewClaudeSession, onNewManagedThread,
  onArchiveWorktree, onRefresh, onHideWorktree,
}: WorktreeItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ top: 0, left: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.worktreeName ?? "");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useMenuOutsideClick(showContextMenu, contextMenuRef, null, () => setShowContextMenu(false));

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isSelected) {
      treeMenuService.toggleSection(item.id);
    } else {
      treeMenuService.setSelectedItem(item.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCreatingWorktree) return;
    setContextMenuPosition({ top: e.clientY, left: e.clientX });
    setShowContextMenu(true);
  };

  const handleRenameSubmit = useCallback(async () => {
    const trimmedName = renameValue.trim();
    if (!trimmedName || !/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      setRenameValue(item.worktreeName ?? "");
      setIsRenaming(false);
      return;
    }
    if (trimmedName === item.worktreeName) {
      setIsRenaming(false);
      return;
    }
    try {
      await worktreeService.rename(item.repoName!, item.worktreeName!, trimmedName);
      onRefresh?.();
    } catch (error) {
      logger.error("[WorktreeItem] Failed to rename worktree:", error);
      setRenameValue(item.worktreeName ?? "");
    }
    setIsRenaming(false);
  }, [renameValue, item.repoName, item.worktreeName, onRefresh]);

  const handleRenameCancel = useCallback(() => {
    setRenameValue(item.worktreeName ?? "");
    setIsRenaming(false);
  }, [item.worktreeName]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleRenameSubmit(); }
    else if (e.key === "Escape") { e.preventDefault(); handleRenameCancel(); }
  }, [handleRenameSubmit, handleRenameCancel]);

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={item.isExpanded}
        tabIndex={-1}
        style={{ paddingLeft: `${getTreeIndentPx(item.depth)}px` }}
        className={cn(
          "group flex items-center gap-1.5 pr-1 py-1.5 cursor-pointer select-none",
          item.depth === 0 && "mt-1",
          "text-[13px] font-semibold",
          "transition-colors duration-75",
          isSelected
            ? "bg-accent-500/20 text-surface-100"
            : "text-surface-200 hover:bg-accent-500/10",
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
          onClick={(e) => { e.stopPropagation(); treeMenuService.toggleSection(item.id); }}
          aria-label={item.isExpanded ? "Collapse section" : "Expand section"}
        >
          {item.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <span className={cn("truncate font-mono", isCreatingWorktree && "text-surface-400")}>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-24"
              onClick={(e) => e.stopPropagation()}
            />
          ) : item.worktreeName}
        </span>

        {item.isExternal && (
          <span
            className="ml-1 px-1 py-0.5 text-[10px] leading-none rounded bg-surface-700 text-surface-400"
            title="This workspace was not created by Anvil"
          >
            external
          </span>
        )}

        {isCreatingWorktree && <Loader2 size={12} className="flex-shrink-0 animate-spin text-surface-400" />}
        <span className="ml-auto" />
        {isPinned && (
          <span className="text-accent-400 flex items-center justify-center w-5 h-5"><Pin size={12} /></span>
        )}

        <PlusMenu
          item={item}
          isCreatingWorktree={isCreatingWorktree}
          onNewThread={onNewThread}
          onNewClaudeSession={onNewClaudeSession}
        />
      </div>

      <WorktreeContextMenu
        item={item} show={showContextMenu} position={contextMenuPosition}
        menuRef={contextMenuRef} isPinned={isPinned} onPinToggle={onPinToggle}
        onNewThread={onNewThread} onNewClaudeSession={onNewClaudeSession}
        onNewManagedThread={onNewManagedThread} onNewTerminal={onNewTerminal}
        onArchiveWorktree={onArchiveWorktree}
        onHideWorktree={onHideWorktree}
        onClose={() => setShowContextMenu(false)}
        onStartRename={() => {
          setRenameValue(item.worktreeName ?? "");
          setIsRenaming(true);
          setShowContextMenu(false);
        }}
      />
    </>
  );
}

/** Hook to close a menu when clicking outside its ref. */
function useMenuOutsideClick(
  isOpen: boolean,
  menuRef: React.RefObject<HTMLDivElement | null>,
  buttonRef: React.RefObject<HTMLButtonElement | null> | null,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target) &&
          (!buttonRef?.current || !buttonRef.current.contains(target))) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, menuRef, buttonRef, onClose]);
}
