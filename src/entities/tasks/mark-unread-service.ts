import { taskService } from "./service";
import { useTaskStore } from "./store";
import type { TaskMetadata } from "./types";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { threadService } from "../threads/service";
import { useThreadStore } from "../threads/store";

/**
 * Move a task to the bottom of the priority list (below other unread/running tasks).
 * Task remains unread - only sortOrder is updated.
 *
 * This is called "Mark Unread" in the UI but functionally acts like a snooze -
 * moving the task to a lower priority position while keeping it unread.
 */
export async function markTaskUnread(taskId: string): Promise<void> {
  const tasks = useTaskStore.getState().tasks;
  const allTasks = Object.values(tasks).filter((t) => t.type === "simple");

  // Find the highest sortOrder among unread tasks only
  // (higher sortOrder = lower priority = appears later in navigation)
  const maxSortOrder = Math.max(
    ...allTasks
      .filter((t) => isTaskUnread(t))
      .map((t) => t.sortOrder || t.createdAt),
    0  // Fallback to 0 if no tasks found
  );

  // Set sortOrder to be higher than current max (lower priority)
  const newSortOrder = maxSortOrder + 1000; // Add buffer for future insertions

  await taskService.update(taskId, {
    sortOrder: newSortOrder,
    // DO NOT update status or pendingReviews - keep task unread
  });

  // Mark the active (latest) thread as unread to ensure blue dot appears
  const taskThreads = threadService.getByTask(taskId);
  if (taskThreads.length > 0) {
    // Threads are sorted by createdAt descending (newest first), so [0] is the active thread
    const activeThread = taskThreads[0];
    await useThreadStore.getState().markThreadAsUnread(activeThread.id);
    console.log(`[MarkUnreadService] Marked active thread as unread: ${activeThread.id}`);
  }

  // Emit event for cross-window notification
  eventBus.emit(EventName.TASK_MARKED_UNREAD, { taskId });
  console.log(`[MarkUnreadService] Emitted TASK_MARKED_UNREAD event for: ${taskId}`);
}

/**
 * Check if a task needs attention (unread).
 * Same logic as simplified-task-color-coding.md and task-navigation-hotkeys.md
 */
function isTaskUnread(task: TaskMetadata): boolean {
  const hasUnaddressedReviews =
    task.pendingReviews?.some((r) => !r.isAddressed) ?? false;
  const isIncomplete = !["done", "cancelled"].includes(task.status);
  return hasUnaddressedReviews || isIncomplete;
}

