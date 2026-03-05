/**
 * ContentPaneContainer
 *
 * DEPRECATED: Replaced by SplitLayoutContainer -> PaneGroup -> ContentPane.
 * Kept for backward compatibility with control-panel window.
 */

import { usePaneLayoutStore } from "@/stores/pane-layout/store";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { ContentPane } from "./content-pane";
import { showMainWindowWithView } from "@/lib/hotkey-service";
import { invoke } from "@/lib/invoke";

/**
 * Container component that renders the active content pane.
 * @deprecated Use SplitLayoutContainer + PaneGroup instead.
 */
export function ContentPaneContainer() {
  const activeGroupId = usePaneLayoutStore((s) => s.activeGroupId);
  const groups = usePaneLayoutStore((s) => s.groups);

  const group = activeGroupId ? groups[activeGroupId] : null;
  const activeTab = group?.tabs.find((t) => t.id === group.activeTabId);

  const handleClose = async () => {
    if (group && activeTab) {
      await paneLayoutService.closeTab(group.id, activeTab.id);
    }
  };

  const handlePopOut = async () => {
    if (!activeTab) return;
    await showMainWindowWithView(activeTab.view);
    await invoke("show_main_window");
  };

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-900 text-surface-500">
        <p>No pane selected</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 bg-surface-900">
      <ContentPane
        paneId={group!.id}
        view={activeTab.view}
        onClose={handleClose}
        onPopOut={handlePopOut}
      />
    </div>
  );
}
