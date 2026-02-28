/**
 * Helper functions for gateway channel webhook management and identity loading.
 *
 * Extracted from service.ts to keep file sizes under the 250-line limit.
 */

import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { GhCli } from "@/lib/gh-cli/client";
import type { GatewayChannelMetadata } from "./types";

/**
 * Create a GitHub webhook for a gateway channel.
 * Returns updated metadata with webhookId if successful.
 */
export async function createGitHubWebhook(
  metadata: GatewayChannelMetadata,
  repoRootPath: string,
): Promise<GatewayChannelMetadata> {
  const tag = `[createGitHubWebhook channel=${metadata.id}]`;
  logger.info(`${tag} Starting webhook setup (url=${metadata.webhookUrl}, cwd=${repoRootPath})`);

  try {
    const ghCli = new GhCli(repoRootPath);
    const isAvailable = await ghCli.isAvailable();
    if (!isAvailable) {
      logger.warn(`${tag} gh CLI not available or not authenticated — skipping`);
      return metadata;
    }

    // Check if a webhook already exists for this URL
    const existing = await ghCli.listWebhooks();
    logger.info(`${tag} Found ${existing.length} existing webhook(s)`);

    const match = existing.find(
      (wh) => wh.config.url === metadata.webhookUrl,
    );
    if (match) {
      logger.info(`${tag} Webhook already exists (id=${match.id})`);
      return { ...metadata, webhookId: match.id };
    }

    // Create a new webhook (secret is empty for gateway-proxied webhooks)
    logger.info(`${tag} Creating new webhook...`);
    const result = await ghCli.createWebhook(metadata.webhookUrl, "");
    logger.info(`${tag} Created webhook id=${result.id}`);
    return { ...metadata, webhookId: result.id };
  } catch (e) {
    logger.error(`${tag} Webhook creation failed:`, e);
    return metadata;
  }
}

/**
 * Load the device ID from the identity file on disk.
 */
export async function loadDeviceId(): Promise<string> {
  const raw = await appData.readJson<{ device_id?: string }>("settings/app-config.json");
  if (!raw?.device_id) {
    throw new Error("App config not found or missing device_id (settings/app-config.json)");
  }
  return raw.device_id;
}
