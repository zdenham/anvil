import { z } from "zod";
/**
 * Persisted PR metadata -- the binding between a GitHub PR and a Mort worktree.
 * Storage: ~/.mort/pull-requests/{id}/metadata.json
 *
 * This is intentionally lightweight. The gh CLI is the source of truth for all
 * display data (title, description, checks, reviews). We only persist the fields
 * needed to:
 *   1. Bind a PR to a worktree
 *   2. Track auto-address state
 *   3. Run gh CLI queries (repoSlug, prNumber)
 *
 * Auto-address fields live here (not on the gateway channel entity) because
 * the gateway channel is concerned only with event lifecycle (connection,
 * webhook, routing). The PR entity listener checks pr.autoAddressEnabled
 * when events arrive -- no channel-level PR tracking needed.
 */
export const PullRequestMetadataSchema = z.object({
    /** Stable ID: UUID */
    id: z.string().uuid(),
    /** GitHub PR number (e.g. 42) -- stable identifier within a repo */
    prNumber: z.number().int().positive(),
    /** Repository entity ID */
    repoId: z.string().uuid(),
    /** Worktree entity ID -- the worktree whose branch this PR is for */
    worktreeId: z.string().uuid(),
    /** Full repo slug "owner/repo" for gh CLI commands */
    repoSlug: z.string(),
    /** Branch name the PR is from (head branch) */
    headBranch: z.string(),
    /** Branch name the PR targets (base branch) */
    baseBranch: z.string(),
    /** Whether auto-address is enabled for this PR */
    autoAddressEnabled: z.boolean().default(false),
    /**
     * Gateway channel ID when auto-address is active, null otherwise.
     * This references the repo-level gateway channel (one webhook per repo,
     * shared across all PRs in that repo). The channel is created during repo
     * setup and is always active -- this field tracks which channel to use
     * for filtering events for this PR.
     */
    gatewayChannelId: z.string().uuid().nullable().default(null),
    /** Whether this PR has been viewed by the user (for blue icon indicator) */
    isViewed: z.boolean().default(true),
    /** Unix epoch milliseconds */
    createdAt: z.number(),
    /** Unix epoch milliseconds */
    updatedAt: z.number(),
});
/**
 * Input for creating a PR entity (after gh pr create or webhook detection).
 * Validated with Zod because it crosses a trust boundary (could originate
 * from parsed shell output or webhook event data).
 */
export const CreatePullRequestInputSchema = z.object({
    prNumber: z.number().int().positive(),
    repoId: z.string().uuid(),
    worktreeId: z.string().uuid(),
    repoSlug: z.string(),
    headBranch: z.string(),
    baseBranch: z.string(),
});
