import type { TaskMetadata } from "@/entities/tasks/types";
import type { ThreadMetadata } from "@/entities/threads/types";

/**
 * Color information for a task dot
 */
export interface TaskDotColor {
  /** Tailwind CSS background color class */
  color: string;
  /** Optional Tailwind CSS animation class */
  animation?: string;
}

/**
 * Determines the color for a task dot based on thread activity and read status.
 *
 * Priority order:
 * 1. Running - flashing green dot (any thread with status 'running')
 * 2. Unread threads - blue dot (any thread marked as unread)
 * 3. Read/complete - grey dot (all threads read and no threads running)
 */
export function getTaskDotColor(
  task: TaskMetadata,
  threads: ThreadMetadata[]
): TaskDotColor {
  // Filter to only threads belonging to this task
  const taskThreads = threads.filter((t) => t.taskId === task.id);

  // 1. Running - flashing green dot (duller green)
  const hasRunningThread = taskThreads.some((t) => t.status === "running");
  if (hasRunningThread) {
    return {
      color: "bg-green-400", // Duller than current bg-green-500
      animation: "animate-pulse",
    };
  }

  // 2. Unread threads - blue dot (has unread thread activity)
  const hasUnreadThreads = taskThreads.some((t) => !t.isRead);
  if (hasUnreadThreads) {
    return { color: "bg-blue-500" };
  }

  // 3. Read/complete - grey dot (all threads read and viewed)
  return { color: "bg-zinc-400" };
}

/**
 * Gets the count of unread threads for a task.
 */
export function getTaskUnreadCount(
  taskId: string,
  threads: ThreadMetadata[]
): number {
  return threads.filter((t) => t.taskId === taskId && !t.isRead).length;
}

/**
 * Checks if a task has any running threads.
 */
export function hasRunningThreads(
  taskId: string,
  threads: ThreadMetadata[]
): boolean {
  return threads.some((t) => t.taskId === taskId && t.status === "running");
}

/**
 * Checks if a task has any unread threads.
 */
export function hasUnreadThreads(
  taskId: string,
  threads: ThreadMetadata[]
): boolean {
  return threads.some((t) => t.taskId === taskId && !t.isRead);
}
