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
   * Navigate to a file - clears tree selection (files aren't tree items).
   */
  async navigateToFile(
    filePath: string,
    context?: { repoId?: string; worktreeId?: string }
  ): Promise<void> {
    await treeMenuService.setSelectedItem(null);
    await contentPanesService.setActivePaneView({
      type: "file",
      filePath,
      ...context,
    });
  },

  /**
   * Navigate to a pull request - updates both content pane AND tree selection.
   */
  async navigateToPullRequest(prId: string): Promise<void> {
    await treeMenuService.setSelectedItem(prId);
    await contentPanesService.setActivePaneView({ type: "pull-request", prId });
  },

  /**
   * Navigate to a view - clears tree selection for non-item views.
   */
  async navigateToView(view: ContentPaneView): Promise<void> {
    if (view.type === "thread") {
      await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
    } else if (view.type === "plan") {
      await this.navigateToPlan(view.planId);
    } else if (view.type === "file") {
      await this.navigateToFile(view.filePath, {
        repoId: view.repoId,
        worktreeId: view.worktreeId,
      });
    } else if (view.type === "pull-request") {
      await this.navigateToPullRequest(view.prId);
    } else {
      // For settings, logs, empty - clear tree selection
      await treeMenuService.setSelectedItem(null);
      await contentPanesService.setActivePaneView(view);
    }
  },
};
