/**
 * PR entity event listeners.
 *
 * Handles two categories of events:
 * 1. Internal PR lifecycle events (PR_CREATED, PR_UPDATED, PR_ARCHIVED)
 * 2. Gateway webhook events (GITHUB_WEBHOOK_EVENT) for display updates
 *    and auto-address agent spawning.
 *
 * Called once at app startup via src/entities/index.ts.
 */

import { eventBus } from "../events";
import { EventName, type EventPayloads } from "@core/types/events.js";
import type { PermissionModeId } from "@core/types/permissions.js";
import { pullRequestService } from "./service";
import { usePullRequestStore } from "./store";
import { gatewayChannelService } from "../gateway-channels/service";
import { GhCli } from "@/lib/gh-cli";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { createThread } from "@/lib/thread-creation-service";
import { logger } from "@/lib/logger-client";
import type { PullRequestMetadata } from "./types";
import { handlePullRequestEvent } from "./pr-lifecycle-handler";
import {
  extractPrNumber,
  classifyGithubEvent,
  debounceAutoAddress,
  fetchFreshContext,
  buildAutoAddressPrompt,
  type PrAction,
} from "./event-helpers";

// Handler references for HMR cleanup
let prCreatedHandler: ((p: EventPayloads[typeof EventName.PR_CREATED]) => void) | null = null;
let prUpdatedHandler: ((p: EventPayloads[typeof EventName.PR_UPDATED]) => void) | null = null;
let prArchivedHandler: ((p: EventPayloads[typeof EventName.PR_ARCHIVED]) => void) | null = null;
let webhookHandler: ((p: EventPayloads[typeof EventName.GITHUB_WEBHOOK_EVENT]) => void) | null = null;

export function setupPullRequestListeners(): void {
  cleanupPrListeners();
  setupInternalPrListeners();
  setupGatewayWebhookListener();
  logger.info("[PullRequestListener] PR entity listeners initialized");
}

function cleanupPrListeners(): void {
  if (prCreatedHandler) eventBus.off(EventName.PR_CREATED, prCreatedHandler);
  if (prUpdatedHandler) eventBus.off(EventName.PR_UPDATED, prUpdatedHandler);
  if (prArchivedHandler) eventBus.off(EventName.PR_ARCHIVED, prArchivedHandler);
  if (webhookHandler) eventBus.off(EventName.GITHUB_WEBHOOK_EVENT, webhookHandler);
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal PR lifecycle listeners
// ═══════════════════════════════════════════════════════════════════════════

function setupInternalPrListeners(): void {
  prCreatedHandler = async ({ prId }: EventPayloads[typeof EventName.PR_CREATED]) => {
    try {
      await pullRequestService.refreshById(prId);
    } catch (e) {
      logger.error(`[PrListener] Failed to refresh created PR ${prId}:`, e);
    }
  };
  eventBus.on(EventName.PR_CREATED, prCreatedHandler);

  prUpdatedHandler = async ({ prId }: EventPayloads[typeof EventName.PR_UPDATED]) => {
    try {
      await pullRequestService.refreshById(prId);
    } catch (e) {
      logger.error(`[PrListener] Failed to refresh updated PR ${prId}:`, e);
    }
  };
  eventBus.on(EventName.PR_UPDATED, prUpdatedHandler);

  prArchivedHandler = ({ prId }: EventPayloads[typeof EventName.PR_ARCHIVED]) => {
    try {
      const store = usePullRequestStore.getState();
      if (store.pullRequests[prId]) {
        store._applyDelete(prId);
        logger.info(`[PrListener] Removed archived PR ${prId} from store`);
      }
    } catch (e) {
      logger.error(`[PrListener] Failed to handle PR archive ${prId}:`, e);
    }
  };
  eventBus.on(EventName.PR_ARCHIVED, prArchivedHandler);
}

// ═══════════════════════════════════════════════════════════════════════════
// Gateway webhook event listener
// ═══════════════════════════════════════════════════════════════════════════

function setupGatewayWebhookListener(): void {
  webhookHandler = async ({ channelId, githubEventType, payload }: EventPayloads[typeof EventName.GITHUB_WEBHOOK_EVENT]) => {
    const channel = gatewayChannelService.get(channelId);
    if (!channel?.repoId) return;

    // Handle pull_request events for PR creation and closure
    if (githubEventType === "pull_request") {
      await handlePullRequestEvent(channel.repoId, channelId, payload);
      return;
    }

    const prNumber = extractPrNumber(githubEventType, payload);
    if (!prNumber) return;

    const pr = pullRequestService.getByRepoAndNumber(channel.repoId, prNumber);
    if (!pr) return;

    const action = classifyGithubEvent(githubEventType, payload);
    if (!action) return;

    // Stage 1: Always refresh display data for the affected PR
    await refreshPrDisplayData(pr, action);

    // Stage 2: Spawn agent only if auto-address is enabled
    if (!pr.autoAddressEnabled) return;

    debounceAutoAddress(pr.id, action, async () => {
      try {
        await spawnAutoAddressAgent(pr, action);
      } catch (e) {
        logger.error(`[PrListener] Failed to spawn auto-address agent for PR #${pr.prNumber}:`, e);
      }
    });
  };
  eventBus.on(EventName.GITHUB_WEBHOOK_EVENT, webhookHandler);
}

// ═══════════════════════════════════════════════════════════════════════════
// Display data refresh
// ═══════════════════════════════════════════════════════════════════════════

async function refreshPrDisplayData(
  pr: PullRequestMetadata,
  action: PrAction,
): Promise<void> {
  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return;

  const ghCli = new GhCli(worktreePath);
  try {
    if (action.type === "ci-failure") {
      const checks = await ghCli.getPrChecks(pr.prNumber);
      const existing = usePullRequestStore.getState().getPrDetails(pr.id);
      if (existing) {
        usePullRequestStore.getState().setPrDetails(pr.id, { ...existing, checks });
      }
    } else {
      const details = await ghCli.getPrDetails(pr.prNumber);
      usePullRequestStore.getState().setPrDetails(pr.id, details);
    }
  } catch (e) {
    // Display update failure is non-fatal -- do not block agent spawn
    logger.warn(`[PrListener] Failed to refresh display data for PR #${pr.prNumber}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-address agent spawning
// ═══════════════════════════════════════════════════════════════════════════

async function spawnAutoAddressAgent(
  pr: PullRequestMetadata,
  action: PrAction,
): Promise<void> {
  const worktreePath = useRepoWorktreeLookupStore
    .getState()
    .getWorktreePath(pr.repoId, pr.worktreeId);
  if (!worktreePath) return;

  const ghCli = new GhCli(worktreePath);
  const context = await fetchFreshContext(ghCli, pr.prNumber, action);
  const prompt = buildAutoAddressPrompt(pr, action, context);
  const permissionMode = getAutoAddressPermissionMode();

  await createThread({
    prompt,
    repoId: pr.repoId,
    worktreeId: pr.worktreeId,
    worktreePath,
    permissionMode,
  });

  logger.info(`[PrListener] Spawned auto-address agent for PR #${pr.prNumber}: ${action.type}`);
}

/**
 * Get the permission mode for auto-address agents.
 * Default: "approve" (agents wait for user approval on each tool call).
 * TODO: Read from user settings once the auto-address settings UI is implemented.
 */
function getAutoAddressPermissionMode(): PermissionModeId {
  return "approve";
}
