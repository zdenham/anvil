import { EventName } from "@core/types/events.js";
import { logger } from "./logger.js";

interface PendingQuestion {
  resolve: (response: { answers: Record<string, string> } | "timeout") => void;
  createdAt: number;
}

/**
 * Async bridge between PreToolUse hooks (which block the agent) and
 * the frontend (which sends QUESTION_RESPONSE via hub socket).
 *
 * Mirrors PermissionGate but for AskUserQuestion tool calls.
 * waitForAnswer() emits a QUESTION_REQUEST event and creates a
 * promise that blocks the hook. resolve() is called from the hub
 * socket message handler to unblock it.
 */
export class QuestionGate {
  private pending = new Map<string, PendingQuestion>();

  /**
   * Emit a question request event and block until the frontend responds.
   * Returns the user's answers, or "timeout" if the abort signal fires.
   */
  async waitForAnswer(
    requestId: string,
    context: {
      threadId: string;
      toolUseId?: string;
      toolInput: Record<string, unknown>;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: Record<string, unknown>) => void,
  ): Promise<{ answers: Record<string, string> } | "timeout"> {
    emitEvent(EventName.QUESTION_REQUEST, {
      requestId,
      threadId: context.threadId,
      toolUseId: context.toolUseId ?? "",
      toolInput: context.toolInput,
      timestamp: Date.now(),
    });

    logger.info(
      `[QuestionGate] Emitted QUESTION_REQUEST: ${requestId}`,
    );

    return new Promise((resolve) => {
      this.pending.set(requestId, {
        resolve,
        createdAt: Date.now(),
      });

      context.signal.addEventListener(
        "abort",
        () => {
          if (this.pending.has(requestId)) {
            this.pending.delete(requestId);
            logger.info(`[QuestionGate] Request ${requestId} aborted`);
            resolve("timeout");
          }
        },
        { once: true },
      );
    });
  }

  /**
   * Called when the frontend sends back a QUESTION_RESPONSE via hub socket.
   * Resolves the waiting hook promise.
   */
  resolve(requestId: string, answers: Record<string, string>): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      logger.info(`[QuestionGate] No pending request for ${requestId}, ignoring`);
      return;
    }
    this.pending.delete(requestId);
    logger.info(`[QuestionGate] Resolved ${requestId}`);
    pending.resolve({ answers });
  }

  /** Clean up all pending requests (e.g., on agent shutdown). */
  clear(): void {
    for (const [id] of this.pending) {
      logger.info(`[QuestionGate] Clearing pending request ${id}`);
    }
    for (const [, pending] of this.pending) {
      pending.resolve("timeout");
    }
    this.pending.clear();
  }
}
