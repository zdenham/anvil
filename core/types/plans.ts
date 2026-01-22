import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Plan Entity Types - Zod schemas with derived types
// Storage: ~/.mort/plans/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for plan metadata persisted to disk.
 * Validated when loading from JSON files.
 *
 * Uses absolute paths to simplify plan detection and content resolution.
 * This eliminates the need for repositoryName lookups and works correctly
 * with worktrees.
 */
export const PlanMetadataSchema = z.object({
  /** Unique plan ID (UUID) */
  id: z.string().uuid(),
  /** Absolute path to the plan file (e.g., "/Users/.../mortician/plans/feature-x.md") */
  absolutePath: z.string(),
  /** Whether user has viewed the plan - defaults to false (unread) */
  isRead: z.boolean().default(false),
  /** Timestamps */
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Plan metadata persisted to disk */
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

/** Input for creating a new plan */
export interface CreatePlanInput {
  absolutePath: string;
}

/** Input for updating a plan */
export interface UpdatePlanInput {
  isRead?: boolean;
}
