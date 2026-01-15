import { AlertTriangle, Loader2 } from "lucide-react";
import type { TaskMetadata } from "@/entities/tasks/types";
import { useTaskThreads } from "@/hooks/use-task-threads";

interface DeleteTaskDialogProps {
  task: TaskMetadata | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteTaskDialog({
  task,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteTaskDialogProps) {
  // Get threads for this task from the store
  const threads = useTaskThreads(task?.id ?? null);

  if (!task) return null;

  const hasSubtasks = task.subtasks.length > 0;
  const hasThreads = threads.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={isDeleting ? undefined : onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-surface-800 rounded-lg border border-surface-700 shadow-xl w-full max-w-md mx-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-surface-100 mb-2">
            Delete Task?
          </h2>
          <p className="text-sm text-surface-400 mb-4">
            Are you sure you want to delete "{task.title}"?
          </p>

          {(hasSubtasks || hasThreads) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
              <div className="flex gap-2">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-200">
                  {hasSubtasks && (
                    <p>
                      This will also delete {task.subtasks.length} subtask
                      {task.subtasks.length > 1 ? "s" : ""}.
                    </p>
                  )}
                  {hasThreads && (
                    <p>
                      {threads.length} thread
                      {threads.length > 1 ? "s" : ""} will be deleted.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={isDeleting}
              className="px-4 py-2 text-sm text-surface-300 hover:text-surface-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isDeleting}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
