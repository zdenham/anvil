import { useState, useRef, useEffect, useCallback } from "react";
import { Archive, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { ItemPreviewTooltip } from "./item-preview-tooltip";
import { threadService } from "@/entities/threads/service";
import { treeMenuService } from "@/stores/tree-menu/service";
import { INDENT_BASE, INDENT_STEP } from "./use-tree-keyboard-nav";

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
  onSelect: (itemId: string, itemType: "thread" | "plan") => void;
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

  const handleClick = async () => {
    onSelect(item.id, "thread");
    // For folders: clicking the row expands (but doesn't collapse)
    // Only the chevron can collapse
    if (item.isFolder && !item.isExpanded) {
      await treeMenuService.expandSection(`thread:${item.id}`);
    }
  };

  const handleFolderToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Use "thread:threadId" key convention for folder expand state
    await treeMenuService.toggleSection(`thread:${item.id}`);
  }, [item.id]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
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
              onSelect(nextItem.id, nextItem.type);
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
            onSelect(parentItem.id, parentItem.type);
          }
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (allItems.length > 0 && itemIndex > 0) {
          const prevItem = allItems[itemIndex - 1];
          focusTreeItem(itemIndex - 1);
          await treeMenuService.setSelectedItem(prevItem.id);
          onSelect(prevItem.id, prevItem.type);
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (allItems.length > 0 && itemIndex < allItems.length - 1) {
          const nextItem = allItems[itemIndex + 1];
          focusTreeItem(itemIndex + 1);
          await treeMenuService.setSelectedItem(nextItem.id);
          onSelect(nextItem.id, nextItem.type);
        }
        break;
    }
  }, [item, itemIndex, allItems, onSelect]);

  // Calculate indentation based on depth using shared constants
  // Threads are always depth 0, but this keeps alignment consistent with plans
  const indentPx = INDENT_BASE + (item.depth * INDENT_STEP);

  return (
    <ItemPreviewTooltip itemId={item.id} itemType="thread">
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={item.isFolder ? item.isExpanded : undefined}
        aria-level={item.depth + 1}
        data-tree-item-index={itemIndex}
        tabIndex={tabIndex}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ paddingLeft: `${indentPx}px` }}
        className={cn(
          "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
          "text-[13px] leading-[22px]",
          "transition-colors duration-75",
          "outline-none focus:bg-accent-500/10",
          isSelected
            ? "bg-accent-500/20 text-surface-100"
            : "text-surface-300 hover:bg-accent-500/10"
        )}
      >
        {/* Folder toggle chevron or status dot - both use same fixed width */}
        {item.isFolder ? (
          <button
            type="button"
            className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
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
        <span className="truncate flex-1" title={item.title}>
          {item.title}
        </span>
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
  );
}
