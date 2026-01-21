import { useMemo, useCallback } from "react";
import { useTaskStore } from "@/entities/tasks/store";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { sortTasksByPriority } from "@/entities/tasks/sort-tasks";

interface NavigationResult {
  taskId: string | null;
  threadId: string | null;
  wrapped: boolean;
  /** Whether to open plan tab instead of thread view */
  openPlanTab: boolean;
}

export function useSimpleTaskNavigation(_currentTaskId: string) {
  const tasks = useTaskStore((s) => s.tasks);
  const threads = useThreadStore((s) => s.threads);
  const getUnreadThreadsByTask = useThreadStore((s) => s.getUnreadThreadsByTask);
  const plans = usePlanStore((s) => s.plans);

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

  // Check if a task has any unread threads
  const isTaskUnread = useCallback((taskId: string): boolean => {
    const unreadThreads = getUnreadThreadsByTask(taskId);
    const hasUnreadThreads = unreadThreads.length > 0;

    if (hasUnreadThreads) {
      console.log(`[DEBUG] Task ${taskId} considered unread due to: unread threads`, {
        taskId,
        unreadThreadsCount: unreadThreads.length
      });
    }

    return hasUnreadThreads;
  }, [getUnreadThreadsByTask]);

  // Check if a task has an unread plan
  const hasUnreadPlan = useCallback((taskId: string): boolean => {
    const task = tasks[taskId];
    const taskThreads = Object.values(threads).filter((t) => t.taskId === taskId);

    // Check thread-level plan associations
    for (const thread of taskThreads) {
      if (thread.planId) {
        const plan = plans[thread.planId];
        if (plan && !plan.isRead) return true;
      }
    }

    // Check task-level plan association
    if (task?.planId) {
      const plan = plans[task.planId];
      if (plan && !plan.isRead) return true;
    }

    return false;
  }, [tasks, threads, plans]);

  const getNextTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false, openPlanTab: false };
    }

    const nextIndex = (currentIndex + 1) % sortedTasks.length;
    const task = sortedTasks[nextIndex];
    const threadId = await getThreadForTask(task?.id ?? "");

    return {
      taskId: task?.id ?? null,
      threadId,
      wrapped: nextIndex === 0,
      openPlanTab: false, // Default navigation doesn't auto-open plan tab
    };
  }, [sortedTasks, getThreadForTask]);

  const getPrevTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      return { taskId: null, threadId: null, wrapped: false, openPlanTab: false };
    }

    const prevIndex = currentIndex === 0 ? sortedTasks.length - 1 : currentIndex - 1;
    const task = sortedTasks[prevIndex];
    const threadId = await getThreadForTask(task?.id ?? "");

    return {
      taskId: task?.id ?? null,
      threadId,
      wrapped: currentIndex === 0,
      openPlanTab: false, // Default navigation doesn't auto-open plan tab
    };
  }, [sortedTasks, getThreadForTask]);

  // Get highest priority task that needs attention (unread thread OR unread plan)
  const getFirstUnreadTaskId = useCallback(async (): Promise<NavigationResult> => {
    // Find first task with either unread thread or unread plan
    const firstUnread = sortedTasks.find(t => isTaskUnread(t.id) || hasUnreadPlan(t.id));
    if (!firstUnread) {
      return { taskId: null, threadId: null, wrapped: false, openPlanTab: false };
    }

    const threadId = await getThreadForTask(firstUnread.id);
    // Determine if we should open plan tab: only if thread is read but plan is unread
    const threadIsUnread = isTaskUnread(firstUnread.id);
    const planIsUnread = hasUnreadPlan(firstUnread.id);
    const openPlanTab = !threadIsUnread && planIsUnread;

    return {
      taskId: firstUnread.id,
      threadId,
      wrapped: false,
      openPlanTab,
    };
  }, [sortedTasks, isTaskUnread, hasUnreadPlan, getThreadForTask]);

  // Get next unread task after current one (for navigation after actions)
  // Now includes tasks with unread plans, not just unread threads
  const getNextUnreadTaskId = useCallback(async (currentId: string): Promise<NavigationResult> => {
    const currentIndex = sortedTasks.findIndex(t => t.id === currentId);
    if (currentIndex === -1 || sortedTasks.length === 0) {
      console.log(`[DEBUG] getNextUnreadTaskId: No current task found or no tasks available`, { currentId, totalTasks: sortedTasks.length });
      return { taskId: null, threadId: null, wrapped: false, openPlanTab: false };
    }

    console.log(`[DEBUG] getNextUnreadTaskId: Starting search for next unread task after ${currentId}`, {
      currentIndex,
      totalTasks: sortedTasks.length
    });

    // Look for next unread task after current position
    // Now includes tasks with unread plans OR unread threads
    for (let i = 1; i < sortedTasks.length; i++) {
      const nextIndex = (currentIndex + i) % sortedTasks.length;
      const task = sortedTasks[nextIndex];

      const threadIsUnread = isTaskUnread(task.id);
      const planIsUnread = hasUnreadPlan(task.id);

      console.log(`[DEBUG] getNextUnreadTaskId: Checking task ${task.id} at index ${nextIndex}`, {
        threadIsUnread,
        planIsUnread
      });

      if (threadIsUnread || planIsUnread) {
        const threadId = await getThreadForTask(task.id);
        // Determine if we should open plan tab: only if thread is read but plan is unread
        // This prioritizes unread threads over unread plans
        const openPlanTab = !threadIsUnread && planIsUnread;

        console.log(`[DEBUG] getNextUnreadTaskId: Found next unread task`, {
          taskId: task.id,
          threadId,
          wrapped: nextIndex < currentIndex,
          openPlanTab
        });
        return {
          taskId: task.id,
          threadId,
          wrapped: nextIndex < currentIndex, // wrapped if we cycled back to beginning
          openPlanTab,
        };
      }
    }

    // No unread tasks found
    console.log(`[DEBUG] getNextUnreadTaskId: No unread tasks found after ${currentId}`);
    return { taskId: null, threadId: null, wrapped: false, openPlanTab: false };
  }, [sortedTasks, isTaskUnread, hasUnreadPlan, getThreadForTask]);

  return {
    getNextTaskId,
    getPrevTaskId,
    getFirstUnreadTaskId,
    getNextUnreadTaskId,
    sortedTasks,
    isTaskUnread,
    hasUnreadPlan,
  };
}