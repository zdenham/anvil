import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/entities/tasks/store";
import { useThreadStore } from "@/entities/threads/store";
import { cancelAgent } from "@/lib/agent-service";
import { StopCircle, ChevronRight, X, GitCompare, MessageSquare, FileText } from "lucide-react";

export type SimpleTaskView = "thread" | "changes" | "plan";

interface SimpleTaskHeaderProps {
  taskId: string;
  threadId: string;
  status: "idle" | "loading" | "running" | "completed" | "error" | "cancelled";
  /** Current active view */
  activeView?: SimpleTaskView;
  /** Callback when view toggle is clicked */
  onToggleView?: () => void;
  /** Whether the changes view is available (has git info and file changes) */
  hasChanges?: boolean;
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

export function SimpleTaskHeader({
  taskId,
  threadId,
  status,
  activeView = "thread",
  onToggleView,
  hasChanges = false,
}: SimpleTaskHeaderProps) {
  const task = useTaskStore((s) => s.tasks[taskId]);
  const thread = useThreadStore((s) => s.threads[threadId]);

  // Debug logging for view toggle visibility
  console.log("[SimpleTaskHeader] View toggle props:", {
    hasChanges,
    onToggleView: !!onToggleView,
    activeView,
  });

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

  const handleClose = async () => {
    await invoke("hide_simple_task");
  };

  const isStreaming = status === "running";

  // Display task title (truncated) or fall back to task ID
  const taskLabel = task?.title
    ? (task.title.length > 24 ? task.title.slice(0, 24) + "..." : task.title)
    : taskId.slice(0, 8) + "...";

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700"
      data-drag-region="header"
    >
      {/* Status dot */}
      <div className={cn("w-2 h-2 rounded-full", getStatusDotColor(status, thread?.isRead))} />
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-xs" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={handleNavigateToTasks}
          className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
        >
          tasks
        </button>
        <ChevronRight size={12} className="text-surface-500" />
        <span className="text-surface-300 font-mono">{taskLabel}</span>
      </div>
      <div className="ml-auto flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
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
        {/* View toggle: Thread -> Changes -> Plan -> Thread (three-way cycle) */}
        {onToggleView && (
          <button
            onClick={onToggleView}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label={
              activeView === "thread"
                ? "View changes"
                : activeView === "changes"
                  ? "View plan"
                  : "View thread"
            }
            title={
              activeView === "thread"
                ? "View changes"
                : activeView === "changes"
                  ? "View plan"
                  : "View thread"
            }
          >
            {activeView === "thread" ? (
              <GitCompare size={16} />
            ) : activeView === "changes" ? (
              <FileText size={16} />
            ) : (
              <MessageSquare size={16} />
            )}
          </button>
        )}
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close panel (Escape)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
