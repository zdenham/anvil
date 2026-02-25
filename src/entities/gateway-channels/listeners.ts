/**
 * Gateway channel event listeners.
 *
 * Routes raw gateway events into typed entity-specific events.
 * This is a thin routing layer -- the actual event handling logic
 * lives in the PR entity listeners (plan D2).
 *
 * NOTE: We use string literals for event registration/deregistration
 * instead of EventName.* because Vite HMR can cause the EventName
 * import to resolve from a stale module snapshot where the values
 * are undefined. The string literals are immune to this.
 */

import { eventBus } from "../events";
import type { GatewayEvent } from "@core/types/gateway-events.js";

let gatewayEventHandler: ((event: GatewayEvent) => void) | null = null;

/** Hardcoded event keys — immune to HMR staleness */
const GATEWAY_EVENT_KEY = "gateway:event" as const;
const GITHUB_WEBHOOK_EVENT_KEY = "github:webhook-event" as const;

export function setupGatewayChannelListeners(): void {
  // Clean up previous handler (HMR safety)
  if (gatewayEventHandler) {
    eventBus.off(GATEWAY_EVENT_KEY, gatewayEventHandler);
  }

  gatewayEventHandler = (event: GatewayEvent) => {
    if (!event || typeof event?.type !== "string") {
      return;
    }

    if (event.type.startsWith("github.")) {
      eventBus.emit(GITHUB_WEBHOOK_EVENT_KEY, {
        channelId: event.channelId,
        githubEventType: event.type.replace("github.", ""),
        payload: event.payload,
      });
    }
  };

  eventBus.on(GATEWAY_EVENT_KEY, gatewayEventHandler);
}
