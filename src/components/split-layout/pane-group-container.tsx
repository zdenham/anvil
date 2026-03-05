/**
 * PaneGroupContainer
 *
 * Placeholder leaf renderer for split layout.
 * Renders the active tab's content pane for a given group.
 *
 * Will be replaced by the full tab bar + content system in 03-tab-system.
 */

import { useCallback } from "react";
import { usePaneLayoutStore } from "@/stores/pane-layout";
import { ContentPane } from "@/components/content-pane/content-pane";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { showMainWindowWithView } from "@/lib/hotkey-service";
import { invoke } from "@/lib/invoke";
import type { PaneGroupContainerProps } from "./types";

export function PaneGroupContainer({ groupId }: PaneGroupContainerProps) {
  const group = usePaneLayoutStore((s) => s.groups[groupId]);
  const activeGroupId = usePaneLayoutStore((s) => s.activeGroupId);

  const activeTab = group?.tabs.find((t) => t.id === group.activeTabId);
  const isActive = activeGroupId === groupId;

  const handleFocus = useCallback(async () => {
    if (!isActive) {
      await paneLayoutService.setActiveGroup(groupId);
    }
  }, [groupId, isActive]);

  const handleClose = useCallback(async () => {
    if (!group || !activeTab) return;
    await paneLayoutService.closeTab(groupId, activeTab.id);
  }, [groupId, group, activeTab]);

  const handlePopOut = useCallback(async () => {
    if (!activeTab) return;
    await showMainWindowWithView(activeTab.view);
    await invoke("show_main_window");
  }, [activeTab]);

  if (!group || !activeTab) {
    return (
      <div
        data-testid="pane-group-empty"
        className="flex items-center justify-center w-full h-full bg-surface-900 text-surface-500"
      >
        <p>Empty pane</p>
      </div>
    );
  }

  return (
    <div
      data-testid="pane-group-container"
      data-group-id={groupId}
      data-active={isActive}
      className="w-full h-full"
      onMouseDown={handleFocus}
    >
      <ContentPane
        paneId={groupId}
        view={activeTab.view}
        onClose={handleClose}
        onPopOut={handlePopOut}
      />
    </div>
  );
}
