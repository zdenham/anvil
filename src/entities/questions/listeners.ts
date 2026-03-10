import { EventName, type EventPayloads } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { useQuestionStore } from "./store.js";
import { logger } from "@/lib/logger-client.js";

export function setupQuestionListeners(): () => void {
  const handleRequest = (payload: EventPayloads[typeof EventName.QUESTION_REQUEST]) => {
    logger.info("[QuestionListener] Received question request:", payload.requestId);
    useQuestionStore.getState().addRequest({
      requestId: payload.requestId,
      threadId: payload.threadId,
      toolUseId: payload.toolUseId,
      toolInput: payload.toolInput,
      timestamp: payload.timestamp,
      status: "pending",
    });
  };

  const handleCompleted = ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    useQuestionStore.getState()._applyClearThread(threadId);
  };

  const handleError = ({ threadId }: EventPayloads[typeof EventName.AGENT_ERROR]) => {
    useQuestionStore.getState()._applyClearThread(threadId);
  };

  eventBus.on(EventName.QUESTION_REQUEST, handleRequest);
  eventBus.on(EventName.AGENT_COMPLETED, handleCompleted);
  eventBus.on(EventName.AGENT_ERROR, handleError);

  return () => {
    eventBus.off(EventName.QUESTION_REQUEST, handleRequest);
    eventBus.off(EventName.AGENT_COMPLETED, handleCompleted);
    eventBus.off(EventName.AGENT_ERROR, handleError);
  };
}
