import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { useQuestionStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

export function setupQuestionListeners(): void {
  // Handle incoming question requests from agent
  eventBus.on(EventName.QUESTION_REQUEST, (payload) => {
    logger.info("[QuestionListener] Received question request:", payload.requestId);

    useQuestionStore.getState().addRequest({
      requestId: payload.requestId,
      threadId: payload.threadId,
      toolUseId: payload.toolUseId,
      toolInput: payload.toolInput,
      timestamp: payload.timestamp,
      status: "pending",
    });
  });

  // Clean up on agent completion
  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
    useQuestionStore.getState()._applyClearThread(threadId);
  });

  // Clean up on agent error
  eventBus.on(EventName.AGENT_ERROR, ({ threadId }) => {
    useQuestionStore.getState()._applyClearThread(threadId);
  });
}
