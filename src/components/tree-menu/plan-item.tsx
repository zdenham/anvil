import { useState, useRef, useEffect, useCallback } from "react";
import { Archive, Loader2, ChevronRight, Check, Trash2, GitBranch, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import {
  useContextMenu,
  ContextMenu,
  ContextMenuItem,
  ContextMenuItemDanger,
  ContextMenuDivider,
} from "@/components/ui/context-menu";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import type { PhaseInfo } from "@/entities/plans/types";
import { ItemPreviewTooltip } from "./item-preview-tooltip";
import { planService } from "@/entities/plans/service";
import { treeMenuService } from "@/stores/tree-menu/service";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";

/**
 * Get text color class based on item status.
 * Returns empty string for selected items (selection state takes precedence).
 * Running state uses shimmer animation, others use surface-400.
 */
function getTextColorClass(status: StatusDotVariant, isSelected: boolean): string {
  if (isSelected) return "";
  switch (status) {
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
 * Renders phase progress indicator for plans with a ## Phases section.
 * Shows "✓" when all phases complete, otherwise "completed/total".
 */
function PhaseDisplay({ phaseInfo }: { phaseInfo: PhaseInfo | undefined }) {
  if (!phaseInfo) return null;

  const { completed, total } = phaseInfo;
  const isComplete = completed === total && total > 0;

  if (isComplete) {
    return (
      <span className="text-surface-500 inline-flex items-center ml-1.5 translate-y-[1px]">
        <Check size={12} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span className="text-surface-500 ml-1.5">
      {completed}/{total}
    </span>
  );
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

interface PlanItemProps {
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
 * Plan row in the tree menu.
 * Displays status dot and plan filename.
 * Styled like VSCode file entries.
 * Supports hover archive button with confirmation.
 */
export function PlanItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
  itemIndex = 0,
  allItems = [],
}: PlanItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const contextMenu = useContextMenu();
  const [confirmAction, setConfirmAction] = useState<"delete" | "deleteGit" | null>(null);

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
      await planService.archive(item.id);
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

  const handleContextMenuAction = useCallback(async (action: "delete" | "deleteGit") => {
    if (confirmAction === action) {
      // Second click — execute
      setIsArchiving(true);
      try {
        if (action === "delete") {
          await planService.deletePlanFile(item.id);
        } else {
          await planService.deletePlanFileAndUntrack(item.id);
        }
      } finally {
        setIsArchiving(false);
        setConfirmAction(null);
        contextMenu.close();
      }
    } else {
      // First click — show confirmation
      setConfirmAction(action);
    }
  }, [item.id, confirmAction, contextMenu]);

  const handleContextMenuOpen = useCallback((e: React.MouseEvent) => {
    setConfirmAction(null);
    contextMenu.open(e);
  }, [contextMenu]);

  const handleClick = async (e: React.MouseEvent) => {
    if (isSelected && item.isFolder) {
      // Already selected - toggle expansion
      await treeMenuService.toggleSection(`plan:${item.id}`);
    } else {
      // Pass event so parent can detect Cmd+Click
      onSelect(item.id, "plan", e);
    }
  };

  const handleMouseDown = async (e: React.MouseEvent) => {
    // Middle-click opens in new tab
    if (e.button === 1) {
      e.preventDefault();
      onSelect(item.id, "plan", e);
    }
  };

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(item.id, "plan");
        break;

      case "ArrowRight":
        // Expand folder or move to first child
        if (item.isFolder) {
          if (!item.isExpanded) {
            e.preventDefault();
            await treeMenuService.expandSection(`plan:${item.id}`);
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
          await treeMenuService.collapseSection(`plan:${item.id}`);
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

  const handleFolderToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Use "plan:planId" key convention for folder expand state
    await treeMenuService.toggleSection(`plan:${item.id}`);
  }, [item.id]);

  // Calculate indentation based on depth using shared constants
  const indentPx = TREE_INDENT_BASE + (item.depth * TREE_INDENT_STEP);

  return (
    <>
      <ItemPreviewTooltip itemId={item.id} itemType="plan">
        <div
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={item.isFolder ? item.isExpanded : undefined}
          aria-level={item.depth + 1}
          data-testid={`plan-item-${item.id}`}
          data-tree-item-index={itemIndex}
          tabIndex={tabIndex}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          onContextMenu={handleContextMenuOpen}
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
          {/* Folder toggle chevron (when selected) or status dot - both use same fixed width */}
          {item.isFolder && isSelected ? (
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
          <span
            className={cn(
              "truncate flex-1 flex items-baseline",
              getTextColorClass(item.status, isSelected)
            )}
          >
            {item.title}
            <PhaseDisplay phaseInfo={item.phaseInfo} />
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
      {contextMenu.show && (
        <ContextMenu position={contextMenu.position} onClose={contextMenu.close}>
          {confirmAction ? (
            <>
              <div className="px-2.5 py-1 text-[11px] text-surface-400">
                {confirmAction === "delete" ? "Delete this plan?" : "Delete + remove from git?"}
              </div>
              <ContextMenuItemDanger
                icon={Trash2}
                label="Confirm delete"
                onClick={() => handleContextMenuAction(confirmAction)}
              />
              <ContextMenuItem
                icon={ChevronRight}
                label="Cancel"
                onClick={() => setConfirmAction(null)}
              />
            </>
          ) : (
            <>
              <ContextMenuItem
                icon={CircleDot}
                label="Mark Unread"
                onClick={async () => {
                  await planService.markAsUnread(item.id);
                  contextMenu.close();
                }}
              />
              <ContextMenuItem
                icon={Archive}
                label="Archive"
                onClick={() => {
                  contextMenu.close();
                  handleArchive();
                }}
              />
              <ContextMenuDivider />
              <ContextMenuItemDanger
                icon={Trash2}
                label="Delete"
                onClick={() => handleContextMenuAction("delete")}
              />
              <ContextMenuItemDanger
                icon={GitBranch}
                label="Delete + remove from git"
                onClick={() => handleContextMenuAction("deleteGit")}
              />
            </>
          )}
        </ContextMenu>
      )}
    </>
  );
}
