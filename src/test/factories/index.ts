/**
 * Test Data Factories
 *
 * Factory functions for creating test data with sensible defaults.
 * Use these to reduce boilerplate in UI tests.
 *
 * @example
 * import { createTask, createThread, createSubtask } from "@/test/factories";
 *
 * const task = createTask({ status: "in-progress" });
 * const thread = createThread({ taskId: task.id, status: "running" });
 */

// Task factories
export {
  createTask,
  createSubtask,
  createPendingReview,
  resetTaskCounter,
} from "./task";

// Thread factories
export {
  createThread,
  createThreadTurn,
  resetThreadCounter,
} from "./thread";

// Import reset functions directly for use in resetAllCounters
import { resetTaskCounter } from "./task";
import { resetThreadCounter } from "./thread";

/**
 * Reset all factory counters.
 * Call this in beforeEach to ensure consistent IDs across test runs.
 *
 * @example
 * beforeEach(() => {
 *   resetAllCounters();
 * });
 */
export function resetAllCounters(): void {
  resetTaskCounter();
  resetThreadCounter();
}
