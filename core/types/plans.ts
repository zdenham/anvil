import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Plan Entity Types - Zod schemas with derived types
// Storage: ~/.mort/plans/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for plan metadata persisted to disk.
 * Validated when loading from JSON files.
 */
export const PlanMetadataSchema = z.object({
  /** Unique plan ID (UUID) */
  id: z.string().uuid(),
  /** Path to the plan file relative to repository root (e.g., "plans/feature-x.md") */
  path: z.string(),
  /** Repository name this plan belongs to */
  repositoryName: z.string(),
  /** Plan title (extracted from filename or first H1 in content) */
  title: z.string(),
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
  path: string;
  repositoryName: string;
  title?: string;
}

/** Input for updating a plan */
export interface UpdatePlanInput {
  title?: string;
  isRead?: boolean;
}
