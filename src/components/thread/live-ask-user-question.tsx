import { useCallback } from "react";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { parseAllQuestions, parseAskUserQuestionInput } from "@core/types/ask-user-question.js";
import { logger } from "@/lib/logger-client";
import { AskUserQuestionBlock } from "./ask-user-question-block";
import { QuestionCarousel } from "./question-carousel";
import { ToolUseBlock } from "./tool-use-block";
import { useQuestionStore } from "@/entities/questions/store";
import { questionService } from "@/entities/questions/service";

interface LiveAskUserQuestionProps {
  blockId: string;
  blockInput: unknown;
  toolState: ToolExecutionState;
  threadId: string;
  onToolResponse?: (toolId: string, response: string) => void;
}

/**
 * Extract the user's answer from toolState.result, which may be
 * raw JSON like {"questions":[...],"answers":{"Q":"A"}} or a plain string.
 */
function extractAnswer(result: string | undefined, question: string): string | undefined {
  if (!result) return undefined;

  try {
    const parsed = JSON.parse(result);
    if (parsed?.answers && typeof parsed.answers === "object") {
      return parsed.answers[question] ?? Object.values(parsed.answers)[0] as string;
    }
  } catch {
    // Not JSON — return as-is
  }

  return result;
}

/** Extract answers from blockInput when they're embedded (e.g. completed questions). */
function extractAnswerFromInput(blockInput: unknown, question: string): string | undefined {
  if (!blockInput || typeof blockInput !== "object") return undefined;
  const input = blockInput as Record<string, unknown>;
  if (input.answers && typeof input.answers === "object") {
    const answers = input.answers as Record<string, string>;
    return answers[question] ?? Object.values(answers)[0];
  }
  return undefined;
}

/**
 * Renders an AskUserQuestion tool_use block with live question store integration.
 *
 * When a QUESTION_REQUEST is pending in the store for this tool_use block,
 * renders the interactive version connected to questionService.respond().
 * Otherwise falls back to the historical/completed rendering.
 */
export function LiveAskUserQuestion({
  blockId,
  blockInput,
  toolState,
  threadId,
  onToolResponse,
}: LiveAskUserQuestionProps) {
  const questionRequest = useQuestionStore(
    useCallback((s) => s.getRequestByToolUseId(blockId), [blockId]),
  );
  const isLivePending = questionRequest?.status === "pending";
  const isCancelled = questionRequest?.status === "cancelled";

  // Cancelled question — hide the interactive UI entirely
  if (isCancelled) {
    return null;
  }

  // Live pending question — render from store with service callback
  if (isLivePending && questionRequest) {
    const questions = parseAllQuestions(questionRequest.toolInput);

    if (!questions) {
      logger.warn("[LiveAskUserQuestion] Invalid toolInput in question request", {
        toolInput: questionRequest.toolInput,
      });
      return (
        <ToolUseBlock
          id={blockId}
          name="AskUserQuestion"
          input={blockInput as Record<string, unknown>}
          result={toolState.result}
          isError={toolState.isError}
          status={toolState.status}
          threadId={threadId}
        />
      );
    }

    // Multi-question carousel
    if (questions.length > 1) {
      return (
        <QuestionCarousel
          id={blockId}
          questions={questions}
          status="pending"
          onSubmitAll={(answers) => {
            questionService.respond(threadId, questionRequest.requestId, answers);
          }}
        />
      );
    }

    // Single question — use existing component
    const q = questions[0];
    return (
      <AskUserQuestionBlock
        id={blockId}
        question={q.question}
        header={q.header}
        options={q.options}
        allowMultiple={q.multiSelect}
        status="pending"
        onSubmit={(response) => {
          const answers = { [q.question]: response };
          questionService.respond(threadId, questionRequest.requestId, answers);
        }}
      />
    );
  }

  // Historical/completed — render from block input
  const parsed = parseAskUserQuestionInput(blockInput);

  if (!parsed) {
    logger.warn("[LiveAskUserQuestion] Invalid AskUserQuestion input", {
      input: blockInput,
    });
    return (
      <ToolUseBlock
        id={blockId}
        name="AskUserQuestion"
        input={blockInput as Record<string, unknown>}
        result={toolState.result}
        isError={toolState.isError}
        status={toolState.status}
        threadId={threadId}
      />
    );
  }

  // Extract clean answer from result JSON or answers embedded in blockInput
  const cleanResult = extractAnswer(toolState.result, parsed.question)
    ?? extractAnswerFromInput(blockInput, parsed.question);

  return (
    <AskUserQuestionBlock
      id={blockId}
      question={parsed.question}
      header={parsed.header}
      options={parsed.options}
      allowMultiple={parsed.multiSelect}
      status={toolState.status === "complete" ? "answered" : "pending"}
      result={cleanResult}
      onSubmit={(response) => onToolResponse?.(blockId, response)}
    />
  );
}
