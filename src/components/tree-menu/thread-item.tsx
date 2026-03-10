import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Archive, Loader2, ChevronRight, Copy, CircleDot, ArrowRightLeft, CornerLeftUp, Pencil } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuDivider,
} from "@/components/ui/context-menu";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import { ItemPreviewTooltip } from "./item-preview-tooltip";
import { threadService } from "@/entities/threads/service";
import { useThreadStore } from "@/entities/threads/store";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useInlineRename } from "./use-inline-rename";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import { useMoveToStore } from "./use-move-to";
import { updateVisualSettings } from "@/lib/visual-settings";
import type { TreeDragData } from "./use-tree-dnd";

/**
 * Get text color class based on item status.
 * Returns empty string for selected items (selection state takes precedence).
 * Running state uses shimmer animation, others use surface-400.
 */
function getTextColorClass(status: StatusDotVariant, isSelected: boolean): string {
  if (isSelected) return "";
  switch (status) {
    case "needs-input":
      return "text-amber-300 animate-shimmer";
    case "running":
      return "animate-shimmer";
    case "unread":
      return "text-surface-100";
    case "read":
    default:
      return "text-surface-400";
  }
}

/**
 * Focus a tree item by its index using data attribute.
 */
function focusTreeItem(index: number) {
  const element = document.querySelector(
    `[data-tree-item-index="${index}"]`
  ) as HTMLElement;
  element?.focus();
}

interface ThreadItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  tabIndex?: number;
  /** Index in the flat list for keyboard navigation */
  itemIndex?: number;
  /** All items in the section for keyboard nav */
  allItems?: TreeItemNode[];
}

/**
 * Thread row in the tree menu.
 * Displays status dot and thread title.
 * Styled like VSCode file entries.
 * Supports hover archive button with confirmation.
 */
export function ThreadItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
  itemIndex = 0,
  allItems = [],
}: ThreadItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contextMenu = useContextMenu();

  // ── Inline rename ─────────────────────────────────────────────────
  const renamingNodeId = useTreeMenuStore((s) => s.renamingNodeId);
  const rename = useInlineRename({
    currentName: item.title,
    onRename: async (newName) => {
      await threadService.update(item.id, { name: newName });
    },
  });

  useEffect(() => {
    if (renamingNodeId === item.id && !rename.isRenaming) rename.startRename();
  }, [renamingNodeId === item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag and drop ────────────────────────────────────────────────
  const dragData: TreeDragData = useMemo(
    () => ({ type: "tree-item", item }),
    [item],
  );
  const {
    attributes: dragAttrs, listeners: dragListeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: item.id, data: dragData });

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
      await threadService.archive(item.id);
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

  const handleClick = async (e: React.MouseEvent) => {
    if (isSelected && item.isFolder) {
      // Already selected - toggle expansion
      await treeMenuService.toggleSection(`thread:${item.id}`);
    } else {
      // Pass event so parent can detect Cmd+Click
      onSelect(item.id, "thread", e);
    }
  };

  const handleMouseDown = async (e: React.MouseEvent) => {
    // Middle-click opens in new tab
    if (e.button === 1) {
      e.preventDefault();
      onSelect(item.id, "thread", e);
    }
  };

  const handleFolderToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Use "thread:threadId" key convention for folder expand state
    await treeMenuService.toggleSection(`thread:${item.id}`);
  }, [item.id]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    rename.startRename();
  }, [rename]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.key === "F2") { e.preventDefault(); rename.startRename(); return; }
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(item.id, "thread");
        break;

      case "ArrowRight":
        // Expand folder or move to first child
        if (item.isFolder) {
          if (!item.isExpanded) {
            e.preventDefault();
            await treeMenuService.expandSection(`thread:${item.id}`);
          } else if (allItems.length > 0) {
            // Move to first child (next item with greater depth)
            e.preventDefault();
            const nextIndex = itemIndex + 1;
            if (nextIndex < allItems.length && allItems[nextIndex].depth > item.depth) {
              const nextItem = allItems[nextIndex];
              focusTreeItem(nextIndex);
              await treeMenuService.setSelectedItem(nextItem.id);
              onSelect(nextItem.id, nextItem.type as EntityItemType);
            }
          }
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        if (item.isFolder && item.isExpanded) {
          // Collapse the folder
          await treeMenuService.collapseSection(`thread:${item.id}`);
        } else if (item.parentId && allItems.length > 0) {
          // Move to parent
          const parentIndex = allItems.findIndex((i) => i.id === item.parentId);
          if (parentIndex >= 0) {
            const parentItem = allItems[parentIndex];
            focusTreeItem(parentIndex);
            await treeMenuService.setSelectedItem(parentItem.id);
            onSelect(parentItem.id, parentItem.type as EntityItemType);
          }
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (allItems.length > 0 && itemIndex > 0) {
          const prevItem = allItems[itemIndex - 1];
          focusTreeItem(itemIndex - 1);
          await treeMenuService.setSelectedItem(prevItem.id);
          onSelect(prevItem.id, prevItem.type as EntityItemType);
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (allItems.length > 0 && itemIndex < allItems.length - 1) {
          const nextItem = allItems[itemIndex + 1];
          focusTreeItem(itemIndex + 1);
          await treeMenuService.setSelectedItem(nextItem.id);
          onSelect(nextItem.id, nextItem.type as EntityItemType);
        }
        break;
    }
  }, [item, itemIndex, allItems, onSelect]);

  // Calculate indentation based on depth using shared constants
  // Threads are always depth 0, but this keeps alignment consistent with plans
  const indentPx = TREE_INDENT_BASE + (item.depth * TREE_INDENT_STEP);

  return (
    <>
    <ItemPreviewTooltip itemId={item.id} itemType="thread">
      <div
        ref={setNodeRef}
        {...dragAttrs}
        {...dragListeners}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={item.isFolder ? item.isExpanded : undefined}
        aria-level={item.depth + 1}
        data-testid={`thread-item-${item.id}`}
        data-tree-item-id={item.id}
        data-tree-item-index={itemIndex}
        tabIndex={tabIndex}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        onContextMenu={contextMenu.open}
        style={{
          paddingLeft: `${indentPx}px`,
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        className={cn(
          "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
          "text-[13px] leading-[22px]",
          "transition-colors duration-75",
          "outline-none focus:bg-accent-500/10",
          isSelected
            ? "bg-accent-500/20 text-surface-100"
            : "text-surface-300 hover:bg-accent-500/10",
          isDragging && "opacity-50",
        )}
      >
        {/* Folder toggle chevron or status dot - both use same fixed width */}
        {item.isFolder && isSelected ? (
          <button
            type="button"
            className={cn(
              "flex-shrink-0 w-3 h-3 flex items-center justify-center rounded",
              item.status === "running"
                ? "chevron-running"
                : item.status === "needs-input"
                  ? "chevron-needs-input"
                  : "text-surface-400 hover:bg-surface-700"
            )}
            onClick={handleFolderToggle}
            aria-label={item.isExpanded ? "Collapse folder" : "Expand folder"}
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
            <StatusDot variant={item.status} />
          </span>
        )}
        {rename.isRenaming ? (
          <input
            ref={rename.inputRef}
            type="text"
            value={rename.renameValue}
            onChange={rename.handleChange}
            onBlur={rename.handleBlur}
            onKeyDown={rename.handleKeyDown}
            className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-full min-w-[60px]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={cn("truncate flex-1", getTextColorClass(item.status, isSelected))}
            onDoubleClick={handleDoubleClick}
          >
            {item.title}
          </span>
        )}
        {/* Archive button - fixed height to prevent layout shift */}
        <button
          ref={buttonRef}
          className={cn(
            "h-[12px] flex items-center justify-center transition-colors flex-shrink-0",
            isArchiving
              ? "text-surface-500"
              : confirming
                ? "opacity-100 text-surface-300 text-[11px] font-medium"
                : "opacity-0 group-hover:opacity-100 text-surface-500 hover:text-surface-300"
          )}
          onClick={handleArchiveClick}
          aria-label={confirming ? "Confirm archive" : "Archive"}
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
    </ItemPreviewTooltip>
    {contextMenu.show && (
      <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
        <ContextMenuItem
          icon={Pencil}
          label="Rename"
          onClick={() => {
            contextMenu.close();
            treeMenuService.startRename(item.id);
          }}
        />
        <ContextMenuItem
          icon={CircleDot}
          label="Mark Unread"
          onClick={async () => {
            await useThreadStore.getState().markThreadAsUnread(item.id);
            contextMenu.close();
          }}
        />
        <ContextMenuItem
          icon={Copy}
          label="Copy Thread ID"
          onClick={() => {
            navigator.clipboard.writeText(item.id);
            contextMenu.close();
          }}
        />
        <ContextMenuDivider />
        <ContextMenuItem
          icon={ArrowRightLeft}
          label="Move to..."
          onClick={() => {
            contextMenu.close();
            useMoveToStore.getState().openMoveDialog(item);
          }}
        />
        {item.parentId && item.parentId !== item.worktreeId && (
          <ContextMenuItem
            icon={CornerLeftUp}
            label="Move to root"
            onClick={async () => {
              contextMenu.close();
              await updateVisualSettings("thread", item.id, {
                parentId: item.worktreeId,
                sortKey: undefined,
              });
            }}
          />
        )}
      </ContextMenu>
    )}
    </>
  );
}
