/**
 * Gateway channel service.
 *
 * CRUD operations for gateway channels, persists to disk, and manages
 * the SSE connection lifecycle via the GatewayClient singleton.
 *
 * Storage layout (within ~/.anvil/):
 *   gateway-channels/{channelId}/metadata.json  <- Zod-validated on read
 *   gateway-channels/checkpoint                 <- Last-Event-ID for SSE replay
 */

import { fetch } from "@tauri-apps/plugin-http";
import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { GATEWAY_BASE_URL } from "@/lib/constants";
import { GatewayChannelMetadataSchema } from "./types";
import type { GatewayChannelMetadata } from "./types";
import { useGatewayChannelStore } from "./store";
import { ensureConnected, disconnectIfIdle } from "./gateway-client-lifecycle";
import { GhCli } from "@/lib/gh-cli/client";
import { createGitHubWebhook, loadDeviceId } from "./webhook-helpers";

const CHANNELS_DIR = "gateway-channels";

/** Schema for the server's channel registration response */
interface ChannelRegistrationResponse {
  channelId: string;
  webhookUrl: string;
}

export class GatewayChannelService {
  /**
   * Load all channel metadata from disk into store.
   */
  async hydrate(): Promise<void> {
    await appData.ensureDir(CHANNELS_DIR);
    const entries = await appData.listDir(CHANNELS_DIR);

    const channels: Record<string, GatewayChannelMetadata> = {};
    let hasActive = false;

    for (const entry of entries) {
      if (entry === "checkpoint") continue;

      const metadataPath = `${CHANNELS_DIR}/${entry}/metadata.json`;
      const raw = await appData.readJson(metadataPath);
      if (!raw) continue;

      const result = GatewayChannelMetadataSchema.safeParse(raw);
      if (!result.success) {
        logger.warn(
          `[GatewayChannelService] Invalid metadata for ${entry}:`,
          result.error.message,
        );
        continue;
      }

      channels[result.data.id] = result.data;
      if (result.data.active) hasActive = true;
    }

    useGatewayChannelStore.getState().hydrate(channels);
    logger.info(
      `[GatewayChannelService] Hydrated ${Object.keys(channels).length} channels`,
    );

    if (hasActive) {
      const deviceId = await loadDeviceId();
      ensureConnected(deviceId);
    }
  }

  /**
   * Register a channel on the server, create GitHub webhook, and persist locally.
   */
  async create(input: {
    deviceId: string;
    type: "github";
    label: string;
    repoId: string;
    repoRootPath: string;
  }): Promise<GatewayChannelMetadata> {
    const { deviceId, label, repoId, repoRootPath } = input;

    // Register channel on the gateway server
    logger.info(`[GatewayChannelService.create] POST ${GATEWAY_BASE_URL}/gateway/channels`);
    const response = await fetch(`${GATEWAY_BASE_URL}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, type: "github", label }),
    });
    logger.info(`[GatewayChannelService.create] Response: ${response.status}`);

    if (!response.ok) {
      throw new Error(
        `Failed to register gateway channel: ${response.status}`,
      );
    }

    const { channelId, webhookUrl } =
      (await response.json()) as ChannelRegistrationResponse;

    const metadata: GatewayChannelMetadata = {
      id: channelId,
      type: "github",
      label,
      active: false,
      webhookUrl,
      repoId,
      webhookId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Create GitHub webhook via gh CLI
    const updatedMetadata = await createGitHubWebhook(
      metadata,
      repoRootPath,
    );

    // Persist to disk
    await this.persistMetadata(updatedMetadata);

    // Apply to store
    useGatewayChannelStore.getState()._applyCreate(updatedMetadata);
    logger.info(
      `[GatewayChannelService] Created channel ${channelId} for ${label}`,
    );

    return updatedMetadata;
  }

  /**
   * Activate a channel. Connects GatewayClient if not already connected.
   */
  async activate(channelId: string): Promise<void> {
    const channel = useGatewayChannelStore.getState().getChannel(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    if (channel.active) return;

    const updated: GatewayChannelMetadata = {
      ...channel,
      active: true,
      updatedAt: Date.now(),
    };

    await this.persistMetadata(updated);
    useGatewayChannelStore.getState()._applyUpdate(channelId, updated);

    const deviceId = await loadDeviceId();
    ensureConnected(deviceId);
  }

  /**
   * Deactivate a channel. Disconnects GatewayClient if no active channels remain.
   */
  async deactivate(channelId: string): Promise<void> {
    const channel = useGatewayChannelStore.getState().getChannel(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    if (!channel.active) return;

    const updated: GatewayChannelMetadata = {
      ...channel,
      active: false,
      updatedAt: Date.now(),
    };

    await this.persistMetadata(updated);
    useGatewayChannelStore.getState()._applyUpdate(channelId, updated);
    disconnectIfIdle();
  }

  /**
   * Delete channel from disk, store, and clean up webhook.
   */
  async delete(channelId: string, repoRootPath?: string): Promise<void> {
    const channel = useGatewayChannelStore.getState().getChannel(channelId);
    if (!channel) return;

    // Best-effort webhook cleanup
    if (channel.webhookId && repoRootPath) {
      try {
        const ghCli = new GhCli(repoRootPath);
        await ghCli.deleteWebhook(channel.webhookId);
      } catch (e) {
        logger.warn(
          `[GatewayChannelService] Failed to delete webhook ${channel.webhookId}:`,
          e,
        );
      }
    }

    // Remove from store
    useGatewayChannelStore.getState()._applyDelete(channelId);

    // Remove from disk
    await appData.removeDir(`${CHANNELS_DIR}/${channelId}`);
    disconnectIfIdle();

    logger.info(`[GatewayChannelService] Deleted channel ${channelId}`);
  }

  /**
   * Get a channel by ID (from store).
   */
  get(id: string): GatewayChannelMetadata | undefined {
    return useGatewayChannelStore.getState().getChannel(id);
  }

  /**
   * Get a channel by repo ID (from store).
   */
  getByRepoId(repoId: string): GatewayChannelMetadata | undefined {
    return useGatewayChannelStore.getState().getChannelByRepoId(repoId);
  }

  /**
   * Partially update a channel's metadata (persist + store).
   */
  async updateMetadata(
    channelId: string,
    updates: Partial<Pick<GatewayChannelMetadata, "webhookId">>,
  ): Promise<void> {
    const channel = useGatewayChannelStore.getState().getChannel(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);

    const updated: GatewayChannelMetadata = {
      ...channel,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.persistMetadata(updated);
    useGatewayChannelStore.getState()._applyUpdate(channelId, updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async persistMetadata(
    metadata: GatewayChannelMetadata,
  ): Promise<void> {
    const path = `${CHANNELS_DIR}/${metadata.id}/metadata.json`;
    await appData.writeJson(path, metadata);
  }
}

export const gatewayChannelService = new GatewayChannelService();
