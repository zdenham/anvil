import { useCallback } from "react";
import { treeMenuService } from "@/stores/tree-menu/service";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";

/**
 * Focus a tree item by its index using data attribute.
 */
function focusItem(index: number) {
  const element = document.querySelector(
    `[data-tree-item-index="${index}"]`
  ) as HTMLElement;
  element?.focus();
}

/**
 * Resolve the expand-state key for a given node.
 * Must match the expandKey() convention in use-tree-data.ts:
 *   worktree -> item.id
 *   everything else -> "type:id"
 */
function getExpandKey(item: TreeItemNode): string {
  if (item.type === "worktree") return item.id;
  return `${item.type}:${item.id}`;
}

interface UseTreeKeyboardNavOptions {
  /** Flat list of visible tree items */
  items: TreeItemNode[];
  /** Callback when an item is selected */
  onSelect: (itemId: string, itemType: EntityItemType) => void;
  /** Get the current selected item index */
  getCurrentIndex: () => number;
}

/**
 * Keyboard navigation hook for tree menu items.
 *
 * Supports all container types (worktree, folder, thread, plan):
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
          if (currentItem.isFolder) {
            if (!currentItem.isExpanded) {
              e.preventDefault();
              await treeMenuService.expandSection(getExpandKey(currentItem));
            } else {
              e.preventDefault();
              const nextIndex = activeIndex + 1;
              if (nextIndex < items.length) {
                const nextItem = items[nextIndex];
                if (nextItem.depth > currentItem.depth) {
                  focusItem(nextIndex);
                  await treeMenuService.setSelectedItem(nextItem.id);
                  onSelect(nextItem.id, nextItem.type as EntityItemType);
                }
              }
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (currentItem.isFolder && currentItem.isExpanded) {
            await treeMenuService.collapseSection(getExpandKey(currentItem));
          } else if (currentItem.parentId) {
            const parentIndex = items.findIndex(
              (i) => i.id === currentItem.parentId
            );
            if (parentIndex >= 0) {
              focusItem(parentIndex);
              const parentItem = items[parentIndex];
              await treeMenuService.setSelectedItem(parentItem.id);
              onSelect(parentItem.id, parentItem.type as EntityItemType);
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
            onSelect(prevItem.id, prevItem.type as EntityItemType);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (activeIndex < items.length - 1) {
            const nextIndex = activeIndex + 1;
            const nextItem = items[nextIndex];
            focusItem(nextIndex);
            await treeMenuService.setSelectedItem(nextItem.id);
            onSelect(nextItem.id, nextItem.type as EntityItemType);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          await treeMenuService.setSelectedItem(currentItem.id);
          onSelect(currentItem.id, currentItem.type as EntityItemType);
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
  onSelect: (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request") => void
) {
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          if (item.isFolder) {
            if (!item.isExpanded) {
              e.preventDefault();
              await treeMenuService.expandSection(getExpandKey(item));
            } else {
              e.preventDefault();
              const nextIndex = index + 1;
              if (nextIndex < items.length && items[nextIndex].depth > item.depth) {
                const nextItem = items[nextIndex];
                focusItem(nextIndex);
                await treeMenuService.setSelectedItem(nextItem.id);
                onSelect(nextItem.id, nextItem.type as EntityItemType);
              }
            }
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (item.isFolder && item.isExpanded) {
            await treeMenuService.collapseSection(getExpandKey(item));
          } else if (item.parentId) {
            const parentIndex = items.findIndex((i) => i.id === item.parentId);
            if (parentIndex >= 0) {
              const parentItem = items[parentIndex];
              focusItem(parentIndex);
              await treeMenuService.setSelectedItem(parentItem.id);
              onSelect(parentItem.id, parentItem.type as EntityItemType);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (index > 0) {
            const prevItem = items[index - 1];
            focusItem(index - 1);
            await treeMenuService.setSelectedItem(prevItem.id);
            onSelect(prevItem.id, prevItem.type as EntityItemType);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (index < items.length - 1) {
            const nextItem = items[index + 1];
            focusItem(index + 1);
            await treeMenuService.setSelectedItem(nextItem.id);
            onSelect(nextItem.id, nextItem.type as EntityItemType);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          await treeMenuService.setSelectedItem(item.id);
          onSelect(item.id, item.type as EntityItemType);
          break;
      }
    },
    [item, index, items, onSelect]
  );

  return { handleKeyDown };
}
