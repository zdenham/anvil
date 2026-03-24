import { z } from "zod";
import { VisualSettingsSchema } from "./visual-settings.js";

/**
 * Persisted PR metadata -- the binding between a GitHub PR and an Anvil worktree.
 * Storage: ~/.anvil/pull-requests/{id}/metadata.json
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
  /** Visual settings for sidebar tree positioning */
  visualSettings: VisualSettingsSchema.optional(),
});

export type PullRequestMetadata = z.infer<typeof PullRequestMetadataSchema>;

/**
 * Ephemeral PR display data fetched from gh CLI.
 * NOT persisted -- refreshed on pane open, on gateway events, and on manual
 * refresh. No background polling (gateway SSE handles real-time updates).
 *
 * This is a plain TypeScript interface (not Zod) because it describes
 * internal code structure. The gh CLI JSON output is validated at the
 * parse boundary inside GhCli methods.
 */
export interface PullRequestDetails {
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: string;
  url: string;
  isDraft: boolean;
  labels: string[];
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** Latest reviews */
  reviews: Array<{
    author: string;
    state:
      | "APPROVED"
      | "CHANGES_REQUESTED"
      | "COMMENTED"
      | "DISMISSED"
      | "PENDING";
    body: string;
    submittedAt: string;
  }>;
  /**
   * CI check runs.
   * Status values match the gh pr checks --json output buckets.
   */
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "pending" | "skipping" | "cancelled";
    conclusion: string | null;
    url: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  /**
   * Review comments (inline), fetched via GraphQL to include resolution state.
   * Uses `gh api graphql` to query `reviewThreads` with `isResolved` field.
   * Unresolved comments display expanded in the UI, resolved comments display
   * collapsed. Rich comment rendering (markdown, thread replies) is future scope.
   */
  reviewComments: Array<{
    id: string;
    author: string;
    body: string;
    path: string;
    line: number | null;
    createdAt: string;
    url: string;
    /** Whether this comment thread is resolved */
    isResolved: boolean;
  }>;
}

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

export type CreatePullRequestInput = z.infer<
  typeof CreatePullRequestInputSchema
>;
