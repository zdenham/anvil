import { z } from "zod";
import type { StatusDotVariant } from "@/components/ui/status-dot";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted State - Zod schema for disk validation
// Location: ~/.mort/ui/tree-menu.json
// ═══════════════════════════════════════════════════════════════════════════

export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
});
export type TreeMenuPersistedState = z.infer<typeof TreeMenuPersistedStateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Types - Plain TypeScript (not persisted, derived from entities)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Repo/worktree section - a single combined level in the tree.
 * Displayed as "repoName / worktreeName" with horizontal dividers.
 */
export interface RepoWorktreeSection {
  type: "repo-worktree";
  /** Unique identifier: "repoId:worktreeId" */
  id: string;
  /** Display name of the repository */
  repoName: string;
  /** Display name of the worktree (branch name or "main") */
  worktreeName: string;
  /** UUID of the repository */
  repoId: string;
  /** UUID of the worktree */
  worktreeId: string;
  /** Absolute path to the worktree directory */
  worktreePath: string;
  /** Child items (threads and plans) */
  items: TreeItemNode[];
  /** Whether this section is expanded */
  isExpanded: boolean;
}

/**
 * Individual tree item (thread or plan).
 */
export interface TreeItemNode {
  type: "thread" | "plan";
  /** UUID of the thread or plan */
  id: string;
  /** Display title (thread name or plan filename) */
  title: string;
  /** Status for the dot indicator */
  status: StatusDotVariant;
  /** Last update timestamp */
  updatedAt: number;
  /** Creation timestamp (for sorting) */
  createdAt: number;
  /** Parent section identifier */
  sectionId: string;
}

/**
 * Discriminated union for all tree node types.
 */
export type TreeNode = RepoWorktreeSection | TreeItemNode;
