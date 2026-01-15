import { TaskMetadata, TaskStatus, TASK_STATUSES } from "./types";

/**
 * Sort tasks in kanban order: by column (draft → done), then by sortOrder within each column.
 */
export function sortTasksInKanbanOrder(tasks: TaskMetadata[]): TaskMetadata[] {
  const groups: Record<TaskStatus, TaskMetadata[]> = {
    draft: [],
    backlog: [],
    todo: [],
    "in-progress": [],
    "in-review": [],
    done: [],
    cancelled: [],
  };

  for (const task of tasks) {
    const status = task.status;
    if (groups[status]) {
      groups[status].push(task);
    }
  }

  for (const status of TASK_STATUSES) {
    groups[status].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return TASK_STATUSES.flatMap((status) => groups[status]);
}
