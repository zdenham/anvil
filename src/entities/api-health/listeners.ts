import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { toast } from "@/lib/toast.js";
import { logger } from "@/lib/logger-client.js";

export function setupApiHealthListeners(): () => void {
  const handleApiDegraded = (payload: EventPayloads[typeof EventName.API_DEGRADED]) => {
    logger.warn(`[ApiHealth] API degraded: ${payload.service} — ${payload.message}`);
    toast.error(payload.message, { duration: 5000 });
  };
  eventBus.on(EventName.API_DEGRADED, handleApiDegraded);

  return () => {
    eventBus.off(EventName.API_DEGRADED, handleApiDegraded);
  };
}
