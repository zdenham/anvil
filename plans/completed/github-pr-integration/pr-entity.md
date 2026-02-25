# A: PR Entity & Data Model

Defines the pull request data model, entity service, Zustand store, gh CLI client, and event listeners. The PR entity is a lightweight binding between a GitHub PR and a Mort worktree. All GitHub data is fetched on-demand via the `gh` CLI (the user's existing credentials handle auth -- no OAuth, no tokens). The `gh` CLI is the source of truth for display data; we persist only the minimal metadata needed to maintain the binding.

## Phases

- [x] Define PR types in core/types
- [x] Implement GhCli typed client
- [x] Implement PR entity service (disk persistence)
- [x] Implement PR Zustand store
- [x] Implement PR event listeners

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: PR Types (`core/types/pull-request.ts`)

### Data Model

The PR entity stores minimal binding metadata. Display data is fetched on-demand via `gh` CLI and cached ephemerally in the Zustand store (never persisted to disk). The entity key within the system is a UUID (`id`), but the stable identifier for deduplication within a repo is `{repoId}:{prNumber}` -- PR number is the stable GitHub-side identifier.

```typescript
// core/types/pull-request.ts
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
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
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

export type CreatePullRequestInput = z.infer<typeof CreatePullRequestInputSchema>;
```

### PR Lifecycle

A PR entity transitions through the following states:

1. **Created** -- via webhook detection (`pull_request.opened` event through the gateway) or via the "Create pull request" plus menu action. When created via webhook detection, the PR appears silently in the side panel with a blue `GitPullRequest` icon (content pane is NOT force-opened to avoid interrupting the user). The icon reverts to grey after the user views it. The `isViewed` field on metadata tracks this.

2. **Active** -- display data refreshes on content pane open, on gateway events, and on manual refresh button click. No background polling. Gateway events always update the cached `PullRequestDetails` in the store for all PRs (not just auto-addressed ones) so the side panel status dots and content pane stay current. Agent spawning only happens when `autoAddressEnabled` is true.

3. **Closed/Merged** -- when a PR is closed or merged:
   - State updates via `pull_request.closed` webhook event or `gh` CLI refresh
   - `PullRequestDetails.state` updates to `"CLOSED"` or `"MERGED"` -- side panel status dot reflects this immediately
   - Auto-address is automatically disabled (`autoAddressEnabled` set to false, removed from active tracking). No new agents will spawn, but any running auto-address threads continue to completion.
   - The PR remains visible in the side panel until **archived** (same pattern as threads)

4. **Archived** -- archive triggers:
   - **User archives the PR** -- right-click -> "Archive" in side panel, or archive button in content pane
   - **User archives the worktree** -- all PRs bound to that worktree are archived with it
   - Archived PRs move to the archive view (same as archived threads)
   - Auto-address is disabled on archive if still active
   - Running auto-address threads continue to completion -- archiving does not stop in-progress work

### Deduplication

Before creating a PR entity, always check `getByRepoAndNumber(repoId, prNumber)`. If a PR entity already exists for this repo + PR number, return the existing one. This makes creation idempotent and prevents duplicates when both webhook detection and manual creation happen for the same PR.

Each worktree can have at most one active PR (the branch's PR). The "Create pull request" button always says "Create pull request" -- if a PR already exists for the branch, clicking it opens the existing PR. Multi-PR per worktree is out of scope.

### Storage Location

```
~/.mort/pull-requests/{id}/
  metadata.json    <- PullRequestMetadata (Zod-validated on load)

~/.mort/archive/pull-requests/{id}/
  metadata.json    <- Archived PR metadata
```

Following the established entity pattern: disk as truth, Zod at boundaries. The `id` directory name is a UUID (same convention as threads).

---

## Phase 2: GhCli Typed Client (`src/lib/gh-cli.ts`)

A proper typed client around `gh` CLI commands -- not a thin shell wrapper. Each method constructs the appropriate command, executes it, parses the raw JSON output into strongly-typed return values, handles errors with descriptive error types, and parallelizes independent sub-queries where possible.

The `cwd` is set to a path within the repo so `{owner}/{repo}` resolves automatically from git context. For webhook and repo-level API operations (webhook CRUD, repo queries), **always use the repo root path** -- GitHub has no concept of local worktrees. For PR-specific queries (`gh pr view`, `gh pr checks`), any worktree path works since they share the same remote.

### Class Design

```typescript
// src/lib/gh-cli.ts

import type { PullRequestDetails } from "@core/types/pull-request.js";

/**
 * Error types for gh CLI operations.
 * Each method throws one of these rather than raw stderr strings.
 */
export class GhCliNotInstalledError extends Error {
  readonly kind = "not-installed" as const;
}

export class GhCliNotAuthenticatedError extends Error {
  readonly kind = "not-authenticated" as const;
}

export class GhCliNotGitHubRepoError extends Error {
  readonly kind = "not-github-repo" as const;
}

export class GhCliApiError extends Error {
  readonly kind = "api-error" as const;
  constructor(message: string, readonly statusCode?: number) {
    super(message);
  }
}

export type GhCliError =
  | GhCliNotInstalledError
  | GhCliNotAuthenticatedError
  | GhCliNotGitHubRepoError
  | GhCliApiError;

/**
 * Typed client for GitHub CLI operations.
 *
 * Each method:
 * - Constructs the appropriate gh CLI command
 * - Executes via the existing shell infrastructure (Tauri command or Node child_process)
 * - Parses raw JSON output into strongly-typed return values (Zod at boundary)
 * - Handles errors with descriptive GhCliError types
 * - Parallelizes independent sub-queries where possible
 *
 * Constructor takes `cwd` -- a path within the repo so {owner}/{repo} resolves
 * from git context. For webhook/API operations, always pass the repo root path.
 * For PR-specific queries, any worktree path works.
 */
export class GhCli {
  constructor(private cwd: string) {}

  /**
   * Check if gh CLI is available and authenticated.
   * Used at startup to determine if PR features should be enabled.
   */
  async isAvailable(): Promise<boolean>

  /**
   * Get the current branch's PR number, or null if no PR exists.
   * Implementation: gh pr view --json number --jq '.number' 2>/dev/null
   */
  async getCurrentBranchPr(): Promise<number | null>

  /**
   * Fetch full PR details by number.
   *
   * Runs 3 commands concurrently via Promise.all:
   *   1. gh pr view {prNumber} --json title,body,state,author,url,isDraft,labels,reviewDecision,reviews
   *   2. gh pr checks {prNumber} --json name,state,bucket,link,startedAt,completedAt
   *   3. gh api graphql (reviewThreads with isResolved -- see getPrComments)
   *
   * Returns a fully-populated PullRequestDetails object.
   */
  async getPrDetails(prNumber: number): Promise<PullRequestDetails>

  /**
   * Fetch just CI checks for a PR.
   * Implementation: gh pr checks {prNumber} --json name,state,bucket,link,startedAt,completedAt
   */
  async getPrChecks(prNumber: number): Promise<PullRequestDetails["checks"]>

  /**
   * Fetch review comments with resolution state via GraphQL.
   * Uses gh api graphql because the REST API does not expose isResolved on review threads.
   *
   * Implementation:
   *   gh api graphql -f query='{ repository(owner:"...", name:"...") {
   *     pullRequest(number: N) { reviewThreads(first: 100) { nodes {
   *       isResolved, comments(first: 10) { nodes {
   *         id, author { login }, body, path, line, createdAt, url
   *       } }
   *     } } } } }'
   */
  async getPrComments(prNumber: number): Promise<PullRequestDetails["reviewComments"]>

  /**
   * Get repo slug (owner/repo) from git remote.
   * Implementation: gh repo view --json nameWithOwner --jq '.nameWithOwner'
   */
  async getRepoSlug(): Promise<string>

  /**
   * Create a webhook for this repository via the GitHub API.
   * Implementation: gh api repos/{owner}/{repo}/hooks --method POST
   *
   * One webhook per repo, shared across all PRs. The webhook URL uses the
   * gateway channel system. Webhooks are created during repo setup (hydration
   * or initial add) and run idempotently -- ensureGatewayChannelForRepo is
   * called for every repo during entity hydration, not just on first creation.
   *
   * Events to subscribe: pull_request, issue_comment, check_run, check_suite,
   * pull_request_review, pull_request_review_comment
   */
  async createWebhook(webhookUrl: string, secret: string): Promise<{ id: number }>

  /**
   * Delete a webhook for this repository.
   * Implementation: gh api repos/{owner}/{repo}/hooks/{hookId} --method DELETE
   */
  async deleteWebhook(hookId: number): Promise<void>

  /**
   * List existing webhooks to check if one already exists for our gateway.
   * Implementation: gh api repos/{owner}/{repo}/hooks
   */
  async listWebhooks(): Promise<Array<{ id: number; config: { url: string } }>>
}
```

### Worktree Branch Lookup

When a `pull_request.opened` webhook event arrives, we need to find which worktree corresponds to the PR's head branch. The worktree entity already stores `currentBranch` (see `WorktreeStateSchema` in `core/types/repositories.ts`), so the lookup can be done in-memory from the repository store without shelling out to git.

```typescript
/**
 * Find the worktree entity for a given branch name within a repository.
 * Uses the in-memory worktree data from the repository store (currentBranch field).
 *
 * Falls back to `git worktree list --porcelain` if currentBranch is stale/null,
 * parsing output for "worktree <path>" + "branch refs/heads/<name>" pairs.
 *
 * @returns The worktree entity matching the branch, or null if not found.
 */
function findWorktreeByBranch(
  repoId: string,
  branchName: string,
): WorktreeState | null
```

The `currentBranch` field on `WorktreeState` already exists and is populated by `worktree_sync`. This avoids needing a new Tauri command or repeated shell-outs. Place this helper in `src/entities/pull-requests/utils.ts` (created as part of this plan).

### Shell Execution

The `GhCli` class executes commands via the existing shell infrastructure:
- In the Tauri frontend: via `Command.create` from `@tauri-apps/plugin-shell`
- In the Node agent process: via `child_process`

This follows existing patterns: `Command.create("gh", args, { cwd })` on the frontend (requires adding `"gh"` to `shell:allow-execute` and `shell:allow-spawn` in `src-tauri/capabilities/default.json`), and `execFileSync("gh", args, { cwd })` in Node agent processes. Each method:
- Constructs the CLI command as an array of arguments
- Executes with `cwd` set to the appropriate repo path
- Parses stdout JSON with Zod schemas at the boundary
- Converts stderr to descriptive `GhCliError` types
- Uses early return/throw for error cases (no nested if blocks)

### Error Handling

Each error case has a specific user-facing response:

| Condition | Error Type | UI Response | Retry Behavior |
|-----------|-----------|-------------|----------------|
| `gh` not installed | `GhCliNotInstalledError` | Error banner with "Install GitHub CLI" button (runs `brew install gh`) | Gateway channel creation skipped for this repo, retried on next app launch or "Retry" button |
| Not authenticated | `GhCliNotAuthenticatedError` | Error banner with "Authenticate" button (opens `gh auth login` in terminal) | Same retry behavior |
| No remote / not GitHub | `GhCliNotGitHubRepoError` | PR features hidden silently for that worktree | No retry needed |
| API rate limiting | `GhCliApiError` (429) | Warning toast | Retry with exponential backoff |
| Webhook creation fails | `GhCliApiError` | Error with details in Settings | Gateway channel created server-side but webhook not installed; user can retry |

The `isAvailable()` check runs at startup. If it fails, all PR features are disabled and an error banner is shown with an action button.

### File Size Consideration

The `GhCli` class will likely approach the 250-line limit. The class should be split into focused modules if it exceeds that:
- `src/lib/gh-cli/client.ts` -- core class with isAvailable, getRepoSlug
- `src/lib/gh-cli/pr-queries.ts` -- PR detail/check/comment fetchers
- `src/lib/gh-cli/webhooks.ts` -- webhook CRUD
- `src/lib/gh-cli/index.ts` -- re-exports

---

## Phase 3: PR Entity Service (`src/entities/pull-requests/service.ts`)

Follows the established entity pattern (see threads, plans, terminal-sessions). The service is the only writer to the PR store. All disk I/O uses `appData` from `@/lib/app-data-store`. Optimistic updates use the `optimistic()` helper for responsive UI with automatic rollback on disk failure.

```typescript
// src/entities/pull-requests/service.ts

import { optimistic } from "@/lib/optimistic";
import { appData } from "@/lib/app-data-store";
import { usePullRequestStore } from "./store";
import { logger } from "@/lib/logger-client";
import {
  PullRequestMetadataSchema,
  type PullRequestMetadata,
  type PullRequestDetails,
  type CreatePullRequestInput,
} from "./types";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { GhCli } from "@/lib/gh-cli";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

const PR_DIR = "pull-requests";
const ARCHIVE_PR_DIR = "archive/pull-requests";

export const pullRequestService = {
  /**
   * Load all PR metadata from disk into store.
   * Called once at app initialization during entity hydration.
   */
  async hydrate(): Promise<void> {
    const prs: Record<string, PullRequestMetadata> = {};
    const pattern = `${PR_DIR}/*/metadata.json`;
    const files = await appData.glob(pattern);

    await Promise.all(
      files.map(async (filePath) => {
        const raw = await appData.readJson(filePath);
        const result = raw ? PullRequestMetadataSchema.safeParse(raw) : null;
        if (result?.success) {
          prs[result.data.id] = result.data;
        }
      })
    );

    usePullRequestStore.getState().hydrate(prs);
  },

  /**
   * Create a new PR entity.
   * Deduplicates by repoId + prNumber -- if a PR entity already exists
   * for this repo + number, returns the existing one (idempotent).
   *
   * For webhook-detected PRs, sets isViewed=false so the side panel shows
   * a blue icon until the user views it.
   */
  async create(
    input: CreatePullRequestInput,
    options?: { isViewed?: boolean },
  ): Promise<PullRequestMetadata> {
    // Dedup check: return existing entity if same repo + PR number
    const existing = this.getByRepoAndNumber(input.repoId, input.prNumber);
    if (existing) return existing;

    const now = Date.now();
    const metadata: PullRequestMetadata = {
      id: crypto.randomUUID(),
      prNumber: input.prNumber,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      repoSlug: input.repoSlug,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      autoAddressEnabled: false,
      gatewayChannelId: null,
      isViewed: options?.isViewed ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const prPath = `${PR_DIR}/${metadata.id}`;

    await optimistic(
      metadata,
      (pr) => usePullRequestStore.getState()._applyCreate(pr),
      async (pr) => {
        await appData.ensureDir(prPath);
        await appData.writeJson(`${prPath}/metadata.json`, pr);
      }
    );

    eventBus.emit(EventName.PR_CREATED, {
      prId: metadata.id,
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
    });

    return metadata;
  },

  /** Get PR by ID from the store */
  get(id: string): PullRequestMetadata | undefined {
    return usePullRequestStore.getState().pullRequests[id];
  },

  /** Get PR by repo + PR number (for dedup on detection) */
  getByRepoAndNumber(
    repoId: string,
    prNumber: number,
  ): PullRequestMetadata | undefined {
    return usePullRequestStore.getState()
      .getPrByRepoAndNumber(repoId, prNumber);
  },

  /** Get all PRs for a worktree */
  getByWorktree(worktreeId: string): PullRequestMetadata[] {
    return usePullRequestStore.getState().getPrsByWorktree(worktreeId);
  },

  /**
   * Update PR metadata.
   * Uses read-modify-write pattern to preserve fields written by
   * other processes (following disk-as-truth pattern).
   */
  async update(
    id: string,
    updates: Partial<Pick<PullRequestMetadata,
      | "worktreeId"
      | "autoAddressEnabled"
      | "gatewayChannelId"
      | "isViewed"
    >>,
  ): Promise<PullRequestMetadata> {
    const existing = usePullRequestStore.getState().pullRequests[id];
    if (!existing) throw new Error(`PR not found: ${id}`);

    const updated: PullRequestMetadata = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const prPath = `${PR_DIR}/${id}`;

    await optimistic(
      updated,
      (pr) => usePullRequestStore.getState()._applyUpdate(id, pr),
      async (pr) => {
        const metadataPath = `${prPath}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
        const diskResult = raw
          ? PullRequestMetadataSchema.safeParse(raw)
          : null;
        const diskState = diskResult?.success ? diskResult.data : null;
        const merged = diskState
          ? { ...diskState, ...pr, updatedAt: Date.now() }
          : pr;
        await appData.writeJson(metadataPath, merged);
      }
    );

    eventBus.emit(EventName.PR_UPDATED, { prId: id });

    return updated;
  },

  /**
   * Refresh a single PR entity from disk.
   * Called by event listeners when events arrive (disk-as-truth pattern).
   */
  async refreshById(id: string): Promise<void> {
    const metadataPath = `${PR_DIR}/${id}/metadata.json`;
    const raw = await appData.readJson(metadataPath);
    const result = raw ? PullRequestMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      usePullRequestStore.getState()._applyUpdate(id, result.data);
    } else {
      const existing = usePullRequestStore.getState().pullRequests[id];
      if (existing) {
        usePullRequestStore.getState()._applyDelete(id);
      }
    }
  },

  /**
   * Disable auto-address for a PR.
   * Called when a PR is closed/merged or archived.
   * Updates metadata and clears the gatewayChannelId.
   */
  async disableAutoAddress(id: string): Promise<void> {
    await this.update(id, {
      autoAddressEnabled: false,
      gatewayChannelId: null,
    });
  },

  /**
   * Enable auto-address for a PR.
   * Sets autoAddressEnabled=true and stores the gateway channel ID.
   * The gateway channel already exists for the repo (created during setup).
   * This toggle controls agent spawning, not event reception.
   */
  async enableAutoAddress(
    id: string,
    gatewayChannelId: string,
  ): Promise<void> {
    await this.update(id, {
      autoAddressEnabled: true,
      gatewayChannelId,
    });
  },

  /**
   * Archive a PR entity.
   * Moves to archive directory, disables auto-address if active.
   * Running auto-address threads continue to completion --
   * archiving does not interrupt in-progress work.
   */
  async archive(id: string): Promise<void> {
    const pr = usePullRequestStore.getState().pullRequests[id];
    if (!pr) return;

    const sourcePath = `${PR_DIR}/${id}`;
    const archivePath = `${ARCHIVE_PR_DIR}/${id}`;

    const rollback = usePullRequestStore.getState()._applyDelete(id);
    try {
      const metadata = await appData.readJson(`${sourcePath}/metadata.json`);
      await appData.ensureDir(archivePath);
      if (metadata) {
        // Disable auto-address in the archived copy
        const archived = {
          ...(metadata as PullRequestMetadata),
          autoAddressEnabled: false,
          gatewayChannelId: null,
        };
        await appData.writeJson(`${archivePath}/metadata.json`, archived);
      }
      await appData.removeDir(sourcePath);

      logger.info(`[pullRequestService.archive] Archived PR ${id}`);
      eventBus.emit(EventName.PR_ARCHIVED, { prId: id });
    } catch (error) {
      rollback();
      throw error;
    }
  },

  /**
   * Archive all PRs for a worktree.
   * Called when the parent worktree is archived.
   */
  async archiveByWorktree(worktreeId: string): Promise<void> {
    const prs = this.getByWorktree(worktreeId);
    for (const pr of prs) {
      await this.archive(pr.id);
    }
  },

  /**
   * Delete a PR entity permanently (from archive).
   */
  async delete(id: string): Promise<void> {
    const rollback = usePullRequestStore.getState()._applyDelete(id);
    try {
      // Try both active and archive locations
      const activePath = `${PR_DIR}/${id}`;
      const archivePath = `${ARCHIVE_PR_DIR}/${id}`;
      await appData.removeDir(activePath);
      await appData.removeDir(archivePath);
    } catch (error) {
      rollback();
      throw error;
    }
  },

  /**
   * Fetch and cache PullRequestDetails for a PR.
   * Called when the content pane opens, on gateway events, or on manual refresh.
   *
   * For gateway events, this is called for ALL PRs (not just auto-addressed ones)
   * so the side panel status dots stay current.
   */
  async fetchDetails(id: string): Promise<PullRequestDetails | null> {
    const pr = this.get(id);
    if (!pr) return null;

    const store = usePullRequestStore.getState();
    store.setPrDetailsLoading(id, true);

    try {
      // Use any worktree path -- PR queries work from any worktree
      // since they share the same remote
      const worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(pr.repoId, pr.worktreeId);
      if (!worktreePath) {
        logger.warn(`[pullRequestService.fetchDetails] No worktree path for PR ${id}`);
        return null;
      }
      const ghCli = new GhCli(worktreePath);
      const details = await ghCli.getPrDetails(pr.prNumber);

      store.setPrDetails(id, details);
      return details;
    } catch (error) {
      logger.error(
        `[pullRequestService.fetchDetails] Failed for PR ${id}:`,
        error,
      );
      return null;
    } finally {
      store.setPrDetailsLoading(id, false);
    }
  },

  /**
   * List all archived PRs.
   */
  async listArchived(): Promise<PullRequestMetadata[]> {
    const pattern = `${ARCHIVE_PR_DIR}/*/metadata.json`;
    const files = await appData.glob(pattern);
    const prs: PullRequestMetadata[] = [];

    for (const filePath of files) {
      const raw = await appData.readJson(filePath);
      const result = raw ? PullRequestMetadataSchema.safeParse(raw) : null;
      if (result?.success) {
        prs.push(result.data);
      }
    }

    return prs;
  },
};
```

### Disk Operations Summary

| Operation | Path | Pattern |
|-----------|------|---------|
| Create | `~/.mort/pull-requests/{id}/metadata.json` | Generate UUID, write JSON |
| Read | Same | Parse with `PullRequestMetadataSchema.safeParse()` at load |
| Update | Same | Read-modify-write with optimistic store update |
| Archive | Move to `~/.mort/archive/pull-requests/{id}/` | Copy metadata, remove original |
| Delete | Remove directory | From either active or archive location |

---

## Phase 4: PR Zustand Store (`src/entities/pull-requests/store.ts`)

Single Zustand store for all PR entities. Follows the entity store pattern: entities keyed by unique ID, `_apply*` methods returning rollback functions for optimistic updates, cached array to prevent `Object.values()` in hot paths.

```typescript
// src/entities/pull-requests/store.ts

import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { PullRequestMetadata, PullRequestDetails } from "./types";
import { logger } from "@/lib/logger-client";

interface PullRequestStoreState {
  /** All PR metadata keyed by UUID (single copy per entity) */
  pullRequests: Record<string, PullRequestMetadata>;
  /** Cached array of all PRs (avoids Object.values() in selectors) */
  _prsArray: PullRequestMetadata[];
  /** Cached display data, keyed by PR entity ID. Ephemeral, never persisted. */
  prDetails: Record<string, PullRequestDetails>;
  /** Loading state per PR (for skeleton display on first load) */
  prDetailsLoading: Record<string, boolean>;
  _hydrated: boolean;
}

interface PullRequestStoreActions {
  /** Hydration (called once at app start) */
  hydrate(prs: Record<string, PullRequestMetadata>): void;

  /** Selectors */
  getPr(id: string): PullRequestMetadata | undefined;
  getPrByRepoAndNumber(
    repoId: string,
    prNumber: number,
  ): PullRequestMetadata | undefined;
  getPrsByWorktree(worktreeId: string): PullRequestMetadata[];
  getPrsByRepo(repoId: string): PullRequestMetadata[];
  getPrDetails(id: string): PullRequestDetails | undefined;

  /** Optimistic apply methods -- return rollback for use with optimistic() */
  _applyCreate(pr: PullRequestMetadata): Rollback;
  _applyUpdate(id: string, pr: PullRequestMetadata): Rollback;
  _applyDelete(id: string): Rollback;

  /** Display data cache management */
  setPrDetails(id: string, details: PullRequestDetails): void;
  setPrDetailsLoading(id: string, loading: boolean): void;
  clearPrDetails(id: string): void;
}

export const usePullRequestStore = create<
  PullRequestStoreState & PullRequestStoreActions
>((set, get) => ({
  // State
  pullRequests: {},
  _prsArray: [],
  prDetails: {},
  prDetailsLoading: {},
  _hydrated: false,

  // Hydration
  hydrate: (prs) => {
    set({
      pullRequests: prs,
      _prsArray: Object.values(prs),
      _hydrated: true,
    });
  },

  // Selectors
  getPr: (id) => get().pullRequests[id],

  getPrByRepoAndNumber: (repoId, prNumber) =>
    get()._prsArray.find(
      (pr) => pr.repoId === repoId && pr.prNumber === prNumber,
    ),

  getPrsByWorktree: (worktreeId) =>
    get()._prsArray.filter((pr) => pr.worktreeId === worktreeId),

  getPrsByRepo: (repoId) =>
    get()._prsArray.filter((pr) => pr.repoId === repoId),

  getPrDetails: (id) => get().prDetails[id],

  // Optimistic apply methods
  _applyCreate: (pr: PullRequestMetadata): Rollback => {
    set((state) => {
      const newPrs = { ...state.pullRequests, [pr.id]: pr };
      return {
        pullRequests: newPrs,
        _prsArray: Object.values(newPrs),
      };
    });
    return () =>
      set((state) => {
        const { [pr.id]: _, ...rest } = state.pullRequests;
        return {
          pullRequests: rest,
          _prsArray: Object.values(rest),
        };
      });
  },

  _applyUpdate: (id: string, pr: PullRequestMetadata): Rollback => {
    const prev = get().pullRequests[id];
    set((state) => {
      const newPrs = { ...state.pullRequests, [id]: pr };
      return {
        pullRequests: newPrs,
        _prsArray: Object.values(newPrs),
      };
    });
    return () =>
      set((state) => {
        const restored = prev
          ? { ...state.pullRequests, [id]: prev }
          : state.pullRequests;
        return {
          pullRequests: restored,
          _prsArray: Object.values(restored),
        };
      });
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().pullRequests[id];
    const prevDetails = get().prDetails[id];
    const prevLoading = get().prDetailsLoading[id];
    set((state) => {
      const { [id]: _, ...rest } = state.pullRequests;
      const { [id]: __, ...restDetails } = state.prDetails;
      const { [id]: ___, ...restLoading } = state.prDetailsLoading;
      return {
        pullRequests: rest,
        _prsArray: Object.values(rest),
        prDetails: restDetails,
        prDetailsLoading: restLoading,
      };
    });
    return () =>
      set((state) => {
        const restored = prev
          ? { ...state.pullRequests, [id]: prev }
          : state.pullRequests;
        const restoredDetails = prevDetails
          ? { ...state.prDetails, [id]: prevDetails }
          : state.prDetails;
        const restoredLoading = prevLoading !== undefined
          ? { ...state.prDetailsLoading, [id]: prevLoading }
          : state.prDetailsLoading;
        return {
          pullRequests: restored,
          _prsArray: Object.values(restored),
          prDetails: restoredDetails,
          prDetailsLoading: restoredLoading,
        };
      });
  },

  // Display data management
  setPrDetails: (id, details) => {
    set((state) => ({
      prDetails: { ...state.prDetails, [id]: details },
    }));
  },

  setPrDetailsLoading: (id, loading) => {
    set((state) => ({
      prDetailsLoading: { ...state.prDetailsLoading, [id]: loading },
    }));
  },

  clearPrDetails: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.prDetails;
      return { prDetails: rest };
    });
  },
}));
```

### Display Data Cache Behavior

`PullRequestDetails` is ephemeral -- fetched from `gh` CLI and held in the store only. Refresh triggers:

| Trigger | What Refreshes |
|---------|---------------|
| Content pane opens | Full `getPrDetails` (3 parallel gh CLI calls) |
| Gateway event for this PR | Full `getPrDetails` refresh so side panel and content pane stay current |
| Manual refresh button | Full `getPrDetails` |
| App launch | Nothing -- details load on first pane open |

A loading skeleton displays briefly when `prDetailsLoading[id]` is true. This only happens on first load of a PR's details (stale-while-revalidate for subsequent refreshes).

---

## Phase 5: PR Event Listeners (`src/entities/pull-requests/listeners.ts`)

Listeners bridge gateway events and internal events to store updates via the service. Follows the established `listeners.ts` pattern.

```typescript
// src/entities/pull-requests/listeners.ts

import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Set up PR entity event listeners.
 * Called once at app startup via src/entities/index.ts.
 */
export function setupPullRequestListeners(): void {
  // Internal PR events (from service operations in other windows)
  eventBus.on(EventName.PR_CREATED, async ({ prId }) => {
    await pullRequestService.refreshById(prId);
  });

  eventBus.on(EventName.PR_UPDATED, async ({ prId }) => {
    await pullRequestService.refreshById(prId);
  });

  eventBus.on(EventName.PR_ARCHIVED, async ({ prId }) => {
    usePullRequestStore.getState()._applyDelete(prId);
  });

  // When a worktree is archived, archive all its PRs
  eventBus.on(EventName.WORKTREE_ARCHIVED, async ({ worktreeId }) => {
    await pullRequestService.archiveByWorktree(worktreeId);
  });
}
```

### Gateway Event Handler

The gateway event handler is separate from the entity listeners above. It receives `GITHUB_WEBHOOK_EVENT` events forwarded by the gateway channel listeners (D1), processes them for the PR entity. The actual event subscription will be added in `listeners.ts` by D2, which calls into this handler. It has two stages:

1. **Always**: Refresh cached `PullRequestDetails` in the store for the affected PR, so the side panel status dots and content pane stay current. This happens for ALL PRs, regardless of auto-address state.

2. **Conditionally**: If `autoAddressEnabled` is true on the PR, spawn an agent to address the event. This is the only point where auto-address state is checked.

```typescript
// src/entities/pull-requests/gateway-handler.ts

import type { GatewayEvent } from "@core/types/gateway-events.js";
import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { logger } from "@/lib/logger-client";

/**
 * Handle a gateway event that may relate to a PR.
 *
 * Event classification and filtering:
 * - pull_request.opened: Create PR entity if not exists, refresh details
 * - pull_request.closed: Refresh details, auto-disable auto-address
 * - pull_request.synchronize: Refresh details
 * - issue_comment: Refresh details, conditionally spawn agent
 * - pull_request_review: Refresh details, conditionally spawn agent
 * - pull_request_review_comment: Refresh details, conditionally spawn agent
 * - check_run / check_suite: Only process when conclusion is "failure" or
 *   "timed_out" (passing checks silently ignored). Refresh details,
 *   conditionally spawn CI fix agent.
 *
 * Empty check_run.pull_requests array is acceptable for v1 -- fork PRs and
 * some CI configs deliver check_run events without PR associations. These
 * are silently dropped (extractPrNumber returns null).
 */
export async function handlePrGatewayEvent(event: GatewayEvent): Promise<void> {
  const prNumber = extractPrNumber(event);
  if (prNumber === null) return;

  const repoId = resolveRepoIdFromChannel(event.channelId);
  if (!repoId) return;

  // Stage 1: Always refresh display data for the affected PR
  const pr = usePullRequestStore.getState()
    .getPrByRepoAndNumber(repoId, prNumber);
  if (pr) {
    await pullRequestService.fetchDetails(pr.id);
  }

  // Handle PR closed/merged: auto-disable auto-address
  if (event.type === "github.pull_request" && isPrClosedEvent(event)) {
    if (pr?.autoAddressEnabled) {
      await pullRequestService.disableAutoAddress(pr.id);
    }
    return;
  }

  // Stage 2: Conditionally spawn agent if auto-address is enabled
  if (!pr?.autoAddressEnabled) return;

  // Event-specific agent spawning (implemented in pr-auto-address sub-plan)
  // - issue_comment: Agent uses discretion (many are conversational, e.g. "LGTM")
  // - check_run with failure: Verify conclusion is "failure" or "timed_out"
  // - pull_request_review: Spawn address-pr-comment agent
}

/**
 * Extract PR number from a gateway event payload.
 * Returns null if the event doesn't contain a PR number (e.g., check_run
 * events from fork PRs with empty pull_requests array).
 */
function extractPrNumber(event: GatewayEvent): number | null {
  // Implementation varies by event type -- inspect payload structure
}
```

### New Event Names

The following event names need to be added to `core/types/events.ts`:

```typescript
// Add to EventName const:
PR_CREATED: "pr:created",
PR_UPDATED: "pr:updated",
PR_ARCHIVED: "pr:archived",

// Add to EventPayloads interface:
[EventName.PR_CREATED]: { prId: string; repoId: string; worktreeId: string };
[EventName.PR_UPDATED]: { prId: string };
[EventName.PR_ARCHIVED]: { prId: string; originInstanceId?: string | null };
```

---

## File Structure

```
core/types/
  pull-request.ts                       <- Zod schemas + TS types

src/entities/pull-requests/
  types.ts                              <- Re-exports from core/types
  service.ts                            <- Business logic + disk I/O
  store.ts                              <- Zustand store
  listeners.ts                          <- Internal event subscriptions
  gateway-handler.ts                    <- Gateway event processing
  index.ts                              <- Public exports (store, service, types)

src/lib/
  gh-cli.ts                             <- GhCli typed client (or gh-cli/ directory if >250 lines)

~/.mort/pull-requests/{id}/
  metadata.json                         <- Persisted PR binding

~/.mort/archive/pull-requests/{id}/
  metadata.json                         <- Archived PR metadata
```

### Entity Registration

Add to `src/entities/index.ts`:
- Import and call `setupPullRequestListeners()` in `setupEntityListeners()`
- Call `pullRequestService.hydrate()` in `hydrateEntities()`
- Re-export from `core/types/index.ts`: add `export * from "./pull-request.js";`

## Testing Strategy

Following the codebase requirement that all code must be verifiable with tests:

### Unit Tests

- `GhCli` -- mock shell execution, verify command construction and output parsing for each method. Test all error type classifications (not installed, not authenticated, API error).
- `pullRequestService` -- mock `appData` and `usePullRequestStore`, verify CRUD operations, deduplication logic, archive cascading, and auto-address enable/disable.
- `usePullRequestStore` -- verify selectors (`getPrByRepoAndNumber`, `getPrsByWorktree`), `_apply*` methods and their rollback functions, and display data cache operations.

### Integration Tests

- Service + Store integration -- verify that `create()` writes to disk and updates the store, `hydrate()` reads from disk into store, `archive()` moves files and removes from store.
- Gateway handler -- verify that events refresh display data for all PRs, spawn agents only when `autoAddressEnabled` is true, and correctly handle `pull_request.closed` by disabling auto-address.
- `GhCli` + actual `gh` CLI -- a small set of smoke tests that run real `gh` commands against a test repo (gated behind an environment variable, not run in CI by default).

### Test Commands

Per the existing codebase patterns, tests run via:
```bash
# Unit tests
pnpm test -- --testPathPattern=pull-request

# Integration tests
pnpm test:integration -- --testPathPattern=pull-request
```
