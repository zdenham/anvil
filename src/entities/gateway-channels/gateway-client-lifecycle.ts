/**
 * GatewayClient singleton lifecycle management.
 *
 * Owns the single SSE client instance. Connects when at least one channel
 * is active and disconnects when no active channels remain.
 */

import { fetch } from "@tauri-apps/plugin-http";
import { GatewayClient } from "@core/gateway/client.js";
import { appData } from "@/lib/app-data-store";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { useGatewayChannelStore } from "./store";
import { GATEWAY_BASE_URL } from "@/lib/constants";
import { logger } from "@/lib/logger-client";

const CHECKPOINT_PATH = "gateway-channels/checkpoint";

let gatewayClient: GatewayClient | null = null;

/**
 * Ensure the SSE client is connected. No-op if already running.
 */
export function ensureConnected(deviceId: string): void {
  if (gatewayClient) return;

  gatewayClient = new GatewayClient({
    baseUrl: GATEWAY_BASE_URL,
    deviceId,
    fetch,
    loadLastEventId: () => appData.readText(CHECKPOINT_PATH),
    saveLastEventId: (id) => appData.writeText(CHECKPOINT_PATH, id),
    onEvent: (event) => {
      eventBus.emit(EventName.GATEWAY_EVENT, event);
    },
    onStatus: (status) => {
      useGatewayChannelStore.getState().setConnectionStatus(status);
      eventBus.emit(EventName.GATEWAY_STATUS, { status });
    },
  });

  gatewayClient.connect();
}

/**
 * Disconnect the SSE client if no active channels remain.
 */
export function disconnectIfIdle(): void {
  const anyActive = useGatewayChannelStore.getState().hasActiveChannels();
  if (!anyActive && gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
}

/**
 * Force disconnect regardless of channel state.
 * Used during cleanup/shutdown.
 */
export function forceDisconnect(): void {
  if (gatewayClient) {
    gatewayClient.disconnect();
    gatewayClient = null;
  }
}
