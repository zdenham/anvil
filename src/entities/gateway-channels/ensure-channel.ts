/**
 * Idempotent helper to ensure a gateway channel exists for a repository.
 *
 * Called during entity hydration for every repo. Creates a channel
 * and webhook if none exists, activates if inactive.
 */

import { gatewayChannelService } from "./service";
import { appData } from "@/lib/app-data-store";
import { loadSettings } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import type { Repository } from "../repositories/types";
import type { GatewayChannelMetadata } from "./types";
import { repoService } from "../repositories/service";
import { createGitHubWebhook } from "./webhook-helpers";

/**
 * Converts a repository name to a slug (lowercase, hyphens for spaces/special chars).
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getDeviceId(): Promise<string> {
  const raw = await appData.readJson<{ device_id?: string }>("settings/app-config.json");
  if (!raw?.device_id) {
    throw new Error("App config not found or missing device_id (settings/app-config.json)");
  }
  return raw.device_id;
}

/**
 * Ensure a gateway channel exists and is active for the given repo.
 * Idempotent -- safe to call on every launch.
 */
export async function ensureGatewayChannelForRepo(
  repo: Repository,
): Promise<void> {
  if (!repo.sourcePath) return;

  const slug = slugify(repo.name);
  const settings = await loadSettings(slug);
  const repoId = settings.id;

  logger.info(`[ensureGatewayChannelForRepo] Starting for ${repo.name} (repoId=${repoId})`);

  const channel = gatewayChannelService.getByRepoId(repoId);
  if (channel) {
    if (!channel.active) {
      logger.info(`[ensureGatewayChannelForRepo] Activating inactive channel ${channel.id} for ${repo.name}`);
      await gatewayChannelService.activate(channel.id);
    }

    // Retry webhook creation if the initial attempt failed
    if (channel.webhookId == null) {
      logger.info(`[ensureGatewayChannelForRepo] Channel ${channel.id} missing webhook, retrying...`);
      const updated = await createGitHubWebhook(channel, repo.sourcePath);
      if (updated.webhookId != null) {
        await gatewayChannelService.updateMetadata(channel.id, { webhookId: updated.webhookId });
      }
    }

    return;
  }

  logger.info(`[ensureGatewayChannelForRepo] No existing channel for ${repo.name}, creating...`);
  const deviceId = await getDeviceId();

  const newChannel = await gatewayChannelService.create({
    deviceId,
    type: "github",
    label: repo.name,
    repoId,
    repoRootPath: repo.sourcePath,
  });

  await gatewayChannelService.activate(newChannel.id);
  logger.info(
    `[ensureGatewayChannelForRepo] Created and activated channel for ${repo.name}`,
  );
}

/**
 * Ensure a gateway channel exists, is active, and has a live connection
 * for a repo identified by its settings ID.
 *
 * Idempotent across all states:
 * - No entity → creates channel, activates, connects
 * - Entity inactive → activates, connects
 * - Entity active but disconnected → re-ensures connection
 * - Entity active and connected → no-op
 *
 * Unlike ensureGatewayChannelForRepo (which takes a Repository), this takes
 * a repoId and resolves the repo internally. Used for on-demand creation
 * when hydration-time creation failed or connection dropped.
 */
export async function ensureGatewayChannelByRepoId(repoId: string): Promise<GatewayChannelMetadata | null> {
  // Always delegate to ensureGatewayChannelForRepo — it handles all four states
  // (missing, inactive, active-but-disconnected, fully-connected).
  // Do NOT short-circuit on getByRepoId() returning truthy — that only checks
  // entity existence, not connection state.

  const repos = repoService.getAll();
  for (const repo of repos) {
    if (!repo.sourcePath) continue;
    const slug = slugify(repo.name);
    const settings = await loadSettings(slug);
    if (settings.id === repoId) {
      await ensureGatewayChannelForRepo(repo);
      return gatewayChannelService.getByRepoId(repoId) ?? null;
    }
  }

  logger.error(`[ensureGatewayChannelByRepoId] No repo found for repoId ${repoId}`);
  return null;
}
