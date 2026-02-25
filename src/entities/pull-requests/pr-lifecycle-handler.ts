/**
 * Handles pull_request webhook events for PR entity lifecycle.
 *
 * Extracted from listeners.ts to keep file sizes under the 250-line limit.
 *
 * Two actions:
 * - "opened": Create a PR entity if a local worktree exists for the branch.
 *   The entity appears with isViewed=false (blue icon, not force-opened).
 * - "closed": Auto-disable auto-address and refresh display data.
 */

import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { GhCli } from "@/lib/gh-cli";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { findWorktreeByBranch } from "./utils";
import { logger } from "@/lib/logger-client";

/**
 * Route a pull_request webhook event to the appropriate handler.
 */
export async function handlePullRequestEvent(
  repoId: string,
  _channelId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const action = payload.action as string | undefined;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const prNumber = typeof pr?.number === "number" ? pr.number : null;
  if (!prNumber) return;

  if (action === "opened") {
    await handlePrOpened(repoId, prNumber, payload);
    return;
  }

  if (action === "closed") {
    await handlePrClosed(repoId, prNumber);
  }
}

/**
 * Handle pull_request.opened: create PR entity if a matching worktree exists.
 */
async function handlePrOpened(
  repoId: string,
  prNumber: number,
  payload: Record<string, unknown>,
): Promise<void> {
  // Idempotent: skip if entity already exists
  const existing = pullRequestService.getByRepoAndNumber(repoId, prNumber);
  if (existing) return;

  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const headBranch = (pr?.head as Record<string, unknown> | undefined)?.ref as string | undefined;
  const baseBranch = (pr?.base as Record<string, unknown> | undefined)?.ref as string | undefined;
  const repoSlug = (payload.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;

  // Map the PR's head branch to a local worktree
  const worktree = await findWorktreeByBranch(repoId, headBranch ?? "");
  if (!worktree) return; // No local worktree for this branch -- skip

  await pullRequestService.create(
    {
      prNumber,
      repoId,
      worktreeId: worktree.id,
      repoSlug: repoSlug ?? "",
      headBranch: headBranch ?? "",
      baseBranch: baseBranch ?? "main",
    },
    { isViewed: false },
  );

  logger.info(`[PrLifecycle] Created PR entity from webhook: #${prNumber}`, { repoId });
}

/**
 * Handle pull_request.closed: auto-disable auto-address and refresh display.
 */
async function handlePrClosed(
  repoId: string,
  prNumber: number,
): Promise<void> {
  const pr = pullRequestService.getByRepoAndNumber(repoId, prNumber);
  if (!pr) return;

  // Auto-disable auto-address when PR is closed or merged
  if (pr.autoAddressEnabled) {
    await pullRequestService.update(pr.id, {
      autoAddressEnabled: false,
      gatewayChannelId: null,
    });
    logger.info(`[PrLifecycle] Auto-disabled auto-address for closed PR #${prNumber}`);
  }

  // Refresh display data so UI shows closed/merged state immediately
  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return;

  try {
    const ghCli = new GhCli(worktreePath);
    const details = await ghCli.getPrDetails(pr.prNumber);
    usePullRequestStore.getState().setPrDetails(pr.id, details);
  } catch (e) {
    logger.warn(`[PrLifecycle] Failed to refresh closed PR #${prNumber}:`, e);
  }
}
