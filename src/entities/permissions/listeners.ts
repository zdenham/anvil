import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { usePermissionStore } from "./store.js";
import { PermissionRequestSchema } from "@core/types/permissions.js";
import { logger } from "@/lib/logger-client.js";

export function setupPermissionListeners(): () => void {
  const handleRequest = (payload: EventPayloads[typeof EventName.PERMISSION_REQUEST]) => {
    const result = PermissionRequestSchema.safeParse(payload);
    if (!result.success) {
      logger.warn("[PermissionListener] Invalid permission request:", result.error);
      return;
    }
    usePermissionStore.getState()._applyAddRequest(result.data);
  };

  const handleCompleted = ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  };

  const handleError = ({ threadId }: EventPayloads[typeof EventName.AGENT_ERROR]) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  };

  eventBus.on(EventName.PERMISSION_REQUEST, handleRequest);
  eventBus.on(EventName.AGENT_COMPLETED, handleCompleted);
  eventBus.on(EventName.AGENT_ERROR, handleError);

  return () => {
    eventBus.off(EventName.PERMISSION_REQUEST, handleRequest);
    eventBus.off(EventName.AGENT_COMPLETED, handleCompleted);
    eventBus.off(EventName.AGENT_ERROR, handleError);
  };
}
