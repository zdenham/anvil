/**
 * Navigate to Next Item Hook
 *
 * Wraps navigation logic with panel management and banner display.
 * Handles both client-side switching and fallback to inbox panel.
 */

import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUnifiedInboxNavigation } from "./use-unified-inbox-navigation";
import { useNavigationBannerStore } from "@/stores/navigation-banner-store";
import { switchToThread, switchToPlan } from "@/lib/hotkey-service";
import { logger } from "@/lib/logger-client";

export type NavigationActionType = "archive" | "markUnread" | "nextItem";

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
  itemType: "thread" | "plan"
): string {
  const itemLabel = itemType === "thread" ? "Thread" : "Plan";

  switch (actionType) {
    case "archive":
      return `${itemLabel} archived`;
    case "markUnread":
      return "Marked unread";
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
        const completionMessage = getCompletionMessage(actionType, currentItem.type);

        logger.info(`[useNavigateToNextItem] Navigating to next item`, {
          from: currentItem,
          to: nextItem,
          actionType,
        });

        // Show banner before navigation so it appears during transition
        showBanner(completionMessage, "Next unread focused");

        // Navigate to next item via Rust (crosses window boundary properly)
        if (nextItem.type === "thread") {
          await switchToThread(nextItem.id);
        } else {
          await switchToPlan(nextItem.id);
        }

        return true;
      } else {
        // No more unread items (or only current item is unread) - fall back to inbox panel
        const completionMessage = getCompletionMessage(actionType, currentItem.type);

        logger.info(`[useNavigateToNextItem] No more unread items, showing inbox`, {
          currentItem,
          nextItem,
          isSameItem,
          actionType,
        });

        // Show "all caught up" banner
        showBanner(completionMessage, "All caught up");

        // Hide control panel first
        await invoke("hide_control_panel");

        // Then show inbox panel
        await invoke("open_inbox_list_panel");

        return false;
      }
    },
    [getNextUnreadItem, showBanner]
  );

  return {
    navigateToNextItemOrFallback,
  };
}
