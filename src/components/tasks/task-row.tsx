import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ExternalLink, GitMerge, Eye } from "lucide-react";
import type { TaskMetadata } from "@/entities/tasks/types";
import { useThreadStore } from "@/entities/threads/store";
import { getTaskDotColor } from "@/utils/task-colors";
import { DeleteButton } from "./delete-button";


interface TaskRowProps {
  task: TaskMetadata;
  onClick: () => void;
  onDelete?: (task: TaskMetadata) => void;
}

export function TaskRow({ task, onClick, onDelete }: TaskRowProps) {
  const allThreads = useThreadStore((s) => s.getAllThreads());
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const { color, animation } = getTaskDotColor(task, allThreads);

  // Determine if task is in merge phase (in-review with reviewApproved)
  const isInMergePhase = task.status === "in-review" && task.reviewApproved;
  const isInReviewPhase = task.status === "in-review" && !task.reviewApproved;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors"
      onClick={onClick}
      data-testid={`task-item-${task.id}`}
    >
      <button
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-surface-500 hover:text-surface-400 transition-opacity"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
        title={`Status: ${task.status}`}
        data-testid={`task-status-${task.id}`}
      />
      <span className="flex-1 text-sm text-surface-100 truncate font-mono" data-testid={`task-title-${task.id}`}>{task.title}</span>

      {/* Review/Merge phase indicator */}
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

      {/* PR link */}
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
      {task.subtasks.length > 0 && (
        <span className="text-xs text-surface-500">
          {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
        </span>
      )}
      {onDelete && (
        <DeleteButton onDelete={() => onDelete(task)} />
      )}
    </div>
  );
}
