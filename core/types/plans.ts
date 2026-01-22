import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// Plan Entity Types - Zod schemas with derived types
// Storage: ~/.mort/plans/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for plan metadata persisted to disk.
 * Validated when loading from JSON files.
 *
 * Uses structured paths (repoId + worktreeId + relativePath) instead of
 * absolute paths for better portability and worktree support.
 */
export const PlanMetadataSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  worktreeId: z.string().uuid(),       // Required - main repo is also a worktree
  relativePath: z.string(),            // Path relative to repo's plans directory
  parentId: z.string().uuid().optional(), // For nested plans
  isRead: z.boolean().default(false),
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
});

/** Plan metadata persisted to disk */
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

/** Input for creating a new plan */
export interface CreatePlanInput {
  repoId: string;
  worktreeId: string;
  relativePath: string;
  parentId?: string;
}

/** Input for updating a plan */
export interface UpdatePlanInput {
  isRead?: boolean;
  parentId?: string;
}
