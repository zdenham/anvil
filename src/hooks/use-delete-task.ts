import { useState } from "react";
import { taskService } from "@/entities/tasks/service";
import type { TaskMetadata } from "@/entities/tasks/types";

export function useDeleteTask() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<TaskMetadata | null>(null);

  const requestDelete = (task: TaskMetadata) => {
    setTaskToDelete(task);
  };

  const confirmDelete = async () => {
    if (!taskToDelete) return;
    setIsDeleting(true);
    try {
      await taskService.delete(taskToDelete.id);
    } finally {
      setIsDeleting(false);
      setTaskToDelete(null);
    }
  };

  const cancelDelete = () => {
    setTaskToDelete(null);
  };

  return {
    taskToDelete,
    isDeleting,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
