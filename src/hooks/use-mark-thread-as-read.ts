import { useEffect, useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { logger } from "@/lib/logger-client";

interface UseMarkThreadAsReadOptions {
  /** Whether to mark as read when the thread becomes active/viewed */
  markOnView?: boolean;
  /** Whether to mark as read when the thread completes */
  markOnComplete?: boolean;
}

/**
 * Hook to mark a thread as read based on various conditions.
 *
 * Only marks threads as read when:
 * 1. The thread is the currently active thread (activeThreadId matches)
 * 2. The thread exists in the store
 *
 * When a panel is hidden/blurred, activeThreadId is cleared by the panel-hidden
 * event listener, which prevents threads from being marked as read when not visible.
 */
export function useMarkThreadAsRead(
  threadId: string | null | undefined,
  options: UseMarkThreadAsReadOptions = {}
) {
  const { markOnView = true, markOnComplete = true } = options;

  const thread = useThreadStore((s) =>
    threadId ? s.threads[threadId] : undefined
  );

  const isActiveThread = useThreadStore((s) => s.activeThreadId === threadId);

  // Mark as read when thread is viewed (becomes active)
  useEffect(() => {
    if (!markOnView || !threadId || !thread || !isActiveThread) {
      return;
    }

    // Only mark as read if the thread is not already read (prevent infinite loops)
    if (thread.isRead) {
      return;
    }

    // Add a 1-second delay before marking as read to prevent race condition with mark-as-unread operations.
    // Without this delay, marking a thread as unread would be immediately overridden by the auto-read behavior
    // when the control panel window is visible, making the unread action ineffective.
    const timeoutId = setTimeout(() => {
      // Double-check conditions before marking as read (thread might have changed)
      const store = useThreadStore.getState();
      const currentThread = store.threads[threadId];
      const stillActive = store.activeThreadId === threadId;

      if (currentThread && !currentThread.isRead && stillActive) {
        logger.info(`[useMarkThreadAsRead] Marking thread ${threadId} as read (viewed)`);
        store.markThreadAsRead(threadId);
      }
    }, 1000);

    // Cleanup timeout if effect runs again
    return () => {
      clearTimeout(timeoutId);
    };
  }, [markOnView, threadId, thread?.isRead, thread?.id, isActiveThread]);

  // Mark as read when thread completes
  useEffect(() => {
    if (!markOnComplete || !threadId || !thread || !isActiveThread) {
      return;
    }

    // Mark as read when status changes to completed
    if (thread.status === "completed" && !thread.isRead) {
      // Add a 1-second delay before marking as read to prevent race condition with mark-as-unread operations.
      const timeoutId = setTimeout(() => {
        // Double-check conditions before marking as read (thread might have changed)
        const store = useThreadStore.getState();
        const currentThread = store.threads[threadId];
        const stillActive = store.activeThreadId === threadId;

        if (currentThread && currentThread.status === "completed" && !currentThread.isRead && stillActive) {
          logger.info(`[useMarkThreadAsRead] Marking thread ${threadId} as read (completed)`);
          store.markThreadAsRead(threadId);
        }
      }, 1000);

      // Cleanup timeout if effect runs again
      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [markOnComplete, threadId, thread?.status, thread?.isRead, isActiveThread]);

  // Return the mark function for manual calls
  return {
    markAsRead: useCallback(() => {
      const store = useThreadStore.getState();
      const currentThread = threadId ? store.threads[threadId] : undefined;
      const stillActive = store.activeThreadId === threadId;

      if (threadId && currentThread && stillActive) {
        logger.info(`[useMarkThreadAsRead] Marking thread ${threadId} as read (manual)`);
        store.markThreadAsRead(threadId);
      } else if (!stillActive) {
        logger.debug(`[useMarkThreadAsRead] Skipping manual mark as read - thread not active:`, threadId);
      } else {
        logger.warn(`[useMarkThreadAsRead] Cannot mark thread as read - thread not found in store:`, threadId);
      }
    }, [threadId]),
  };
}
