import type {
  MessageParam,
  ContentBlock,
  ServerToolUseBlock,
  WebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/messages";
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
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
  /** Working directory for resolving relative file paths in markdown */
  workingDirectory?: string;
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
  threadId,
  workingDirectory,
}: AssistantMessageProps) {
  const message = messages[messageIndex];
  const content = (message.content as ContentBlock[]) ?? [];

  return (
    <article role="article" aria-label="Assistant response" className="group">
      <div className="flex gap-3">

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5">
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
                    workingDirectory={workingDirectory}
                  />
                );

              case "thinking":
                return (
                  <ThinkingBlock key={`thinking-${index}`} content={block.thinking} />
                );

              case "tool_use": {
                // Defensive: handle missing toolStates (old state files) or missing entry
                const state = toolStates?.[block.id] ?? { status: "running" as const };

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
                        threadId={threadId}
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
                      threadId={threadId}
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
                    threadId={threadId}
                  />
                );
              }

              // Handle server-side tool use (e.g., web_search)
              // See: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
              case "server_tool_use": {
                const serverBlock = block as ServerToolUseBlock;

                // Find the corresponding web_search_tool_result block in the content array
                // Results come as a separate block with matching tool_use_id
                const resultBlock = content.find(
                  (b): b is WebSearchToolResultBlock =>
                    b.type === "web_search_tool_result" &&
                    (b as WebSearchToolResultBlock).tool_use_id === serverBlock.id
                ) as WebSearchToolResultBlock | undefined;

                // Determine status based on whether we have results
                const hasResult = !!resultBlock;
                const isError = resultBlock?.content &&
                  !Array.isArray(resultBlock.content) &&
                  (resultBlock.content as { type?: string }).type === "web_search_tool_result_error";

                // Serialize the result content for the tool block
                const resultString = resultBlock
                  ? JSON.stringify(resultBlock.content)
                  : undefined;

                // Use the specialized WebSearchToolBlock
                const SpecializedBlock = getSpecializedToolBlock(serverBlock.name);
                if (SpecializedBlock) {
                  return (
                    <SpecializedBlock
                      key={serverBlock.id}
                      id={serverBlock.id}
                      name={serverBlock.name}
                      input={serverBlock.input as Record<string, unknown>}
                      result={resultString}
                      isError={isError}
                      status={hasResult ? "complete" : "running"}
                      threadId={threadId}
                    />
                  );
                }

                // Fallback to generic ToolUseBlock
                return (
                  <ToolUseBlock
                    key={serverBlock.id}
                    id={serverBlock.id}
                    name={serverBlock.name}
                    input={serverBlock.input as Record<string, unknown>}
                    result={resultString}
                    isError={isError}
                    status={hasResult ? "complete" : "running"}
                    threadId={threadId}
                  />
                );
              }

              // web_search_tool_result blocks are handled by the server_tool_use case above
              // We skip them here to avoid duplicate rendering
              case "web_search_tool_result":
                return null;

              default:
                return null;
            }
          })}
        </div>
      </div>
    </article>
  );
}
