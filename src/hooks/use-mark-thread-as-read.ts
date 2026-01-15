import { useEffect, useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePanelVisibility, useSpecificPanelVisibility } from "./use-panel-visibility";
import { logger } from "@/lib/logger-client";

interface UseMarkThreadAsReadOptions {
  /** Whether to mark as read when the thread becomes active/viewed */
  markOnView?: boolean;
  /** Whether to mark as read when the thread completes */
  markOnComplete?: boolean;
  /** Specific panel label to check for visibility (if provided, only marks as read when this panel is visible) */
  requiredPanel?: string;
}

/**
 * Hook to mark a thread as read based on various conditions.
 * Handles race conditions by ensuring the thread exists in the store before marking.
 * Only marks threads as read when an nspanel is currently visible.
 * If requiredPanel is specified, only marks threads as read when that specific panel is visible.
 */
export function useMarkThreadAsRead(
  threadId: string | null | undefined,
  options: UseMarkThreadAsReadOptions = {}
) {
  const { markOnView = true, markOnComplete = true, requiredPanel } = options;

  const thread = useThreadStore((s) =>
    threadId ? s.threads[threadId] : undefined
  );

  const isAnyPanelVisible = usePanelVisibility();
  const isSpecificPanelVisible = useSpecificPanelVisibility(requiredPanel || "");

  // Use specific panel visibility if requiredPanel is provided, otherwise use any panel visibility
  const isPanelVisible = requiredPanel ? isSpecificPanelVisible : isAnyPanelVisible;

  // Mark as read when thread is viewed (becomes active)
  useEffect(() => {
    if (!markOnView || !threadId || !thread || !isPanelVisible) {
      return;
    }

    // Only mark as read if the thread is not already read (prevent infinite loops)
    if (thread.isRead) {
      return;
    }

    // Add a 1-second delay before marking as read to prevent race condition with mark-as-unread operations.
    // Without this delay, marking a task as unread would be immediately overridden by the auto-read behavior
    // when the simple task window is visible, making the unread action ineffective.
    const timeoutId = setTimeout(() => {
      // Double-check conditions before marking as read (thread might have changed)
      const currentThread = useThreadStore.getState().threads[threadId];
      if (currentThread && !currentThread.isRead) {
        logger.info(
          `[useMarkThreadAsRead] Marking thread ${threadId} as read (viewed) - panel: ${requiredPanel || "any"}`
        );
        useThreadStore.getState().markThreadAsRead(threadId);
      }
    }, 1000);

    // Cleanup timeout if effect runs again
    return () => {
      clearTimeout(timeoutId);
    };
  }, [markOnView, threadId, thread?.isRead, thread?.id, isPanelVisible, requiredPanel]);

  // Mark as read when thread completes
  useEffect(() => {
    if (!markOnComplete || !threadId || !thread || !isPanelVisible) {
      return;
    }

    // Mark as read when status changes to completed
    if (thread.status === "completed" && !thread.isRead) {
      // Add a 1-second delay before marking as read to prevent race condition with mark-as-unread operations.
      // Without this delay, marking a task as unread would be immediately overridden by the auto-read behavior
      // when the simple task window is visible, making the unread action ineffective.
      const timeoutId = setTimeout(() => {
        // Double-check conditions before marking as read (thread might have changed)
        const currentThread = useThreadStore.getState().threads[threadId];
        if (currentThread && currentThread.status === "completed" && !currentThread.isRead) {
          logger.info(
            `[useMarkThreadAsRead] Marking thread ${threadId} as read (completed) - panel: ${requiredPanel || "any"}`
          );
          useThreadStore.getState().markThreadAsRead(threadId);
        }
      }, 1000);

      // Cleanup timeout if effect runs again
      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [markOnComplete, threadId, thread?.status, thread?.isRead, isPanelVisible, requiredPanel]);

  // Return the mark function for manual calls
  return {
    markAsRead: useCallback(() => {
      if (threadId && thread && isPanelVisible) {
        logger.info(
          `[useMarkThreadAsRead] Marking thread ${threadId} as read (manual) - panel: ${requiredPanel || "any"}`
        );
        useThreadStore.getState().markThreadAsRead(threadId);
      } else if (!isPanelVisible) {
        logger.debug(
          `[useMarkThreadAsRead] Skipping manual mark as read - ${requiredPanel ? `${requiredPanel} panel` : "no panel"} not visible for thread:`,
          threadId
        );
      } else {
        logger.warn(
          `[useMarkThreadAsRead] Cannot mark thread as read - thread not found in store:`,
          threadId
        );
      }
    }, [threadId, thread, isPanelVisible, requiredPanel]),
  };
}
