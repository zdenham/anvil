import { z } from "zod";
import { VisualSettingsSchema } from "./visual-settings.js";

// ═══════════════════════════════════════════════════════════════════════════
// Folder Entity Types - Zod schemas with derived types
// Storage: ~/.anvil/folders/{id}/metadata.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for folder metadata persisted to disk.
 * Validated when loading from JSON files.
 */
export const FolderMetadataSchema = z.object({
  /** Stable ID: UUID */
  id: z.string().uuid(),
  /** User-visible folder name */
  name: z.string(),
  /** Lucide icon identifier (e.g., "folder", "bug", "zap") */
  icon: z.string(),
  /** Set when folder is inside a worktree (for boundary enforcement) */
  worktreeId: z.string().uuid().optional(),
  /** Visual tree placement and sort ordering */
  visualSettings: VisualSettingsSchema.optional(),
  /** Unix milliseconds */
  createdAt: z.number(),
  /** Unix milliseconds */
  updatedAt: z.number(),
});

/** Folder metadata persisted to disk */
export type FolderMetadata = z.infer<typeof FolderMetadataSchema>;

/** Input for creating a new folder (plain interface — internal code) */
export interface CreateFolderInput {
  name: string;
  icon?: string;           // defaults to "folder"
  worktreeId?: string;     // set when folder is inside a worktree
  parentId?: string;       // visual parent (sets visualSettings.parentId)
}
