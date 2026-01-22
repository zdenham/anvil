/**
 * Test factory for PlanMetadata
 *
 * Creates PlanMetadata objects with sensible defaults for UI testing.
 * All required fields have default values that can be overridden.
 */

import type { PlanMetadata } from "@/entities/plans/types";

let planCounter = 0;

/**
 * Create a PlanMetadata object with sensible defaults.
 *
 * @example
 * // Create a plan with default values
 * const plan = createPlan();
 *
 * @example
 * // Create a plan with specific overrides
 * const plan = createPlan({
 *   relativePath: "my-feature.md",
 *   isRead: false,
 * });
 */
export function createPlan(overrides: Partial<PlanMetadata> = {}): PlanMetadata {
  const counter = ++planCounter;
  const now = Date.now();

  return {
    id: `plan-${counter}`,
    repoId: "repo-default",
    worktreeId: "worktree-default",
    relativePath: `plan-${counter}.md`,
    isRead: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as PlanMetadata;
}

/**
 * Reset the plan counter. Useful for test isolation.
 * Call this in beforeEach to ensure consistent IDs across test runs.
 */
export function resetPlanCounter(): void {
  planCounter = 0;
}
