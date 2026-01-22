import type { ThreadStatus } from "@core/types/threads";

/**
 * Get the next status in the workflow progression.
 * Returns the same status if already at terminal state.
 */
export function getNextStatus(status: ThreadStatus): ThreadStatus {
  switch (status) {
    case "idle":
      return "running";
    case "running":
      return "completed";
    default:
      return status;
  }
}

/**
 * Check if a status can progress to the next phase.
 */
export function canProgress(status: ThreadStatus): boolean {
  return status === "idle" || status === "running";
}

/**
 * Get human-readable label for the current phase.
 */
export function getCurrentPhaseLabel(status: ThreadStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
