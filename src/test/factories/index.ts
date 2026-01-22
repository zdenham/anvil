/**
 * Test Data Factories
 *
 * Factory functions for creating test data with sensible defaults.
 * Use these to reduce boilerplate in UI tests.
 *
 * @example
 * import { createThread, createPlan } from "@/test/factories";
 *
 * const thread = createThread({ status: "running" });
 * const plan = createPlan({ relativePath: "my-plan.md" });
 */

// Thread factories
export {
  createThread,
  createThreadTurn,
  resetThreadCounter,
} from "./thread";

// Plan factories
export {
  createPlan,
  resetPlanCounter,
} from "./plan";

// Relation factories
export { createRelation } from "./relation";

// Import reset functions directly for use in resetAllCounters
import { resetThreadCounter } from "./thread";
import { resetPlanCounter } from "./plan";

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
  resetThreadCounter();
  resetPlanCounter();
}
