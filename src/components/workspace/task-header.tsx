import { useTaskStore } from "@/entities/tasks/store";
import { GitBranch, Folder, ExternalLink } from "lucide-react";
import type { TaskStatus } from "@/entities/tasks/types";

interface TaskHeaderProps {
  taskId: string;
  onOpenTask?: () => void;
}

/**
 * Task context header component.
 * Shows task information including title, type, status, and branch.
 * Spans the full width at the top of the workspace.
 */
export function TaskHeader({ taskId, onOpenTask }: TaskHeaderProps) {
  const task = useTaskStore((state) => state.tasks[taskId]);

  if (!task) return null;

  const typeLabel = task.type === "work" ? "Work" : "Investigate";
  const typeBg =
    task.type === "work"
      ? "bg-accent-500/20 text-accent-400"
      : "bg-secondary-500/20 text-secondary-400";

  return (
    <div className="px-4 py-3 border-b border-surface-700/50 bg-surface-800/30">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${typeBg}`}>
          {typeLabel}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-medium text-surface-200 truncate">
              {task.title}
            </h1>
            <TaskStatusBadge status={task.status} />
          </div>
          {task.description && (
            <p className="text-xs text-surface-400 truncate mt-0.5">
              {task.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {task.repositoryName && (
            <div className="flex items-center gap-1.5 text-xs text-surface-500">
              <Folder size={12} />
              <span>{task.repositoryName}</span>
            </div>
          )}
          {task.branchName && (
            <div className="flex items-center gap-1.5 text-xs text-surface-500">
              <GitBranch size={12} />
              <span className="font-mono">{task.branchName}</span>
            </div>
          )}
          {onOpenTask && (
            <button
              onClick={onOpenTask}
              className="p-1.5 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
              aria-label="Open task details"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status] ?? statusConfig["backlog"];
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-600/50 text-surface-300" },
  backlog: { label: "Backlog", className: "bg-surface-600 text-surface-200" },
  todo: { label: "To Do", className: "bg-amber-500/20 text-amber-400" },
  "in-progress": { label: "In Progress", className: "bg-accent-500 text-white" },
  "in-review": { label: "In Review", className: "bg-secondary-500 text-white" },
  done: { label: "Done", className: "bg-green-500 text-white" },
  cancelled: { label: "Cancelled", className: "bg-red-500 text-white" },
};
