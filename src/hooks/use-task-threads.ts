import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import type { ThreadMetadata } from "@/entities/threads/types";

/**
 * Gets all threads associated with a task.
 * Filters threads by taskId from the thread store.
 * Returns threads sorted by creation time (newest first).
 */
export function useTaskThreads(taskId: string | null): ThreadMetadata[] {
  // Use store's cached threads array instead of Object.values
  const threadsArray = useThreadStore((state) => state._threadsArray);

  // Memoize the derived array to avoid infinite re-renders
  // Only recompute when threadsArray or taskId changes
  const threads = useMemo(() => {
    if (!taskId) return [];

    // Filter threads that belong to this task
    return threadsArray
      .filter((thread) => thread.taskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [threadsArray, taskId]);

  return threads;
}
