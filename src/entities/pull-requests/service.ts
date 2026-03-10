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
import {
  fetchPrDetails,
  fetchMergeSettings,
  mergePr as mergePrDetails,
  archivePr,
  unarchivePr,
  deletePr,
  listArchivedPrs,
} from "./pr-details";
import type { MergeMethod, RepoMergeSettings } from "@/lib/gh-cli";

// ═══════════════════════════════════════════════════════════════════════════
// Directory Constants
// ═══════════════════════════════════════════════════════════════════════════

const PR_DIR = "pull-requests";

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
      }),
    );

    usePullRequestStore.getState().hydrate(prs);
    logger.info(`[pullRequestService.hydrate] Loaded ${Object.keys(prs).length} PRs`);
  },

  /**
   * Create a new PR entity.
   * Deduplicates by repoId + prNumber -- if a PR entity already exists
   * for this repo + number, returns the existing one (idempotent).
   */
  async create(
    input: CreatePullRequestInput,
    options?: { isViewed?: boolean },
  ): Promise<PullRequestMetadata> {
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
      visualSettings: {
        parentId: input.worktreeId,
      },
    };

    const prPath = `${PR_DIR}/${metadata.id}`;

    await optimistic(
      metadata,
      (pr) => usePullRequestStore.getState()._applyCreate(pr),
      async (pr) => {
        await appData.ensureDir(prPath);
        await appData.writeJson(`${prPath}/metadata.json`, pr);
      },
    );

    eventBus.emit(EventName.PR_CREATED, {
      prId: metadata.id,
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
    });

    logger.info(`[pullRequestService.create] Created PR ${metadata.id} (#${metadata.prNumber})`);
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
    return usePullRequestStore
      .getState()
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
    updates: Partial<
      Pick<
        PullRequestMetadata,
        "worktreeId" | "autoAddressEnabled" | "gatewayChannelId" | "isViewed" | "visualSettings"
      >
    >,
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
      },
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

  /** Disable auto-address for a PR. */
  async disableAutoAddress(id: string): Promise<void> {
    await this.update(id, {
      autoAddressEnabled: false,
      gatewayChannelId: null,
    });
  },

  /** Enable auto-address for a PR. */
  async enableAutoAddress(
    id: string,
    gatewayChannelId: string,
  ): Promise<void> {
    await this.update(id, {
      autoAddressEnabled: true,
      gatewayChannelId,
    });
  },

  /** Archive a PR entity. Delegates to pr-details module. */
  async archive(id: string): Promise<void> {
    await archivePr(id);
  },

  /** Unarchive a PR entity. Delegates to pr-details module. */
  async unarchive(id: string): Promise<void> {
    await unarchivePr(id);
  },

  /** Archive all PRs for a worktree. */
  async archiveByWorktree(worktreeId: string): Promise<void> {
    const prs = this.getByWorktree(worktreeId);
    for (const pr of prs) {
      await this.archive(pr.id);
    }
  },

  /** Delete a PR entity permanently (from archive). */
  async delete(id: string): Promise<void> {
    await deletePr(id);
  },

  /**
   * Fetch and cache PullRequestDetails for a PR.
   * Called when the content pane opens, on gateway events, or on manual refresh.
   */
  async fetchDetails(id: string): Promise<PullRequestDetails | null> {
    const pr = this.get(id);
    if (!pr) return null;
    return fetchPrDetails(pr);
  },

  /** Fetch and cache repo merge settings for a PR. */
  async fetchMergeSettings(id: string): Promise<RepoMergeSettings | null> {
    const pr = this.get(id);
    if (!pr) return null;
    return fetchMergeSettings(pr);
  },

  /** Merge a PR using the given method. */
  async merge(id: string, method: MergeMethod): Promise<void> {
    const pr = this.get(id);
    if (!pr) throw new Error(`PR not found: ${id}`);
    await mergePrDetails(pr, method);
  },

  /** List all archived PRs. */
  async listArchived(): Promise<PullRequestMetadata[]> {
    return listArchivedPrs();
  },
};
