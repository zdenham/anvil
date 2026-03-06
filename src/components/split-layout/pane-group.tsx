/**
 * PaneGroup — leaf-level container rendered by SplitNodeRenderer.
 *
 * Composes TabBar + ContentPane for a single pane group.
 * Active group gets an accent border. Clicking anywhere sets this group active.
 * When a tab drag is active, renders the DropZoneOverlay for visual feedback.
 */

import { useCallback } from "react";
import { usePaneLayoutStore, paneLayoutService } from "@/stores/pane-layout";
import { ContentPane } from "@/components/content-pane/content-pane";
import { InputStoreProvider } from "@/stores/input-store";
import { TabBar } from "./tab-bar";
import { DropZoneOverlay } from "./drop-zone-overlay";
import { useDndBridge } from "./dnd-context-bridge";
import { PaneGroupProvider } from "./pane-group-context";

interface PaneGroupProps {
  groupId: string;
}

export function PaneGroup({ groupId }: PaneGroupProps) {
  const { activeDrag, activeEdgeZone } = useDndBridge();

  const group = usePaneLayoutStore(
    useCallback((s) => s.groups[groupId], [groupId]),
  );
  const isActiveGroup = usePaneLayoutStore(
    useCallback((s) => s.activeGroupId === groupId, [groupId]),
  );

  const handleActivate = useCallback(() => {
    // Read imperatively to avoid stale closure from isActiveGroup dep
    if (usePaneLayoutStore.getState().activeGroupId !== groupId) {
      paneLayoutService.setActiveGroup(groupId);
    }
  }, [groupId]);

  const activeTabId = group?.activeTabId ?? "";

  const handleClose = useCallback(() => {
    if (activeTabId) {
      paneLayoutService.closeTab(groupId, activeTabId);
    }
  }, [groupId, activeTabId]);

  if (!group) return null;

  const activeTab = group.tabs.find((t) => t.id === group.activeTabId);
  const activeView = activeTab?.view ?? { type: "empty" as const };

  return (
    <PaneGroupProvider groupId={groupId}>
      <div
        data-testid={`pane-group-${groupId}`}
        onPointerDownCapture={handleActivate}
        className="relative flex flex-col h-full overflow-hidden"
      >
        <TabBar
          groupId={groupId}
          tabs={group.tabs}
          activeTabId={group.activeTabId}
        />
        <InputStoreProvider active={isActiveGroup}>
          <div className="relative flex-1 min-h-0">
            <ContentPane
              paneId={groupId}
              view={activeView}
              onClose={handleClose}
            />
            {activeDrag && (
              <DropZoneOverlay
                groupId={groupId}
                activeEdgeZone={activeEdgeZone}
              />
            )}
          </div>
        </InputStoreProvider>
      </div>
    </PaneGroupProvider>
  );
}
