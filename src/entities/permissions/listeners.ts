import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { usePermissionStore } from "./store.js";
import { PermissionRequestSchema } from "@core/types/permissions.js";
import { logger } from "@/lib/logger-client.js";

export function setupPermissionListeners(): void {
  // Handle incoming permission requests from agent
  eventBus.on(EventName.PERMISSION_REQUEST, (payload) => {
    const result = PermissionRequestSchema.safeParse(payload);

    if (!result.success) {
      logger.warn("[PermissionListener] Invalid permission request:", result.error);
      return;
    }

    usePermissionStore.getState()._applyAddRequest(result.data);
  });

  // Clean up on agent completion
  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  });

  // Clean up on agent error
  eventBus.on(EventName.AGENT_ERROR, ({ threadId }) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  });
}
