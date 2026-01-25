import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionState } from "@/lib/types/agent-messages";
import { parseAskUserQuestionInput } from "@core/types/ask-user-question.js";
import { logger } from "@/lib/logger-client";
import { TextBlock } from "./text-block";
import { ThinkingBlock } from "./thinking-block";
import { ToolUseBlock } from "./tool-use-block";
import { AskUserQuestionBlock } from "./ask-user-question-block";
import { getSpecializedToolBlock } from "./tool-blocks";

interface AssistantMessageProps {
  /** The full messages array (needed to look up tool results from next message) */
  messages: MessageParam[];
  /** Index of this assistant message in the messages array */
  messageIndex: number;
  /** Whether this turn is still streaming */
  isStreaming?: boolean;
  /** Explicit tool states from the agent (optional for backwards compatibility with old state files) */
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
}

/**
 * Container for a single assistant turn.
 * Renders mixed content: text, thinking, tool use.
 */
export function AssistantMessage({
  messages,
  messageIndex,
  isStreaming = false,
  toolStates,
  onToolResponse,
}: AssistantMessageProps) {
  const message = messages[messageIndex];
  const content = (message.content as ContentBlock[]) ?? [];

  return (
    <article role="article" aria-label="Assistant response" className="group">
      <div className="flex gap-3">

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          {content.map((block, index) => {
            const isLastBlock = index === content.length - 1;
            const showCursor = isStreaming && isLastBlock;

            switch (block.type) {
              case "text":
                return (
                  <TextBlock
                    key={`text-${index}`}
                    content={block.text}
                    isStreaming={showCursor}
                  />
                );

              case "thinking":
                return (
                  <ThinkingBlock key={`thinking-${index}`} content={block.thinking} />
                );

              case "tool_use": {
                // Defensive: handle missing toolStates (old state files) or missing entry
                const state = toolStates?.[block.id] ?? { status: "running" as const };

                // DEBUG: Log tool state lookup to diagnose spinner bug
                logger.info(`[AssistantMessage] Tool state lookup`, {
                  toolId: block.id,
                  toolName: block.name,
                  hasToolStates: !!toolStates,
                  toolStatesKeys: toolStates ? Object.keys(toolStates) : [],
                  foundState: !!toolStates?.[block.id],
                  resolvedStatus: state.status,
                });

                // Handle AskUserQuestion specially with interactive UI
                if (block.name === "AskUserQuestion") {
                  const parsed = parseAskUserQuestionInput(block.input);

                  if (!parsed) {
                    logger.warn("[AssistantMessage] Invalid AskUserQuestion input", {
                      input: block.input,
                    });
                    // Graceful fallback: render as generic tool block
                    return (
                      <ToolUseBlock
                        key={block.id}
                        id={block.id}
                        name={block.name}
                        input={block.input as Record<string, unknown>}
                        result={state.result}
                        isError={state.isError}
                        status={state.status}
                      />
                    );
                  }

                  return (
                    <AskUserQuestionBlock
                      key={block.id}
                      id={block.id}
                      question={parsed.question}
                      header={parsed.header}
                      options={parsed.options}
                      allowMultiple={parsed.multiSelect}
                      status={state.status === "complete" ? "answered" : "pending"}
                      result={state.result}
                      onSubmit={(response) => onToolResponse?.(block.id, response)}
                    />
                  );
                }

                // Check for specialized tool block component
                const SpecializedBlock = getSpecializedToolBlock(block.name);
                if (SpecializedBlock) {
                  return (
                    <SpecializedBlock
                      key={block.id}
                      id={block.id}
                      name={block.name}
                      input={block.input as Record<string, unknown>}
                      result={state.result}
                      isError={state.isError}
                      status={state.status}
                    />
                  );
                }

                return (
                  <ToolUseBlock
                    key={block.id}
                    id={block.id}
                    name={block.name}
                    input={block.input as Record<string, unknown>}
                    result={state.result}
                    isError={state.isError}
                    status={state.status}
                  />
                );
              }

              default:
                return null;
            }
          })}
        </div>
      </div>
    </article>
  );
}
