/**
 * ContentPaneContainer
 *
 * Container that renders content panes based on the content-panes store.
 * Currently supports single-pane mode; architecture ready for future multi-pane.
 *
 * Uses the contentPanesService for all state management (disk-as-truth pattern).
 */

import { useContentPanesStore } from "@/stores/content-panes/store";
import { contentPanesService } from "@/stores/content-panes/service";
import { ContentPane } from "./content-pane";
import { showMainWindowWithView } from "@/lib/hotkey-service";
import { invoke } from "@/lib/invoke";

/**
 * Container component that renders the active content pane.
 * Integrates with the content-panes store for state management.
 */
export function ContentPaneContainer() {
  const panes = useContentPanesStore((state) => state.panes);
  const activePaneId = useContentPanesStore((state) => state.activePaneId);

  // Get the active pane
  const activePane = activePaneId ? panes[activePaneId] : null;

  // Handle close - clear pane view to empty
  const handleClose = async () => {
    await contentPanesService.clearActivePane();
  };

  // Handle pop-out - open in main window instead of standalone window
  const handlePopOut = async () => {
    if (!activePane) return;
    const view = activePane.view;

    // Open in main window instead of standalone window
    await showMainWindowWithView(view);

    // Focus the main window
    await invoke("show_main_window");
  };

  // If no active pane, render empty state
  if (!activePane) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-900 text-surface-500">
        <p>No pane selected</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 bg-surface-900">
      <ContentPane
        paneId={activePane.id}
        view={activePane.view}
        onClose={handleClose}
        onPopOut={handlePopOut}
      />
    </div>
  );
}
