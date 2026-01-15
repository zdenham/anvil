import { TaskMetadata } from "./types";

/**
 * Sort simple tasks by sortOrder (ascending = higher priority first).
 */
export function sortTasksByPriority(tasks: TaskMetadata[]): TaskMetadata[] {
  return [...tasks]
    .filter(t => t.type === "simple")
    .sort((a, b) => (a.sortOrder || a.createdAt) - (b.sortOrder || b.createdAt));
}