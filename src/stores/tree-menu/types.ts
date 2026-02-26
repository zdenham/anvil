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
  /** ID of pinned section ("repoId:worktreeId") or null if none pinned */
  pinnedSectionId: z.string().nullable().optional(),
  /** Array of hidden section IDs ("repoId:worktreeId") */
  hiddenSectionIds: z.array(z.string()).optional(),
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
  /** Synthetic "Changes" folder items (changes parent + uncommitted + commits) */
  changesItems: TreeItemNode[];
}

/**
 * Individual tree item (thread, plan, terminal, or pull request).
 */
export interface TreeItemNode {
  type: "thread" | "plan" | "terminal" | "pull-request" | "changes" | "uncommitted" | "commit";
  /** UUID of the thread, plan, terminal, or pull request */
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
  /** Indentation level (0 = root) - for nested plans and sub-agent threads */
  depth: number;
  /** Has children - for nested plans and threads with sub-agents */
  isFolder: boolean;
  /** If folder, is it expanded? */
  isExpanded: boolean;
  /** Parent plan ID - for nested plans */
  parentId?: string;
  /** Phase tracking info - only present for plans with ## Phases section */
  phaseInfo?: PhaseInfo;
  /** Sub-agent indicator (for threads only) - true if thread has a parent */
  isSubAgent?: boolean;
  /** Agent type (for threads only) - e.g., "Explore", "Plan", etc. */
  agentType?: string;
  /** PR number for pull-request items */
  prNumber?: number;
  /** Whether the PR has been viewed by the user (for new-PR indicator) */
  isViewed?: boolean;
  /** Review status icon hint for pull-request items */
  reviewIcon?: "approved" | "changes-requested" | "review-required" | "draft" | "merged" | "closed";
  /** Full commit hash (for "commit" type items) */
  commitHash?: string;
  /** First line of commit message (for "commit" type items) */
  commitMessage?: string;
  /** Author name (for "commit" type items) */
  commitAuthor?: string;
  /** Relative date string like "3 days ago" (for "commit" type items) */
  commitRelativeDate?: string;
}

/** Convenience alias for the TreeItemNode.type union */
export type TreeItemType = TreeItemNode["type"];

/** Subset of item types backed by entity stores (used by onItemSelect callbacks) */
export type EntityItemType = "thread" | "plan" | "terminal" | "pull-request";

/**
 * Discriminated union for all tree node types.
 * Covers repo/worktree sections and individual items (threads, plans, terminals, pull requests).
 */
export type TreeNode = RepoWorktreeSection | TreeItemNode;
