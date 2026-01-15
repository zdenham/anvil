import { useMemo, useCallback } from "react";
import { useTaskStore } from "@/entities/tasks/store";
import { useThreadStore } from "@/entities/threads/store";
import { sortTasksByPriority } from "@/entities/tasks/sort-tasks";

interface NavigationResult {
  taskId: string | null;
  threadId: string | null;
  wrapped: boolean;
}

export function useSimpleTaskNavigation(_currentTaskId: string) {
  const tasks = useTaskStore((s) => s.tasks);
  const getUnreadThreadsByTask = useThreadStore((s) => s.getUnreadThreadsByTask);

  // Get sorted simple tasks
  const sortedTasks = useMemo(() => {
    return sortTasksByPriority(Object.values(tasks));
  }, [tasks]);

  // Helper to get thread for a task
  const getThreadForTask = useCallback(async (taskId: string): Promise<string | null> => {
    // Import threadService dynamically to avoid circular imports
    const { threadService } = await import("@/entities/threads/service");
    const taskThreads = threadService.getByTask(taskId);
    return taskThreads[0]?.id ?? null;
  }, []);

  // Check if a task needs attention (only based on unread threads)
  const isTaskUnread = useCallback((taskId: string): boolean => {
    // Only check for unread threads - this is what really matters for navigation
    const unreadThreads = getUnreadThreadsByTask(taskId);
    const hasUnreadThreads = unreadThreads.length > 0;

    // Debug logging to help identify why navigation is triggering
    if (hasUnreadThreads) {
      console.log(`[DEBUG] Task ${taskId} considered unread due to: unread threads`, {
        taskId,
        unreadThreadsCount: unreadThreads.length
      });
    }

    return hasUnreadThreads;
  }, [getUnreadThreadsByTask]);

  const getNextTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false };
    }

    const nextIndex = (currentIndex + 1) % sortedTasks.length;
    const task = sortedTasks[nextIndex];
    const threadId = await getThreadForTask(task?.id ?? "");

    return {
      taskId: task?.id ?? null,
      threadId,
      wrapped: nextIndex === 0,
    };
  }, [sortedTasks, getThreadForTask]);

  const getPrevTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false };
    }

    const prevIndex = currentIndex === 0 ? sortedTasks.length - 1 : currentIndex - 1;
    const task = sortedTasks[prevIndex];
    const threadId = await getThreadForTask(task?.id ?? "");

    return {
      taskId: task?.id ?? null,
      threadId,
      wrapped: currentIndex === 0,
    };
  }, [sortedTasks, getThreadForTask]);

  // Get highest priority task that needs attention (unread)
  const getFirstUnreadTaskId = useCallback(async (): Promise<NavigationResult> => {
    const firstUnread = sortedTasks.find(t => isTaskUnread(t.id));
    if (!firstUnread) {
      return { taskId: null, threadId: null, wrapped: false };
    }

    const threadId = await getThreadForTask(firstUnread.id);
    return {
      taskId: firstUnread.id,
      threadId,
      wrapped: false,
    };
  }, [sortedTasks, isTaskUnread, getThreadForTask]);

  // Get next unread task after current one (for navigation after actions)
  const getNextUnreadTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      console.log(`[DEBUG] getNextUnreadTaskId: No current task found or no tasks available`, { currentId, totalTasks: sortedTasks.length });
      return { taskId: null, threadId: null, wrapped: false };
    }

    console.log(`[DEBUG] getNextUnreadTaskId: Starting search for next unread task after ${currentId}`, {
      currentIndex,
      totalTasks: sortedTasks.length
    });

    // Look for next unread task after current position
    for (let i = 1; i < sortedTasks.length; i++) {
      const nextIndex = (currentIndex + i) % sortedTasks.length;
      const task = sortedTasks[nextIndex];

      console.log(`[DEBUG] getNextUnreadTaskId: Checking task ${task.id} at index ${nextIndex}`);

      if (isTaskUnread(task.id)) {
        const threadId = await getThreadForTask(task.id);
        console.log(`[DEBUG] getNextUnreadTaskId: Found next unread task`, {
          taskId: task.id,
          threadId,
          wrapped: nextIndex < currentIndex
        });
        return {
          taskId: task.id,
          threadId,
          wrapped: nextIndex < currentIndex, // wrapped if we cycled back to beginning
        };
      }
    }

    // No unread tasks found
    console.log(`[DEBUG] getNextUnreadTaskId: No unread tasks found after ${currentId}`);
    return { taskId: null, threadId: null, wrapped: false };
  }, [sortedTasks, isTaskUnread, getThreadForTask]);

  return {
    getNextTaskId,
    getPrevTaskId,
    getFirstUnreadTaskId,
    getNextUnreadTaskId,
    sortedTasks,
    isTaskUnread,
  };
}