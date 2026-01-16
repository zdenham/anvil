import { useMemo } from "react";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import { useThreadStore } from "@/entities/threads/store";
import { getTaskDotColor } from "@/utils/task-colors";
import { DeleteButton } from "@/components/tasks/delete-button";

export interface UnifiedTaskListProps {
  /** Array of tasks to display */
  tasks: TaskMetadata[];
  /** Callback when a task is selected/clicked */
  onTaskSelect: (task: TaskMetadata) => void;
  /** Custom CSS classes for the container */
  className?: string;
  /** Optional callback when a task should be deleted */
  onTaskDelete?: (task: TaskMetadata) => void;
}

/**
 * UnifiedTaskList - Consolidated task display component
 *
 * Displays tasks in a simple list format with click-to-select functionality.
 */
export function UnifiedTaskList({
  tasks,
  onTaskSelect,
  className = "",
  onTaskDelete,
}: UnifiedTaskListProps) {
  const allThreads = useThreadStore((s) => s.getAllThreads());

  // Sort tasks by updatedAt (most recent first)
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks]
  );

  if (sortedTasks.length === 0) {
    return (
      <div className={`p-4 px-6 text-center text-surface-500 text-sm ${className}`}>
        No tasks yet
      </div>
    );
  }

  return (
    <div className={className}>
      <ul className="space-y-2 px-3 pt-3">
        {sortedTasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            threads={allThreads}
            onClick={() => onTaskSelect(task)}
            onDelete={onTaskDelete}
          />
        ))}
      </ul>
    </div>
  );
}

interface TaskItemProps {
  task: TaskMetadata;
  threads: ThreadMetadata[];
  onClick: () => void;
  onDelete?: (task: TaskMetadata) => void;
}

function TaskItem({ task, threads, onClick, onDelete }: TaskItemProps) {
  return (
    <li
      onClick={onClick}
      className="group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors"
    >
      <StatusDot task={task} threads={threads} />
      <span className="flex-1 text-sm text-surface-100 truncate font-mono">
        {task.title}
      </span>

      {/* Tags */}
      {task.tags.length > 0 && (
        <div className="flex gap-1">
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-700 text-surface-400 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Subtask progress */}
      {task.subtasks.length > 0 && (
        <span className="text-xs text-surface-500">
          {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
        </span>
      )}

      {/* Delete button */}
      {onDelete && (
        <DeleteButton onDelete={() => onDelete(task)} />
      )}
    </li>
  );
}

function StatusDot({ task, threads }: { task: TaskMetadata; threads: ThreadMetadata[] }) {
  const { color, animation } = getTaskDotColor(task, threads);

  // Create tooltip that shows thread status
  const taskThreads = threads.filter(t => t.taskId === task.id);
  const runningCount = taskThreads.filter(t => t.status === 'running').length;
  const unreadCount = taskThreads.filter(t => !t.isRead).length;

  const tooltipParts = [];
  if (runningCount > 0) {
    tooltipParts.push(`${runningCount} running`);
  }
  if (unreadCount > 0) {
    tooltipParts.push(`${unreadCount} unread`);
  }
  tooltipParts.push(`Status: ${task.status}`);

  const title = tooltipParts.join(' • ');

  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
      title={title}
    />
  );
}