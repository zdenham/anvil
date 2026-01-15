import { taskService } from "./service";

/**
 * Archive (delete) a task.
 * Cancels any running threads before deletion.
 */
export async function archiveTask(taskId: string): Promise<void> {
  // Issue cancellation signal for any running threads
  // Import threadService and cancelAgent dynamically to avoid circular imports
  const { threadService } = await import("@/entities/threads/service");
  const { cancelAgent } = await import("@/lib/agent-service");

  const threads = threadService.getByTask(taskId);
  for (const thread of threads) {
    if (thread.status === "running") {
      await cancelAgent(thread.id);
    }
  }

  // Delete the task (this also cleans up threads)
  await taskService.delete(taskId);
}