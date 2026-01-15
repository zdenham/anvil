import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ExternalLink, GitMerge, Eye } from "lucide-react";
import type { TaskMetadata, TaskStatus } from "@/entities/tasks/types";
import { useThreadStore } from "@/entities/threads/store";
import { getTaskDotColor } from "@/utils/task-colors";
import { DeleteButton } from "./delete-button";

/**
 * Status badge configuration for task cards.
 */
const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-600/30 text-surface-400" },
  backlog: { label: "Backlog", className: "bg-surface-600/50 text-surface-300" },
  todo: { label: "To Do", className: "bg-amber-500/20 text-amber-400" },
  "in-progress": { label: "Working", className: "bg-accent-500/20 text-accent-400" },
  "in-review": { label: "Review", className: "bg-secondary-500/20 text-secondary-400" },
  done: { label: "Done", className: "bg-emerald-500/20 text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-red-500/20 text-red-400" },
};

interface TaskCardProps {
  task: TaskMetadata;
  onClick: () => void;
  onDelete?: (task: TaskMetadata) => void;
}

export function TaskCard({ task, onClick, onDelete }: TaskCardProps) {
  const allThreads = useThreadStore((s) => s.getAllThreads());
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const statusConfig = STATUS_CONFIG[task.status];
  const { color, animation } = getTaskDotColor(task, allThreads);

  // Determine if task is in merge phase (in-review with reviewApproved)
  const isInMergePhase = task.status === "in-review" && task.reviewApproved;
  const isInReviewPhase = task.status === "in-review" && !task.reviewApproved;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-surface-800 rounded-lg border border-surface-700 p-3 cursor-pointer hover:border-surface-600 transition-colors"
      onClick={onClick}
      data-testid={`task-item-${task.id}`}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-surface-500 hover:text-surface-400 transition-opacity"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
                title={`Status: ${task.status}`}
              />
              <p className="text-sm text-surface-100 truncate flex-1" data-testid={`task-title-${task.id}`}>{task.title}</p>
            </div>
            {onDelete && (
              <DeleteButton onDelete={() => onDelete(task)} />
            )}
          </div>

          {/* Status badge row with phase indicator */}
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusConfig.className}`} data-testid={`task-status-${task.id}`}>
              {statusConfig.label}
            </span>

            {/* Simple task indicator */}
            {task.type === "simple" && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-500/20 text-purple-400">
                Quick
              </span>
            )}

            {/* Review/Merge phase indicator for in-review status */}
            {isInReviewPhase && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-secondary-400 bg-secondary-500/10 rounded">
                <Eye size={10} />
                Review
              </span>
            )}
            {isInMergePhase && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-accent-400 bg-accent-500/10 rounded">
                <GitMerge size={10} />
                Merge
              </span>
            )}

            {/* PR link for tasks with prUrl */}
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-accent-400 hover:text-accent-300 bg-accent-500/10 rounded transition-colors"
                title="View Pull Request"
              >
                <ExternalLink size={10} />
                PR
              </a>
            )}
          </div>

          {task.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {task.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-700 text-surface-400 rounded"
                >
                  {tag}
                </span>
              ))}
              {task.tags.length > 3 && (
                <span className="text-[10px] text-surface-500">+{task.tags.length - 3}</span>
              )}
            </div>
          )}
          {task.subtasks.length > 0 && (
            <p className="text-xs text-surface-500 mt-2">
              {completedSubtasks}/{task.subtasks.length} subtasks
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
