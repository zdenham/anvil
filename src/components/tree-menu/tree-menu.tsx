import { useCallback, useRef, useMemo } from "react";
import { useTreeData } from "@/hooks/use-tree-data";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { RepoWorktreeSection } from "./repo-worktree-section";

interface TreeMenuProps {
  /**
   * Called when an item is selected.
   * @param itemId - The ID of the selected item
   * @param itemType - The type of the selected item ("thread", "plan", or "terminal")
   */
  onItemSelect: (itemId: string, itemType: "thread" | "plan" | "terminal") => void;
  /** Called when user wants to create a new thread in a worktree */
  onNewThread?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Called when user wants to create a new terminal in a worktree */
  onNewTerminal?: (worktreeId: string, worktreePath: string) => void;
  /** Called when user wants to create a new worktree in a repo */
  onNewWorktree?: (repoName: string) => void;
  /** Called when user wants to add a new repository */
  onNewRepo?: () => void;
  /** Called when user wants to archive a worktree */
  onArchiveWorktree?: (repoName: string, worktreeId: string, worktreeName: string) => void;
  /** Name of repo currently having a worktree created (for spinner) */
  creatingWorktreeForRepo?: string | null;
  /** Called when user pins/unpins a section */
  onPinToggle?: (sectionId: string) => void;
  /** Called when user hides a section */
  onHide?: (sectionId: string) => void;
  /** ID of currently pinned section, or null */
  pinnedSectionId?: string | null;
  /** Called when user opens the file browser for a worktree */
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Worktree ID that currently has the file browser open, or null */
  fileBrowserWorktreeId?: string | null;
  className?: string;
}

/**
 * Main tree menu container.
 * Displays repo/worktree sections with threads and plans.
 * Supports keyboard navigation: ArrowUp/Down, ArrowLeft/Right, Enter/Space, Home/End.
 * Uses ARIA tree pattern for accessibility.
 */
export function TreeMenu({ onItemSelect, onNewThread, onNewTerminal, onNewWorktree, onNewRepo, onArchiveWorktree, creatingWorktreeForRepo, onPinToggle, onHide, pinnedSectionId, onOpenFiles, fileBrowserWorktreeId, className }: TreeMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sections = useTreeData();
  const selectedItemId = useTreeMenuStore((state) => state.selectedItemId);
  const hydrateRepoLookup = useRepoWorktreeLookupStore((state) => state.hydrate);

  // Refresh tree by re-hydrating the lookup store
  const handleRefreshTreeMenu = useCallback(async () => {
    await hydrateRepoLookup();
  }, [hydrateRepoLookup]);

  // Build flat list of focusable items for keyboard navigation
  const focusableItems = useMemo(() => {
    const items: Array<{ type: "section" | "item"; id: string; sectionId?: string; itemType?: "thread" | "plan" | "terminal" }> = [];

    for (const section of sections) {
      items.push({ type: "section", id: section.id });
      if (section.isExpanded) {
        for (const item of section.items) {
          items.push({
            type: "item",
            id: item.id,
            sectionId: section.id,
            itemType: item.type,
          });
        }
      }
    }

    return items;
  }, [sections]);

  // Find current index in focusable items
  const getCurrentIndex = useCallback(() => {
    if (!selectedItemId) return -1;
    return focusableItems.findIndex(
      (item) => item.type === "item" && item.id === selectedItemId
    );
  }, [selectedItemId, focusableItems]);

  // Find section containing an item
  const findItemSection = useCallback((itemId: string) => {
    for (const section of sections) {
      if (section.items.some((item) => item.id === itemId)) {
        return section;
      }
    }
    return null;
  }, [sections]);

  // Handle section toggle
  const handleToggleSection = useCallback(async (sectionId: string) => {
    await treeMenuService.toggleSection(sectionId);
  }, []);

  // Handle item selection
  const handleItemSelect = useCallback(
    async (itemId: string, itemType: "thread" | "plan" | "terminal") => {
      await treeMenuService.setSelectedItem(itemId);
      onItemSelect(itemId, itemType);
    },
    [onItemSelect]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      const currentIndex = getCurrentIndex();

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          // Find next item
          const nextIndex = currentIndex + 1;
          if (nextIndex < focusableItems.length) {
            const next = focusableItems[nextIndex];
            if (next.type === "item" && next.itemType) {
              await treeMenuService.setSelectedItem(next.id);
              onItemSelect(next.id, next.itemType);
            } else if (next.type === "section") {
              // Skip to section's first item if expanded, or next section
              const section = sections.find((s) => s.id === next.id);
              if (section?.isExpanded && section.items.length > 0) {
                const firstItem = section.items[0];
                await treeMenuService.setSelectedItem(firstItem.id);
                onItemSelect(firstItem.id, firstItem.type);
              }
            }
          }
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          // Find previous item
          if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            const prev = focusableItems[prevIndex];
            if (prev.type === "item" && prev.itemType) {
              await treeMenuService.setSelectedItem(prev.id);
              onItemSelect(prev.id, prev.itemType);
            }
          }
          break;
        }

        case "ArrowLeft": {
          e.preventDefault();
          // Collapse parent section or move to section header
          if (selectedItemId) {
            const section = findItemSection(selectedItemId);
            if (section) {
              await treeMenuService.collapseSection(section.id);
            }
          }
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          // Expand section
          if (selectedItemId) {
            const section = findItemSection(selectedItemId);
            if (section && !section.isExpanded) {
              await treeMenuService.expandSection(section.id);
            }
          }
          break;
        }

        case "Home": {
          e.preventDefault();
          // Go to first item
          const firstItem = focusableItems.find((item) => item.type === "item" && item.itemType);
          if (firstItem && firstItem.itemType) {
            await treeMenuService.setSelectedItem(firstItem.id);
            onItemSelect(firstItem.id, firstItem.itemType);
          }
          break;
        }

        case "End": {
          e.preventDefault();
          // Go to last item
          for (let i = focusableItems.length - 1; i >= 0; i--) {
            const item = focusableItems[i];
            if (item.type === "item" && item.itemType) {
              await treeMenuService.setSelectedItem(item.id);
              onItemSelect(item.id, item.itemType);
              break;
            }
          }
          break;
        }

        case "Enter":
        case " ": {
          // Selection is handled by individual items
          break;
        }
      }
    },
    [getCurrentIndex, focusableItems, sections, selectedItemId, findItemSection, onItemSelect]
  );

  // Empty state
  if (sections.length === 0) {
    return (
      <div className={`flex-1 overflow-auto ${className ?? ""}`}>
        <div className="flex items-center justify-center h-32 text-surface-500 text-sm">
          No threads or plans
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Threads and Plans"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`flex-1 overflow-auto focus:outline-none pl-2 ${className ?? ""}`}
    >
      {sections.map((section, index) => (
        <RepoWorktreeSection
          key={section.id}
          section={section}
          selectedItemId={selectedItemId}
          onToggle={handleToggleSection}
          onItemSelect={handleItemSelect}
          showDivider={index > 0}
          onNewThread={onNewThread}
          onNewTerminal={onNewTerminal}
          onNewWorktree={onNewWorktree}
          onNewRepo={onNewRepo}
          onArchiveWorktree={onArchiveWorktree}
          onRefresh={handleRefreshTreeMenu}
          isCreatingWorktree={creatingWorktreeForRepo === section.repoName}
          onPinToggle={onPinToggle}
          onHide={onHide}
          isPinned={pinnedSectionId === section.id}
          onOpenFiles={onOpenFiles}
          isFileBrowserOpen={fileBrowserWorktreeId === section.worktreeId}
        />
      ))}
    </div>
  );
}
