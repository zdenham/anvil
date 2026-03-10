import { useCallback, useState, useEffect, useMemo } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useContextMenu, ContextMenu } from "@/components/ui/context-menu";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { folderService } from "@/entities/folders/service";
import { createFolderAndRename } from "./folder-actions";
import { getTreeIndentPx } from "@/lib/tree-indent";
import { useInlineRename } from "./use-inline-rename";
import { IconPicker, LUCIDE_ICON_MAP } from "./icon-picker";
import { FolderArchiveConfirm, FolderContextMenuItems } from "./folder-context-menu";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import type { TreeDragData } from "./use-tree-dnd";

interface FolderItemProps {
  item: TreeItemNode;
  /** Number of direct children (for the count badge) */
  childCount: number;
  isSelected: boolean;
  /** Index in the flat list for keyboard navigation */
  itemIndex: number;
  /** All items in the flat list for keyboard nav */
  allItems: TreeItemNode[];
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
}

/**
 * Folder node in the tree menu.
 * Displays a collapsible folder with icon, name, and child count badge.
 * Supports inline rename, context menu (rename, change icon, delete),
 * icon picker popover, double-click to rename, and F2 to rename.
 */
export function FolderItem({
  item, childCount, isSelected, itemIndex,
}: FolderItemProps) {
  const IconComponent = LUCIDE_ICON_MAP[item.icon ?? "folder"] ?? Folder;

  const dragData: TreeDragData = useMemo(() => ({ type: "tree-item", item }), [item]);
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: item.id, data: dragData });

  // Inline rename coordination
  const renamingNodeId = useTreeMenuStore((s) => s.renamingNodeId);
  const rename = useInlineRename({
    currentName: item.title,
    onRename: async (newName) => { await folderService.rename(item.id, newName); },
  });

  // When store says this node should rename, trigger the hook's rename mode
  useEffect(() => {
    if (renamingNodeId === item.id && !rename.isRenaming) rename.startRename();
  }, [renamingNodeId === item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const contextMenu = useContextMenu();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconPickerPosition, setIconPickerPosition] = useState({ top: 0, left: 0 });

  const handleOpenIconPicker = useCallback(() => {
    const row = document.querySelector(`[data-testid="folder-item-${item.id}"]`);
    if (row) {
      const rect = row.getBoundingClientRect();
      setIconPickerPosition({ top: rect.bottom + 4, left: rect.left + 16 });
    }
    setShowIconPicker(true);
  }, [item.id]);

  const handleIconSelect = useCallback(async (iconName: string) => {
    await folderService.updateIcon(item.id, iconName);
    setShowIconPicker(false);
  }, [item.id]);

  // ── Click handlers ──────────────────────────────────────────────────
  const handleClick = useCallback(async () => {
    if (rename.isRenaming) return;
    if (isSelected) {
      await treeMenuService.toggleSection(`folder:${item.id}`);
    } else {
      await treeMenuService.setSelectedItem(item.id);
    }
  }, [isSelected, item.id, rename.isRenaming]);

  const handleChevronToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await treeMenuService.toggleSection(`folder:${item.id}`);
  }, [item.id]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    rename.startRename();
  }, [rename]);

  const handleArchiveClick = useCallback(() => {
    if (childCount > 0) { setConfirmingArchive(true); return; }
    void folderService.archive(item.id);
    contextMenu.close();
  }, [item.id, childCount, contextMenu]);

  const handleConfirmArchive = useCallback(async () => {
    await folderService.archive(item.id);
    setConfirmingArchive(false);
    contextMenu.close();
  }, [item.id, contextMenu]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.key === "F2") { e.preventDefault(); rename.startRename(); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await handleClick(); }
  }, [handleClick, rename]);

  const handleContextMenuOpen = useCallback((e: React.MouseEvent) => {
    setConfirmingArchive(false);
    contextMenu.open(e);
  }, [contextMenu]);

  return (
    <>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={item.isExpanded}
        aria-level={item.depth + 1}
        data-testid={`folder-item-${item.id}`}
        data-tree-item-id={item.id}
        data-tree-item-index={itemIndex}
        tabIndex={-1}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenuOpen}
        style={{
          paddingLeft: `${getTreeIndentPx(item.depth)}px`,
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        className={cn(
          "group flex items-center gap-1.5 pr-1 cursor-pointer",
          item.depth === 0 ? "mt-1 py-1" : "py-0.5",
          "text-[13px] leading-[22px]",
          "transition-colors duration-75",
          "outline-none focus:bg-accent-500/10",
          isSelected
            ? "bg-accent-500/20 text-surface-100"
            : "text-surface-300 hover:bg-accent-500/10",
          isDragging && "opacity-50",
        )}
      >
        {/* Edit mode: clickable icon | Selected: chevron | Default: icon */}
        {rename.isRenaming ? (
          <button
            type="button"
            className="flex-shrink-0 w-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); handleOpenIconPicker(); }}
            aria-label="Change icon"
          >
            <IconComponent size={11} />
          </button>
        ) : isSelected ? (
          <button
            type="button"
            className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
            onClick={handleChevronToggle}
            aria-label={item.isExpanded ? "Collapse folder" : "Expand folder"}
          >
            <ChevronRight
              size={12}
              className={cn(
                "tree-chevron transition-transform duration-150",
                item.isExpanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="flex-shrink-0 w-3 flex items-center justify-center">
            <IconComponent size={11} className="text-surface-400" />
          </span>
        )}

        {/* Folder name / inline rename input */}
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
            className={cn("truncate flex-1", isSelected ? "" : "text-surface-300")}
            title={item.title}
          >
            {item.title}
          </span>
        )}

        {/* Child count badge */}
        <span className="text-xs text-surface-500 font-normal">{childCount}</span>
      </div>

      {/* Context menu */}
      {contextMenu.show && (
        <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
          {confirmingArchive ? (
            <FolderArchiveConfirm
              onConfirm={handleConfirmArchive}
              onCancel={() => setConfirmingArchive(false)}
            />
          ) : (
            <FolderContextMenuItems
              onNewFolder={() => { contextMenu.close(); void createFolderAndRename(item.id, item.worktreeId); }}
              onEdit={() => { contextMenu.close(); rename.startRename(); }}
              onArchive={handleArchiveClick}
              hasChildren={childCount > 0}
              canArchive={!!item.worktreeId || childCount === 0}
            />
          )}
        </ContextMenu>
      )}

      {/* Icon picker popover */}
      {showIconPicker && (
        <IconPicker
          currentIcon={item.icon ?? "folder"}
          anchorPosition={iconPickerPosition}
          onSelect={handleIconSelect}
          onClose={() => setShowIconPicker(false)}
        />
      )}
    </>
  );
}
