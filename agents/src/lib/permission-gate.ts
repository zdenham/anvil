import { EventName } from "@core/types/events.js";
import { logger } from "./logger.js";

interface PendingRequest {
  resolve: (response: { approved: boolean; reason?: string } | "timeout") => void;
  threadId: string;
  toolName: string;
  createdAt: number;
}

/**
 * Async bridge between PreToolUse hooks (which block the agent) and
 * the frontend (which sends PERMISSION_RESPONSE via hub socket).
 *
 * waitForResponse() emits a PERMISSION_REQUEST event and creates a
 * promise that blocks the hook. resolve() is called from the hub
 * socket message handler to unblock it.
 */
export class PermissionGate {
  private pending = new Map<string, PendingRequest>();

  /**
   * Emit a permission request event and block until the frontend responds.
   * Returns the user's decision, or "timeout" if the abort signal fires.
   */
  async waitForResponse(
    requestId: string,
    context: {
      threadId: string;
      toolName: string;
      toolInput: unknown;
      toolUseId?: string;
      reason: string;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: Record<string, unknown>) => void,
  ): Promise<{ approved: boolean; reason?: string } | "timeout"> {
    // Emit event to frontend
    emitEvent(EventName.PERMISSION_REQUEST, {
      requestId,
      threadId: context.threadId,
      toolName: context.toolName,
      toolInput: context.toolInput as Record<string, unknown>,
      ...(context.toolUseId ? { toolUseId: context.toolUseId } : {}),
      timestamp: Date.now(),
    });

    logger.info(
      `[PermissionGate] Emitted PERMISSION_REQUEST: ${requestId} for ${context.toolName}`,
    );

    return new Promise((resolve) => {
      this.pending.set(requestId, {
        resolve,
        threadId: context.threadId,
        toolName: context.toolName,
        createdAt: Date.now(),
      });

      // Clean up on abort (timeout or cancellation)
      context.signal.addEventListener(
        "abort",
        () => {
          if (this.pending.has(requestId)) {
            this.pending.delete(requestId);
            logger.info(`[PermissionGate] Request ${requestId} aborted`);
            resolve("timeout");
          }
        },
        { once: true },
      );
    });
  }

  /**
   * Called when the frontend sends back a PERMISSION_RESPONSE via hub socket.
   * Resolves the waiting hook promise.
   */
  resolve(requestId: string, approved: boolean, reason?: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      logger.info(`[PermissionGate] No pending request for ${requestId}, ignoring`);
      return;
    }
    this.pending.delete(requestId);
    logger.info(
      `[PermissionGate] Resolved ${requestId}: approved=${approved}`,
    );
    pending.resolve({ approved, reason });
  }

  /** Clean up all pending requests (e.g., on agent shutdown). */
  clear(): void {
    for (const [id, pending] of this.pending) {
      logger.info(`[PermissionGate] Clearing pending request ${id}`);
      pending.resolve("timeout");
    }
    this.pending.clear();
  }
}
