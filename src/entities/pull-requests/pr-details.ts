/**
 * PR details fetching and archive operations.
 *
 * Extracted from service.ts to keep file sizes under the 250-line limit.
 */

import { appData } from "@/lib/app-data-store";
import { usePullRequestStore } from "./store";
import { logger } from "@/lib/logger-client";
import {
  PullRequestMetadataSchema,
  type PullRequestMetadata,
  type PullRequestDetails,
} from "./types";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { GhCli, type MergeMethod, type RepoMergeSettings } from "@/lib/gh-cli";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

const PR_DIR = "pull-requests";
const ARCHIVE_PR_DIR = "archive/pull-requests";

/**
 * Fetch and cache PullRequestDetails for a PR.
 * Called when the content pane opens, on gateway events, or on manual refresh.
 */
export async function fetchPrDetails(
  pr: PullRequestMetadata,
): Promise<PullRequestDetails | null> {
  const store = usePullRequestStore.getState();
  store.setPrDetailsLoading(pr.id, true);

  try {
    const worktreePath = useRepoWorktreeLookupStore
      .getState()
      .getWorktreePath(pr.repoId, pr.worktreeId);
    if (!worktreePath) {
      logger.warn(
        `[pullRequestService.fetchDetails] No worktree path for PR ${pr.id}`,
      );
      return null;
    }
    const ghCli = new GhCli(worktreePath);
    const details = await ghCli.getPrDetails(pr.prNumber);

    store.setPrDetails(pr.id, details);
    return details;
  } catch (error) {
    logger.error(
      `[pullRequestService.fetchDetails] Failed for PR ${pr.id}:`,
      error,
    );
    return null;
  } finally {
    store.setPrDetailsLoading(pr.id, false);
  }
}

/**
 * Archive a PR entity.
 * Moves to archive directory, disables auto-address if active.
 */
export async function archivePr(id: string): Promise<void> {
  const pr = usePullRequestStore.getState().pullRequests[id];
  if (!pr) return;

  const sourcePath = `${PR_DIR}/${id}`;
  const archivePath = `${ARCHIVE_PR_DIR}/${id}`;

  const rollback = usePullRequestStore.getState()._applyDelete(id);
  try {
    const metadata = await appData.readJson(`${sourcePath}/metadata.json`);
    await appData.ensureDir(archivePath);
    if (metadata) {
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
}

/**
 * Delete a PR entity permanently (from archive).
 */
export async function deletePr(id: string): Promise<void> {
  const rollback = usePullRequestStore.getState()._applyDelete(id);
  try {
    await appData.removeDir(`${PR_DIR}/${id}`);
    await appData.removeDir(`${ARCHIVE_PR_DIR}/${id}`);
  } catch (error) {
    rollback();
    throw error;
  }
}

/**
 * Fetch and cache repo merge settings for a PR.
 * Returns cached settings if already fetched for this repo.
 */
export async function fetchMergeSettings(
  pr: PullRequestMetadata,
): Promise<RepoMergeSettings | null> {
  const cached = usePullRequestStore.getState().repoMergeSettings[pr.repoSlug];
  if (cached) return cached;

  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return null;

  const ghCli = new GhCli(worktreePath);
  const settings = await ghCli.getRepoMergeSettings(pr.repoSlug);
  usePullRequestStore.getState().setRepoMergeSettings(pr.repoSlug, settings);
  return settings;
}

/**
 * Merge a PR and refresh its details so the UI updates.
 */
export async function mergePr(
  pr: PullRequestMetadata,
  method: MergeMethod,
): Promise<void> {
  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) throw new Error(`No worktree path for PR ${pr.id}`);

  const ghCli = new GhCli(worktreePath);
  await ghCli.mergePr(pr.prNumber, method);
  await fetchPrDetails(pr);
}

/**
 * List all archived PRs.
 */
export async function listArchivedPrs(): Promise<PullRequestMetadata[]> {
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
}
