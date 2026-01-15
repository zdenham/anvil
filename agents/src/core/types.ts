/**
 * Task types - re-exported from core for backwards compatibility.
 * The single source of truth is now core/types/tasks.ts
 */
export {
  type TaskStatus,
  type Subtask,
  type PendingReview,
  type TaskMetadata,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
  TASK_STATUSES,
  ACTIVE_STATUSES,
  generateTaskId,
  // Zod schemas for runtime validation at trust boundaries
  SubtaskSchema,
  PendingReviewSchema,
  TaskMetadataSchema,
} from "../../../core/types/tasks.js";
