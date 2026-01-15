/**
 * Task types - re-exported from core for backwards compatibility.
 * The single source of truth is now core/types/tasks.ts
 */
export {
  // Schemas
  SubtaskSchema,
  PendingReviewSchema,
  TaskMetadataSchema,
  // Types
  type TaskStatus,
  type Subtask,
  type PendingReview,
  type TaskMetadata,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
  // Constants
  TASK_STATUSES,
  ACTIVE_STATUSES,
  // Functions
  generateTaskId,
} from "../../../core/types/tasks.js";
