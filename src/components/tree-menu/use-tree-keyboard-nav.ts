import { useCallback } from "react";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";

/**
 * Indentation constants for tree items.
 */
export const INDENT_BASE = 8; // px - base indentation for top-level items
export const INDENT_STEP = 8; // px per depth level for nested items

/**
 * Calculate indent style for a tree item based on depth.
 */
export function getIndentStyle(depth: number): React.CSSProperties {
  return {
    paddingLeft: `${INDENT_BASE + depth * INDENT_STEP}px`,
  };
}

/**
 * Focus a tree item by its index using data attribute.
 */
function focusItem(index: number) {
  const element = document.querySelector(
    `[data-tree-item-index="${index}"]`
  ) as HTMLElement;
  element?.focus();
}

interface UseTreeKeyboardNavOptions {
  /** Flat list of visible tree items */
  items: TreeItemNode[];
  /** Callback when an item is selected */
  onSelect: (itemId: string, itemType: "thread" | "plan") => void;
  /** Get the current selected item index */
  getCurrentIndex: () => number;
}

/**
 * Keyboard navigation hook for tree menu items.
 *
 * Supports nested plan navigation:
 * - ArrowRight on collapsed folder: expand
 * - ArrowRight on expanded folder: move to first child
 * - ArrowLeft on expanded folder: collapse
 * - ArrowLeft on child: move to parent
 * - ArrowUp/Down: move through visible items
 * - Enter/Space: select/open item
 */
export function useTreeKeyboardNav({
  items,
  onSelect,
  getCurrentIndex,
}: UseTreeKeyboardNavOptions) {
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent, currentIndex?: number) => {
      const activeIndex = currentIndex ?? getCurrentIndex();
      if (activeIndex < 0 || activeIndex >= items.length) return;

      const currentItem = items[activeIndex];

      switch (e.key) {
        case "ArrowRight":
          // Expand folder or move to first child
          if (currentItem.type === "plan" && currentItem.isFolder) {
            if (!currentItem.isExpanded) {
              e.preventDefault();
              // Expand the folder
              await treeMenuService.expandSection(`plan:${currentItem.id}`);
            } else {
              // Move to first child (next item in flat list if it's a child)
              e.preventDefault();
              const nextIndex = activeIndex + 1;
              if (nextIndex < items.length) {
                const nextItem = items[nextIndex];
                // Check if next item is a child (has greater depth)
                if (nextItem.depth > currentItem.depth) {
                  focusItem(nextIndex);
                  await treeMenuService.setSelectedItem(nextItem.id);
                  onSelect(nextItem.id, nextItem.type);
                }
              }
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          // Collapse folder or move to parent
          if (currentItem.type === "plan" && currentItem.isFolder && currentItem.isExpanded) {
            // Collapse the folder
            await treeMenuService.collapseSection(`plan:${currentItem.id}`);
          } else if (currentItem.parentId) {
            // Find and focus parent
            const parentIndex = items.findIndex(
              (i) => i.id === currentItem.parentId
            );
            if (parentIndex >= 0) {
              focusItem(parentIndex);
              const parentItem = items[parentIndex];
              await treeMenuService.setSelectedItem(parentItem.id);
              onSelect(parentItem.id, parentItem.type);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (activeIndex > 0) {
            const prevIndex = activeIndex - 1;
            const prevItem = items[prevIndex];
            focusItem(prevIndex);
            await treeMenuService.setSelectedItem(prevItem.id);
            onSelect(prevItem.id, prevItem.type);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (activeIndex < items.length - 1) {
            const nextIndex = activeIndex + 1;
            const nextItem = items[nextIndex];
            focusItem(nextIndex);
            await treeMenuService.setSelectedItem(nextItem.id);
            onSelect(nextItem.id, nextItem.type);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          await treeMenuService.setSelectedItem(currentItem.id);
          onSelect(currentItem.id, currentItem.type);
          break;
      }
    },
    [items, getCurrentIndex, onSelect]
  );

  return { handleKeyDown, focusItem };
}

/**
 * Hook variant that operates on a pre-computed index (for use in item components).
 */
export function useTreeItemKeyboardNav(
  item: TreeItemNode,
  index: number,
  items: TreeItemNode[],
  onSelect: (itemId: string, itemType: "thread" | "plan") => void
) {
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          // Expand folder or move to first child
          if (item.type === "plan" && item.isFolder) {
            if (!item.isExpanded) {
              e.preventDefault();
              await treeMenuService.expandSection(`plan:${item.id}`);
            } else {
              // Move to first child
              e.preventDefault();
              const nextIndex = index + 1;
              if (nextIndex < items.length && items[nextIndex].depth > item.depth) {
                const nextItem = items[nextIndex];
                focusItem(nextIndex);
                await treeMenuService.setSelectedItem(nextItem.id);
                onSelect(nextItem.id, nextItem.type);
              }
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (item.type === "plan" && item.isFolder && item.isExpanded) {
            await treeMenuService.collapseSection(`plan:${item.id}`);
          } else if (item.parentId) {
            const parentIndex = items.findIndex((i) => i.id === item.parentId);
            if (parentIndex >= 0) {
              const parentItem = items[parentIndex];
              focusItem(parentIndex);
              await treeMenuService.setSelectedItem(parentItem.id);
              onSelect(parentItem.id, parentItem.type);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (index > 0) {
            const prevItem = items[index - 1];
            focusItem(index - 1);
            await treeMenuService.setSelectedItem(prevItem.id);
            onSelect(prevItem.id, prevItem.type);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (index < items.length - 1) {
            const nextItem = items[index + 1];
            focusItem(index + 1);
            await treeMenuService.setSelectedItem(nextItem.id);
            onSelect(nextItem.id, nextItem.type);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          await treeMenuService.setSelectedItem(item.id);
          onSelect(item.id, item.type);
          break;
      }
    },
    [item, index, items, onSelect]
  );

  return { handleKeyDown };
}
