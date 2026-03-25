/**
 * TabBar — horizontal tab strip above pane content.
 *
 * Renders TabItem components inside a SortableContext for drag-and-drop
 * reordering within and across groups. Includes a "+" button for new tabs.
 */

import { useCallback, useMemo, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { paneLayoutService } from "@/stores/pane-layout";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { useSettingsStore } from "@/entities/settings/store";
import { useMRUWorktreeStore } from "@/stores/mru-worktree-store";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { createTuiThread } from "@/lib/thread-creation-service";
import { logger } from "@/lib/logger-client";
import { useActiveWorktreeContext } from "@/hooks/use-active-worktree-context";
import { TabItem } from "./tab-item";
import type { TabItem as TabItemType } from "@core/types/pane-layout.js";

interface TabBarProps {
  groupId: string;
  tabs: TabItemType[];
  activeTabId: string;
}

export function TabBar({ groupId, tabs, activeTabId }: TabBarProps) {
  const { worktreeId: activeWorktreeId } = useActiveWorktreeContext();

  // Filter terminal tabs to only show those belonging to the active worktree.
  // Non-terminal tabs are always shown.
  const visibleTabs = useMemo(() => {
    if (!activeWorktreeId) return tabs;
    return tabs.filter((tab) => {
      if (tab.view.type !== "terminal") return true;
      const session = terminalSessionService.get(tab.view.terminalId);
      return !session || session.worktreeId === activeWorktreeId;
    });
  }, [tabs, activeWorktreeId]);

  // If the active tab was hidden by filtering, auto-select the first visible tab
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    const activeStillVisible = visibleTabs.some((t) => t.id === activeTabId);
    if (!activeStillVisible) {
      paneLayoutService.setActiveTab(groupId, visibleTabs[0].id);
    }
  }, [visibleTabs, activeTabId, groupId]);

  const tabIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  // Make the tab bar itself a drop target so tabs can be dragged to empty areas
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `tab-bar-drop-${groupId}`,
    data: { type: "tab-bar", groupId },
  });

  const handleNewTab = useCallback(async () => {
    // If the group's active tab is a terminal, create another terminal
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.view.type === "terminal") {
      const existingSession = terminalSessionService.get(activeTab.view.terminalId);
      if (existingSession) {
        try {
          const session = await terminalSessionService.create(
            existingSession.worktreeId,
            existingSession.worktreePath,
          );
          paneLayoutService.openTab(
            { type: "terminal", terminalId: session.id },
            groupId,
          );
          return;
        } catch (err) {
          logger.error("[TabBar] Failed to create terminal, falling back to thread", err);
        }
      }
    }

    // If TUI preference is enabled, directly create a TUI thread
    const preferTui = useSettingsStore.getState().workspace.preferTerminalInterface ?? false;
    if (preferTui) {
      const mru = useMRUWorktreeStore.getState().getMRUWorktree();
      if (mru) {
        const worktreePath = useRepoWorktreeLookupStore.getState()
          .getWorktreePath(mru.repoId, mru.worktreeId);
        if (worktreePath) {
          try {
            const result = await createTuiThread({
              repoId: mru.repoId,
              worktreeId: mru.worktreeId,
              worktreePath,
            });
            paneLayoutService.openTab(
              { type: "thread", threadId: result.threadId },
              groupId,
            );
            return;
          } catch (err) {
            logger.error("[TabBar] Failed to create TUI thread, falling back to empty", err);
          }
        }
      }
    }

    paneLayoutService.openTab({ type: "empty" }, groupId);
  }, [groupId, tabs, activeTabId]);

  return (
    <div
      ref={setDroppableRef}
      data-testid={`tab-bar-${groupId}`}
      className="flex items-center bg-surface-900 overflow-x-auto scrollbar-none py-1 px-1 gap-0.5"
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        {visibleTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            groupId={groupId}
            isActive={tab.id === activeTabId}
          />
        ))}
      </SortableContext>
      <button
        data-testid={`tab-new-${groupId}`}
        onClick={handleNewTab}
        className="flex items-center justify-center w-7 h-7 flex-shrink-0 rounded-md text-surface-400 hover:text-surface-200 hover:bg-surface-800/50 transition-colors"
        aria-label="New tab"
      >
        <Plus size={12} />
      </button>
      <div className="flex-1" />
    </div>
  );
}
