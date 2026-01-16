import { taskService } from "@/entities/tasks/service";
import type { TaskMetadata } from "@/entities/tasks/types";

export function useDeleteTask() {
  const deleteTask = async (task: TaskMetadata) => {
    await taskService.delete(task.id);
  };

  return {
    deleteTask,
  };
}
