import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { taskService } from "@/entities/tasks/service";
import { useTaskStore } from "@/entities/tasks/store";
import { useThreadStore } from "@/entities/threads/store";
import { DeleteButton } from "@/components/tasks/delete-button";
import { cancelAgent } from "@/lib/agent-service";
import { StopCircle, ChevronRight } from "lucide-react";

interface SimpleTaskHeaderProps {
  taskId: string;
  threadId: string;
  status: "idle" | "loading" | "running" | "completed" | "error" | "cancelled";
}

/**
 * Get the dot color and animation classes based on thread status and read state
 */
function getStatusDotColor(status: "idle" | "loading" | "running" | "completed" | "error" | "cancelled", isRead?: boolean) {
  // If task is running, always show flashing green
  if (status === "running") {
    return "bg-green-500 animate-pulse";
  }

  // If task is cancelled, show red
  if (status === "cancelled") {
    return "bg-red-500";
  }

  // For all other states, show grey if read, or a subtle indicator if unread
  if (isRead === false) {
    // Unread tasks could have a slightly different shade, but keeping it simple with grey
    return "bg-surface-400";
  }

  return "bg-surface-500";
}

export function SimpleTaskHeader({ taskId, threadId, status }: SimpleTaskHeaderProps) {
  const task = useTaskStore((s) => s.tasks[taskId]);
  const thread = useThreadStore((s) => s.threads[threadId]);

  const handleDelete = async () => {
    console.log(`[SimpleTaskHeader] handleDelete called for taskId: ${taskId}`);

    try {
      // Check if task exists in store before deletion
      const task = useTaskStore.getState().tasks[taskId];
      console.log(`[SimpleTaskHeader] Task found in store:`, task ? { id: taskId, title: task.title } : 'NOT FOUND');

      if (!task) {
        console.error(`[SimpleTaskHeader] Task ${taskId} not found in store, cannot delete`);
        return;
      }

      console.log(`[SimpleTaskHeader] Starting task deletion for: ${taskId}`);
      await taskService.delete(taskId);
      console.log(`[SimpleTaskHeader] Task deletion completed successfully for: ${taskId}`);

      console.log(`[SimpleTaskHeader] Attempting to hide simple task panel...`);
      await invoke("hide_simple_task");
      console.log(`[SimpleTaskHeader] Simple task panel hidden successfully`);

    } catch (error) {
      console.error(`[SimpleTaskHeader] Error during delete operation:`, error);
      console.error(`[SimpleTaskHeader] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

      // Don't close the window if deletion failed
      throw error;
    }
  };

  const handleCancel = async () => {
    console.log(`[simple-task-header] Cancel button clicked for threadId=${threadId}`);
    // Direct cancellation via PID - works from any window
    const result = await cancelAgent(threadId);
    console.log(`[simple-task-header] cancelAgent returned: ${result}`);
  };

  const handleNavigateToTasks = async () => {
    await invoke("show_tasks_panel");
    await invoke("hide_simple_task");
  };

  const isStreaming = status === "running";

  // Display task title (truncated) or fall back to task ID
  const taskLabel = task?.title
    ? (task.title.length > 24 ? task.title.slice(0, 24) + "..." : task.title)
    : taskId.slice(0, 8) + "...";

  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700 [-webkit-app-region:drag]">
      {/* Status dot */}
      <div className={cn("w-2 h-2 rounded-full", getStatusDotColor(status, thread?.isRead))} />
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs [-webkit-app-region:no-drag]">
        <button
          onClick={handleNavigateToTasks}
          className="text-surface-400 hover:text-surface-200 transition-colors"
        >
          tasks
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 font-mono">{taskLabel}</span>
      </div>
      <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
        {isStreaming && (
          <button
            onClick={handleCancel}
            className="px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors flex items-center gap-1.5 text-xs"
            aria-label="Cancel agent"
          >
            <StopCircle size={14} />
            Cancel
          </button>
        )}
        {/* <ModeIndicator
          mode={currentMode}
          onClick={handleToggle}
          disabled={isStreaming}
        /> */}
        <DeleteButton onDelete={handleDelete} />
      </div>
    </div>
  );
}
