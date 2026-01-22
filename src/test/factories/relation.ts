/**
 * Test factory for PlanThreadRelation
 *
 * Creates PlanThreadRelation objects with sensible defaults for UI testing.
 * All required fields have default values that can be overridden.
 */

import type { PlanThreadRelation, RelationType } from "@core/types/relations.js";

/**
 * Create a PlanThreadRelation object with sensible defaults.
 *
 * @example
 * // Create a relation with default values
 * const relation = createRelation();
 *
 * @example
 * // Create a relation with specific overrides
 * const relation = createRelation({
 *   planId: "plan-123",
 *   threadId: "thread-456",
 *   type: "created",
 * });
 */
export function createRelation(
  overrides: Partial<PlanThreadRelation> = {}
): PlanThreadRelation {
  const now = Date.now();

  return {
    planId: "plan-default",
    threadId: "thread-default",
    type: "mentioned" as RelationType,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
