import { sendPermissionResponse } from "@/lib/agent-service";
import { usePermissionStore } from "./store";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { logger } from "@/lib/logger-client";
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionStatus,
} from "@core/types/permissions.js";

export const permissionService = {
  /**
   * Respond to a permission request.
   * Sends response to agent and updates store.
   */
  async respond(
    request: PermissionRequest,
    decision: PermissionDecision,
    reason?: string
  ): Promise<void> {
    logger.info(
      `[permissionService] Responding to ${request.requestId}:`,
      decision
    );

    const status: PermissionStatus =
      decision === "approve" ? "approved" : "denied";

    // Optimistically update status
    const rollback = usePermissionStore
      .getState()
      ._applyUpdateStatus(request.requestId, status);

    try {
      // Send to agent via stdin
      await sendPermissionResponse(
        request.threadId,
        request.requestId,
        decision,
        reason
      );

      // Emit event for logging/debugging
      eventBus.emit(EventName.PERMISSION_RESPONSE, {
        requestId: request.requestId,
        threadId: request.threadId,
        decision,
        reason,
      });

      // Design Decision: Keep requests after response (don't remove)
      //
      // Rationale: Keeping responded requests in the store provides:
      // 1. Visual feedback - user can see approved/denied status in inline mode
      // 2. Debugging - easier to trace what happened during a session
      // 3. Potential future features - history, undo, analytics
      //
      // Requests are automatically cleaned up when:
      // - Agent completes (AGENT_COMPLETED event triggers _applyClearThread)
      // - Agent errors (AGENT_ERROR event triggers _applyClearThread)
      // - Agent is cancelled (AGENT_CANCELLED event triggers _applyClearThread)
      //
      // If memory becomes a concern (unlikely with typical permission counts),
      // uncomment the line below to remove immediately after response:
      // usePermissionStore.getState()._applyRemoveRequest(request.requestId);
    } catch (error) {
      logger.error("[permissionService] Failed to send response:", error);
      rollback(); // Rollback on failure
      throw error;
    }
  },

  /**
   * Approve all pending requests for a thread.
   */
  async approveAll(threadId: string): Promise<void> {
    const requests = usePermissionStore
      .getState()
      .getRequestsByThread(threadId)
      .filter((r) => r.status === "pending");

    for (const request of requests) {
      await this.respond(request, "approve");
    }
  },

  /**
   * Deny all pending requests for a thread.
   */
  async denyAll(threadId: string): Promise<void> {
    const requests = usePermissionStore
      .getState()
      .getRequestsByThread(threadId)
      .filter((r) => r.status === "pending");

    for (const request of requests) {
      await this.respond(request, "deny");
    }
  },

  /**
   * Get the current pending request for a thread.
   */
  getPendingRequest(
    threadId: string
  ): (PermissionRequest & { status: PermissionStatus }) | undefined {
    return usePermissionStore.getState().getNextRequestForThread(threadId);
  },
};
