/**
 * Navigation Service
 *
 * Centralized navigation that handles both tree selection and content pane
 * view updates together, ensuring they always stay in sync.
 *
 * Use this service instead of calling contentPanesService directly when
 * navigating to threads or plans from the main window.
 */

import { contentPanesService } from "./content-panes/service";
import { treeMenuService } from "./tree-menu/service";
import type { ContentPaneView } from "@/components/content-pane/types";

export const navigationService = {
  /**
   * Navigate to a thread - updates both content pane AND tree selection.
   */
  async navigateToThread(threadId: string, options?: { autoFocus?: boolean }): Promise<void> {
    // Update tree selection first (so UI updates together)
    await treeMenuService.setSelectedItem(threadId);
    // Then update content pane
    await contentPanesService.setActivePaneView({
      type: "thread",
      threadId,
      autoFocus: options?.autoFocus,
    });
  },

  /**
   * Navigate to a plan - updates both content pane AND tree selection.
   */
  async navigateToPlan(planId: string): Promise<void> {
    await treeMenuService.setSelectedItem(planId);
    await contentPanesService.setActivePaneView({ type: "plan", planId });
  },

  /**
   * Navigate to a view - clears tree selection for non-item views.
   */
  async navigateToView(view: ContentPaneView): Promise<void> {
    if (view.type === "thread") {
      await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
    } else if (view.type === "plan") {
      await this.navigateToPlan(view.planId);
    } else {
      // For settings, logs, empty - clear tree selection
      await treeMenuService.setSelectedItem(null);
      await contentPanesService.setActivePaneView(view);
    }
  },
};
