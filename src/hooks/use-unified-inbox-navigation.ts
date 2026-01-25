/**
 * Unified Inbox Navigation Hook
 *
 * Provides navigation logic for the unified thread+plan inbox.
 * Finds the next unread item in the queue based on updatedAt ordering.
 */

import { useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { useRelationStore } from "@/entities/relations/store";
import { createUnifiedList } from "@/components/inbox/utils";
import type { InboxItem } from "@/components/inbox/types";
import type { ThreadMetadata } from "@/entities/threads/types";

/** Cooldown period for recently marked unread items (60 seconds) */
const MARKED_UNREAD_COOLDOWN_MS = 60 * 1000;

/**
 * Check if an item was recently marked as unread and should be skipped in navigation.
 */
function isRecentlyMarkedUnread(item: InboxItem): boolean {
  const markedUnreadAt = item.data.markedUnreadAt;
  if (!markedUnreadAt) return false;
  return Date.now() - markedUnreadAt < MARKED_UNREAD_COOLDOWN_MS;
}

/**
 * Check if a plan has any running threads associated with it.
 */
function hasRunningThread(planId: string, threads: Record<string, ThreadMetadata>): boolean {
  const relations = useRelationStore.getState().getByPlan(planId);
  return relations.some((rel) => threads[rel.threadId]?.status === "running");
}

export interface NavigationResult {
  type: "thread" | "plan";
  id: string;
}

export interface UseUnifiedInboxNavigationReturn {
  /**
   * Get the next unread item in the queue after the current position.
   * Items are ordered by updatedAt descending (most recent first).
   *
   * @param currentItem - Current item being viewed
   * @returns Next unread item or null if none available
   */
  getNextUnreadItem: (currentItem: {
    type: "thread" | "plan";
    id: string;
  }) => NavigationResult | null;

  /**
   * Get the first unread item in the queue (for initial navigation).
   */
  getFirstUnreadItem: () => NavigationResult | null;
}

/**
 * Hook providing unified inbox navigation logic.
 * Uses thread and plan stores to find next unread items.
 */
export function useUnifiedInboxNavigation(): UseUnifiedInboxNavigationReturn {
  const getNextUnreadItem = useCallback(
    (currentItem: { type: "thread" | "plan"; id: string }): NavigationResult | null => {
      // Get current state from stores
      const threadStore = useThreadStore.getState();
      const threads = threadStore.getAllThreads();
      const threadsById = threadStore.threads;
      const plans = usePlanStore.getState().getActivePlans();

      // Create unified list sorted by updatedAt descending
      // We don't need threadLastMessages for navigation, just pass empty record
      const unifiedList = createUnifiedList(threads, plans, {});

      // Find current item's position in the list
      const currentIndex = unifiedList.findIndex((item) => {
        if (item.type === "thread" && currentItem.type === "thread") {
          return item.data.id === currentItem.id;
        }
        if (item.type === "plan" && currentItem.type === "plan") {
          return item.data.id === currentItem.id;
        }
        return false;
      });

      // If current item not found, start from the beginning
      const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;

      // Search for next unread item after current position
      for (let i = startIndex; i < unifiedList.length; i++) {
        const item = unifiedList[i];
        // Skip items recently marked as unread to prevent navigation cycles
        if (isRecentlyMarkedUnread(item)) continue;

        if (item.type === "thread" && !item.data.isRead && item.data.status !== "running") {
          return { type: "thread", id: item.data.id };
        }
        if (item.type === "plan" && !item.data.isRead && !item.data.stale) {
          // Skip plans that have running threads
          if (!hasRunningThread(item.data.id, threadsById)) {
            return { type: "plan", id: item.data.id };
          }
        }
      }

      // Wrap around: search from beginning to current position
      for (let i = 0; i < startIndex; i++) {
        const item = unifiedList[i];
        // Skip the current item itself when wrapping around
        const isCurrent =
          (item.type === "thread" && currentItem.type === "thread" && item.data.id === currentItem.id) ||
          (item.type === "plan" && currentItem.type === "plan" && item.data.id === currentItem.id);

        if (isCurrent) continue;

        // Skip items recently marked as unread to prevent navigation cycles
        if (isRecentlyMarkedUnread(item)) continue;

        if (item.type === "thread" && !item.data.isRead && item.data.status !== "running") {
          return { type: "thread", id: item.data.id };
        }
        if (item.type === "plan" && !item.data.isRead && !item.data.stale) {
          // Skip plans that have running threads
          if (!hasRunningThread(item.data.id, threadsById)) {
            return { type: "plan", id: item.data.id };
          }
        }
      }

      // No unread items found
      return null;
    },
    []
  );

  const getFirstUnreadItem = useCallback((): NavigationResult | null => {
    const threadStore = useThreadStore.getState();
    const threads = threadStore.getAllThreads();
    const threadsById = threadStore.threads;
    const plans = usePlanStore.getState().getActivePlans();

    const unifiedList = createUnifiedList(threads, plans, {});

    for (const item of unifiedList) {
      // Skip items recently marked as unread to prevent navigation cycles
      if (isRecentlyMarkedUnread(item)) continue;

      if (item.type === "thread" && !item.data.isRead && item.data.status !== "running") {
        return { type: "thread", id: item.data.id };
      }
      if (item.type === "plan" && !item.data.isRead && !item.data.stale) {
        // Skip plans that have running threads
        if (!hasRunningThread(item.data.id, threadsById)) {
          return { type: "plan", id: item.data.id };
        }
      }
    }

    return null;
  }, []);

  return {
    getNextUnreadItem,
    getFirstUnreadItem,
  };
}
