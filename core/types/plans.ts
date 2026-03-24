import { z } from 'zod';
import { VisualSettingsSchema } from './visual-settings.js';

// ═══════════════════════════════════════════════════════════════════════════
// Plan Entity Types - Zod schemas with derived types
// Storage: ~/.anvil/plans/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase tracking info for plans with a ## Phases section.
 * Parsed from GitHub-style todo lists: - [ ] uncompleted, - [x] completed
 */
export const PhaseInfoSchema = z.object({
  completed: z.number(),
  total: z.number(),
});

export type PhaseInfo = z.infer<typeof PhaseInfoSchema>;

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
  isFolder: z.boolean().optional(),    // True if this plan has children (is a "folder" plan)
  isRead: z.boolean().default(false),
  markedUnreadAt: z.number().optional(), // Timestamp when marked unread (for navigation cooldown)
  stale: z.boolean().optional(),       // True if file was not found on last access
  lastVerified: z.number().optional(), // Timestamp of last successful file access
  createdAt: z.number(),               // Unix milliseconds
  updatedAt: z.number(),               // Unix milliseconds
  phaseInfo: PhaseInfoSchema.optional(), // Phase tracking - null/undefined means no ## Phases section
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
});

/** Plan metadata persisted to disk */
export type PlanMetadata = z.infer<typeof PlanMetadataSchema>;

/** Input for creating a new plan */
export interface CreatePlanInput {
  repoId: string;
  worktreeId: string;
  relativePath: string;
  parentId?: string;
  phaseInfo?: PhaseInfo;
}

/** Input for updating a plan */
export interface UpdatePlanInput {
  isRead?: boolean;
  parentId?: string;
  isFolder?: boolean;
  phaseInfo?: PhaseInfo;
  visualSettings?: z.infer<typeof VisualSettingsSchema>;
  relativePath?: string;
  worktreeId?: string;
  repoId?: string;
}
