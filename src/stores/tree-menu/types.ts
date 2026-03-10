import { z } from "zod";
import type { StatusDotVariant } from "@/components/ui/status-dot";
import type { PhaseInfo } from "@/entities/plans/types";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted State - Zod schema for disk validation
// Location: ~/.mort/ui/tree-menu.json
// ═══════════════════════════════════════════════════════════════════════════

export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
  /** UUID of pinned worktree node, or null if none pinned */
  pinnedWorktreeId: z.string().nullable().optional(),
});
export type TreeMenuPersistedState = z.infer<typeof TreeMenuPersistedStateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Types - Plain TypeScript (not persisted, derived from entities)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every node in the sidebar tree — worktrees, folders, threads, plans,
 * terminals, PRs, and synthetic items (changes/uncommitted/commit).
 */
export interface TreeItemNode {
  type: TreeItemType;
  /** UUID of the entity (worktree ID for worktrees, nanoid for folders, etc.) */
  id: string;
  /** Display title */
  title: string;
  /** Status for the dot indicator */
  status: StatusDotVariant;
  /** Last update timestamp */
  updatedAt: number;
  /** Creation timestamp (for sorting) */
  createdAt: number;
  /** Indentation level (0 = root) */
  depth: number;
  /** Has children in the current tree build */
  isFolder: boolean;
  /** If folder, is it expanded? */
  isExpanded: boolean;
  /** Worktree UUID this node belongs to — set on all worktree-scoped items.
   *  Used for boundary enforcement in DnD (05a). Undefined for root-level folders. */
  worktreeId?: string;

  // ── Worktree-specific fields ──────────────────────────────────────────
  /** Display name of the repository (worktree nodes only) */
  repoName?: string;
  /** Display name of the worktree branch (worktree nodes only) */
  worktreeName?: string;
  /** Absolute path to the worktree directory (worktree nodes only) */
  worktreePath?: string;
  /** UUID of the repository (worktree nodes only) */
  repoId?: string;

  // ── Folder-specific fields ────────────────────────────────────────────
  /** Lucide icon name for folder nodes (e.g., "folder", "bug", "zap") */
  icon?: string;

  // ── Thread-specific fields ────────────────────────────────────────────
  /** Lexicographic sort key for ordering within parent (from visualSettings.sortKey) */
  sortKey?: string;

  /** Visual parent ID (from visualSettings.parentId — used by DnD, context menus) */
  parentId?: string;
  /** Sub-agent indicator — true if thread has a domain parentThreadId */
  isSubAgent?: boolean;
  /** Agent type (for threads only) — e.g., "Explore", "Plan", etc. */
  agentType?: string;

  // ── Plan-specific fields ──────────────────────────────────────────────
  /** Phase tracking info — only present for plans with ## Phases section */
  phaseInfo?: PhaseInfo;

  // ── Pull-request-specific fields ──────────────────────────────────────
  /** PR number for pull-request items */
  prNumber?: number;
  /** Whether the PR has been viewed by the user */
  isViewed?: boolean;
  /** Review status icon hint */
  reviewIcon?: "approved" | "changes-requested" | "review-required" | "draft" | "merged" | "closed";

  // ── Commit-specific fields ────────────────────────────────────────────
  /** Full commit hash (for "commit" type items) */
  commitHash?: string;
  /** First line of commit message (for "commit" type items) */
  commitMessage?: string;
  /** Author name (for "commit" type items) */
  commitAuthor?: string;
  /** Relative date string like "3 days ago" (for "commit" type items) */
  commitRelativeDate?: string;
}

/** All possible node types in the unified tree */
export type TreeItemType =
  | "repo"
  | "worktree"
  | "folder"
  | "thread"
  | "plan"
  | "terminal"
  | "pull-request"
  | "files"
  | "changes"
  | "uncommitted"
  | "commit";

/** Subset of item types backed by entity stores (used by onItemSelect callbacks) */
export type EntityItemType = "thread" | "plan" | "terminal" | "pull-request";
