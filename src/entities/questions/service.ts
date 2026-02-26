import { sendToAgent } from "@/lib/agent-service";
import { useQuestionStore } from "./store";
import { logger } from "@/lib/logger-client";

export const questionService = {
  /**
   * Submit answers to a question request.
   * Sends response to agent and updates store.
   */
  async respond(
    threadId: string,
    requestId: string,
    answers: Record<string, string>,
  ): Promise<void> {
    logger.info(`[questionService] Responding to ${requestId}`);

    // Optimistically mark answered in store
    useQuestionStore.getState().markAnswered(requestId, answers);

    try {
      await sendToAgent(threadId, {
        type: "question_response",
        payload: { requestId, answers },
      });
    } catch (error) {
      logger.error("[questionService] Failed to send response:", error);
      throw error;
    }
  },

  /**
   * Cancel a pending question (e.g., user sent a message instead).
   * Sends cancellation to agent so the hook unblocks.
   */
  async cancel(threadId: string, requestId: string): Promise<void> {
    logger.info(`[questionService] Cancelling ${requestId}`);

    useQuestionStore.getState().markCancelled(requestId);

    try {
      await sendToAgent(threadId, {
        type: "question_cancelled",
        payload: { requestId },
      });
    } catch (error) {
      logger.error("[questionService] Failed to send cancellation:", error);
    }
  },
};
