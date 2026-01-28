/**
 * Context-Aware Navigation Hook
 *
 * Provides navigation functions that automatically route correctly based on
 * whether the component is rendering in the main window or the control panel.
 *
 * - Main window: Updates the content pane directly via contentPanesService
 * - Control panel/NSPanel: Routes through Rust to show the control panel with the view
 *
 * This fixes Bug #3 from content-pane-navigation-fixes.md where quick actions
 * in the main window were incorrectly opening the control panel instead of
 * updating the current tab.
 */

import { useIsMainWindow } from "@/components/main-window/main-window-context";
import { contentPanesService } from "@/stores/content-panes/service";
import { showControlPanelWithView } from "@/lib/hotkey-service";
import type { ContentPaneView } from "@/components/content-pane/types";

export function useContextAwareNavigation() {
  const isMainWindow = useIsMainWindow();

  /**
   * Navigate to a thread view.
   * In main window: updates the content pane.
   * In panel: shows the control panel with the thread.
   */
  const navigateToThread = async (threadId: string) => {
    if (isMainWindow) {
      await contentPanesService.setActivePaneView({ type: "thread", threadId });
    } else {
      await showControlPanelWithView({ type: "thread", threadId });
    }
  };

  /**
   * Navigate to a plan view.
   * In main window: updates the content pane.
   * In panel: shows the control panel with the plan.
   */
  const navigateToPlan = async (planId: string) => {
    if (isMainWindow) {
      await contentPanesService.setActivePaneView({ type: "plan", planId });
    } else {
      await showControlPanelWithView({ type: "plan", planId });
    }
  };

  /**
   * Navigate to any ContentPaneView.
   * In main window: updates the content pane.
   * In panel: only supports thread/plan views (shows control panel).
   */
  const navigateToView = async (view: ContentPaneView) => {
    if (isMainWindow) {
      await contentPanesService.setActivePaneView(view);
    } else {
      // Control panel only supports thread and plan views
      if (view.type === "thread" || view.type === "plan") {
        await showControlPanelWithView(view);
      }
    }
  };

  return {
    navigateToThread,
    navigateToPlan,
    navigateToView,
    isMainWindow,
  };
}
