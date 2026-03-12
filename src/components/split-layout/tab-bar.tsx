/**
 * TabBar — horizontal tab strip above pane content.
 *
 * Renders TabItem components inside a SortableContext for drag-and-drop
 * reordering within and across groups. Includes a "+" button for new tabs.
 */

import { useCallback, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { paneLayoutService } from "@/stores/pane-layout";
import { threadService } from "@/entities/threads/service";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { useMRUWorktree } from "@/hooks/use-mru-worktree";
import { logger } from "@/lib/logger-client";
import { TabItem } from "./tab-item";
import type { TabItem as TabItemType } from "@/stores/pane-layout/types";

interface TabBarProps {
  groupId: string;
  tabs: TabItemType[];
  activeTabId: string;
}

export function TabBar({ groupId, tabs, activeTabId }: TabBarProps) {
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const { repoId, worktreeId } = useMRUWorktree();

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

    if (!repoId || !worktreeId) {
      logger.warn("[TabBar] No MRU worktree available, opening empty tab");
      paneLayoutService.openTab({ type: "empty" }, groupId);
      return;
    }

    const threadId = crypto.randomUUID();
    await threadService.create({
      id: threadId,
      repoId,
      worktreeId,
      prompt: "",
    });
    paneLayoutService.openTab(
      { type: "thread", threadId, autoFocus: true },
      groupId,
    );
  }, [groupId, tabs, activeTabId, repoId, worktreeId]);

  return (
    <div
      ref={setDroppableRef}
      data-testid={`tab-bar-${groupId}`}
      className="flex items-center bg-surface-950 overflow-x-auto scrollbar-none py-1 px-1 gap-0.5"
    >
      <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => (
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
