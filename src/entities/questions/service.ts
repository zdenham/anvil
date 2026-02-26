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
};
