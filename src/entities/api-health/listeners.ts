import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { toast } from "@/lib/toast.js";
import { logger } from "@/lib/logger-client.js";

export function setupApiHealthListeners(): void {
  eventBus.on(EventName.API_DEGRADED, (payload) => {
    logger.warn(`[ApiHealth] API degraded: ${payload.service} — ${payload.message}`);
    toast.error(payload.message, { duration: 5000 });
  });
}
