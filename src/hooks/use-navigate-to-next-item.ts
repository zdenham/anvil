/**
 * Navigate to Next Item Hook
 *
 * Wraps navigation logic with panel management and banner display.
 * Handles both client-side switching and fallback to inbox panel.
 *
 * Uses context-aware navigation to route correctly based on rendering context:
 * - Main window: Updates the content pane directly
 * - Control panel: Routes through Rust panel commands
 */

import { useCallback } from "react";
import { invoke } from "@/lib/invoke";
import { useUnifiedInboxNavigation } from "./use-unified-inbox-navigation";
import { useContextAwareNavigation } from "./use-context-aware-navigation";
import { useNavigationBannerStore } from "@/stores/navigation-banner-store";
import { closeCurrentPanelOrWindow } from "@/lib/panel-navigation";
import { paneLayoutService } from "@/stores/pane-layout/service";
import { logger } from "@/lib/logger-client";

export type NavigationActionType = "nextItem";

export interface UseNavigateToNextItemReturn {
  /**
   * Navigate to next unread item or fall back to inbox panel.
   *
   * @param currentItem - Current item being viewed
   * @param options.actionType - Action that triggered navigation (for banner message)
   * @returns true if navigated to next item, false if fell back to inbox
   */
  navigateToNextItemOrFallback: (
    currentItem: { type: "thread" | "plan"; id: string },
    options?: {
      actionType?: NavigationActionType;
    }
  ) => Promise<boolean>;
}

/**
 * Get the completion message for the banner based on action type and item type.
 */
function getCompletionMessage(
  actionType: NavigationActionType | undefined,
): string {
  switch (actionType) {
    case "nextItem":
      return "Skipped";
    default:
      return "Done";
  }
}

/**
 * Hook providing navigation with panel management.
 */
export function useNavigateToNextItem(): UseNavigateToNextItemReturn {
  const { getNextUnreadItem } = useUnifiedInboxNavigation();
  const { navigateToThread, navigateToPlan, isMainWindow } = useContextAwareNavigation();
  const showBanner = useNavigationBannerStore((s) => s.showBanner);

  const navigateToNextItemOrFallback = useCallback(
    async (
      currentItem: { type: "thread" | "plan"; id: string },
      options?: { actionType?: NavigationActionType }
    ): Promise<boolean> => {
      const { actionType } = options ?? {};

      // Find next unread item
      const nextItem = getNextUnreadItem(currentItem);

      // Check if next item is different from current item
      // If same item (or no next item), fall back to inbox
      const isSameItem =
        nextItem &&
        nextItem.type === currentItem.type &&
        nextItem.id === currentItem.id;

      if (nextItem && !isSameItem) {
        // Navigate to the next item
        const completionMessage = getCompletionMessage(actionType);

        logger.info(`[useNavigateToNextItem] Navigating to next item`, {
          from: currentItem,
          to: nextItem,
          actionType,
          isMainWindow,
        });

        // Show banner before navigation so it appears during transition
        showBanner(completionMessage, "Next unread focused");

        // Navigate to next item using context-aware navigation
        // Main window: updates content pane directly
        // Control panel: routes through Rust panel commands
        if (nextItem.type === "thread") {
          await navigateToThread(nextItem.id);
        } else {
          await navigateToPlan(nextItem.id);
        }

        return true;
      } else {
        // No more unread items (or only current item is unread)
        const completionMessage = getCompletionMessage(actionType);

        logger.info(`[useNavigateToNextItem] No more unread items`, {
          currentItem,
          nextItem,
          isSameItem,
          actionType,
          isMainWindow,
        });

        // Show "all caught up" banner
        showBanner(completionMessage, "All caught up");

        if (isMainWindow) {
          // In main window: show empty state in the content pane
          // Stay in main window, just clear the view
          await paneLayoutService.setActiveTabView({ type: "empty" });
        } else {
          // In control panel: close panel/window and focus main window
          await closeCurrentPanelOrWindow();
          await invoke("show_main_window");
        }

        return false;
      }
    },
    [getNextUnreadItem, navigateToThread, navigateToPlan, isMainWindow, showBanner]
  );

  return {
    navigateToNextItemOrFallback,
  };
}
