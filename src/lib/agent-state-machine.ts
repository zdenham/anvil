import type { TaskStatus } from "@/entities/tasks/types";

/**
 * Get the next status in the workflow progression.
 * Returns the same status if already at terminal state.
 */
export function getNextStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case "backlog":
      return "todo";
    case "todo":
      return "in-progress";
    case "in-progress":
      return "in-review";
    case "in-review":
      return "done";
    default:
      return status;
  }
}

/**
 * Check if a status can progress to the next phase.
 * Only active statuses (where agents can be spawned) can progress.
 */
export function canProgress(status: TaskStatus): boolean {
  return status === "todo" || status === "in-progress" || status === "in-review";
}

/**
 * Get human-readable label for what the next phase is.
 * For in-review, depends on whether review has been approved.
 */
export function getNextPhaseLabel(status: TaskStatus, reviewApproved?: boolean): string {
  switch (status) {
    case "backlog":
      return "Plan";
    case "todo":
      return "Implement";
    case "in-progress":
      return "Review";
    case "in-review":
      return reviewApproved ? "Complete" : "Merge";
    default:
      return "Done";
  }
}

/**
 * Get human-readable label for the current phase.
 */
export function getCurrentPhaseLabel(status: TaskStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "backlog":
      return "Backlog";
    case "todo":
      return "Planning";
    case "in-progress":
      return "Implementation";
    case "in-review":
      return "Review & Merge";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
