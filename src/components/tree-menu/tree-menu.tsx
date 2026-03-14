import React, { useCallback, useRef, useMemo, useEffect } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useTreeData } from "@/hooks/use-tree-data";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { navigationService } from "@/stores/navigation-service";
import type { TreeItemNode, EntityItemType } from "@/stores/tree-menu/types";
import { TreeItemRenderer } from "./tree-item-renderer";
import { useTreeDnd } from "./use-tree-dnd";
import { TreeDndOverlay } from "./tree-dnd-overlay";
import { DropIndicator } from "./drop-indicator";
import { MoveToDialog } from "./move-to-dialog";
import { useContextMenu, ContextMenu, ContextMenuItem } from "@/components/ui/context-menu";
import { FolderPlus } from "lucide-react";
import { createRootFolder } from "./folder-actions";

interface TreeMenuProps {
  onItemSelect: (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => void;
  onFilesClick?: (item: TreeItemNode) => void;
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  onNewWorktree?: (repoName: string) => void;
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  /** Set of worktree IDs currently being created */
  creatingWorktreeIds?: Set<string>;
  onPinToggle?: (worktreeId: string) => void;
  /** ID of currently pinned worktree, or null */
  pinnedWorktreeId?: string | null;
  className?: string;
}

/**
 * Main tree menu container.
 * Iterates a flat TreeItemNode[] and dispatches each item by type
 * to the correct component. Supports keyboard navigation.
 */
export function TreeMenu({
  onItemSelect, onFilesClick, onNewThread, onNewTerminal, onCreatePr,
  onNewWorktree, onArchiveWorktree,
  creatingWorktreeIds, onPinToggle, pinnedWorktreeId, className,
}: TreeMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const items = useTreeData();
  const selectedItemId = useTreeMenuStore((state) => state.selectedItemId);
  const hydrateRepoLookup = useRepoWorktreeLookupStore((state) => state.hydrate);

  const {
    sensors,
    activeDrag,
    dropTarget,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useTreeDnd(items);

  // Set cursor on body during drag — use !important to override child cursor-pointer styles
  useEffect(() => {
    if (!activeDrag) return;
    const cursor = dropTarget && !dropTarget.validation.valid
      ? "not-allowed"
      : "grabbing";
    document.body.style.setProperty("cursor", cursor, "important");
    return () => { document.body.style.removeProperty("cursor"); };
  }, [activeDrag, dropTarget]);

  const handleRefreshTreeMenu = useCallback(() => hydrateRepoLookup(), [hydrateRepoLookup]);

  // Pre-compute direct child counts for container nodes
  const childCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    const parentStack: string[] = [];
    for (const item of items) {
      parentStack.length = item.depth;
      if (item.depth > 0 && parentStack[item.depth - 1]) {
        const parentId = parentStack[item.depth - 1];
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
      if (item.isFolder) {
        parentStack[item.depth] = item.id;
      }
    }
    return counts;
  }, [items]);

  // Changes navigation handler
  const handleChangesClick = useCallback(async (item: TreeItemNode) => {
    if (!item.worktreeId) return;
    const worktreeNode = items.find(i => i.type === "worktree" && i.id === item.worktreeId);
    if (worktreeNode?.repoId) {
      await navigationService.navigateToChanges(worktreeNode.repoId, item.worktreeId, {
        treeItemId: item.id,
      });
    }
  }, [items]);

  // Files navigation handler — opens the right panel Files tab
  const handleFilesClick = useCallback((item: TreeItemNode) => {
    onFilesClick?.(item);
  }, [onFilesClick]);

  const handleItemSelect = useCallback(
    async (itemId: string, itemType: EntityItemType, event?: React.MouseEvent) => {
      await treeMenuService.setSelectedItem(itemId);
      onItemSelect(itemId, itemType, event);
    },
    [onItemSelect],
  );
  // Right-click context menu on empty space for root-level folder creation
  const rootContextMenu = useContextMenu();

  const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
    // Only trigger when right-clicking on the container itself, not on tree items
    if ((e.target as HTMLElement).closest("[data-tree-item-id]")) return;
    rootContextMenu.open(e);
  }, [rootContextMenu]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!selectedItemId) return;
      const currentIndex = items.findIndex(i => i.id === selectedItemId);
      if (currentIndex < 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (currentIndex < items.length - 1) {
            const next = items[currentIndex + 1];
            await treeMenuService.setSelectedItem(next.id);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (currentIndex > 0) {
            const prev = items[currentIndex - 1];
            await treeMenuService.setSelectedItem(prev.id);
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          if (items.length > 0) {
            await treeMenuService.setSelectedItem(items[0].id);
          }
          break;
        }
        case "End": {
          e.preventDefault();
          if (items.length > 0) {
            await treeMenuService.setSelectedItem(items[items.length - 1].id);
          }
          break;
        }
      }
    },
    [selectedItemId, items],
  );

  if (items.length === 0) {
    return (
      <div className={`flex-1 overflow-auto ${className ?? ""}`}>
        <div className="flex items-center justify-center h-32 text-surface-500 text-sm">
          No threads or plans
        </div>
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={containerRef}
          role="tree"
          aria-label="Sidebar tree"
          data-testid="tree-menu"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onContextMenu={handleContainerContextMenu}
          className={`flex-1 overflow-auto focus:outline-none pl-2 relative ${className ?? ""}`}
        >
          {items.map((item, index) => {
            return (
              <React.Fragment key={item.id}>
                <TreeItemRenderer
                  item={item}
                  index={index}
                  allItems={items}
                  childCount={childCountMap.get(item.id) ?? 0}
                  selectedItemId={selectedItemId}
                  onItemSelect={handleItemSelect}
                  onChangesClick={handleChangesClick}
                  onFilesClick={handleFilesClick}
                  onNewThread={onNewThread}
                  onNewTerminal={onNewTerminal}
                  onCreatePr={onCreatePr}
                  onNewWorktree={onNewWorktree}
                  onArchiveWorktree={onArchiveWorktree}
                  onRefresh={handleRefreshTreeMenu}
                  isCreatingWorktree={item.type === "worktree" && (creatingWorktreeIds?.has(item.id) ?? false)}
                  onPinToggle={onPinToggle}
                  isPinned={item.type === "worktree" && pinnedWorktreeId === item.id}
                />
              </React.Fragment>
            );
          })}

          {/* Drop indicator overlay (absolute positioned within scroll container) */}
          {dropTarget && <DropIndicator dropTarget={dropTarget} />}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? <TreeDndOverlay activeDrag={activeDrag} /> : null}
        </DragOverlay>
      </DndContext>

      <MoveToDialog />

      {/* Right-click context menu on empty space */}
      {rootContextMenu.show && (
        <ContextMenu position={rootContextMenu.position} onClose={rootContextMenu.close}>
          <ContextMenuItem
            icon={FolderPlus}
            label="New folder"
            onClick={() => { rootContextMenu.close(); void createRootFolder(); }}
          />
        </ContextMenu>
      )}
    </>
  );
}
