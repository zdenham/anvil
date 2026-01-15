import { MockClaudeClient } from "./mock-claude-client.js";
import { MOCK_LLM_VAR, type MockToolCall } from "./mock-llm.js";
import { logger } from "../lib/logger.js";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

// Re-export SDK types needed by consumers
export type { SDKAssistantMessage, SDKUserMessage, SDKResultMessage, SDKMessage };

/**
 * Tool executor function type.
 * Takes a tool name and input, returns the tool result as a string.
 * Optional - if not provided, mock results from script are used.
 */
export type ToolExecutor = (
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string
) => Promise<string>;

/**
 * Options for mockQuery, matching the subset of SDK options we need.
 */
export interface MockQueryOptions {
  /** Tool executor for running actual tools during mock mode (optional) */
  toolExecutor?: ToolExecutor;
  /** PostToolUse hook callback */
  onToolResult?: (toolName: string, toolUseId: string, result: string) => Promise<void>;
  /** PostToolUseFailure hook callback */
  onToolFailure?: (toolName: string, toolUseId: string, error: string) => Promise<void>;
}

/**
 * Check if mock mode is enabled.
 */
export function isMockModeEnabled(): boolean {
  return !!process.env[MOCK_LLM_VAR];
}

/**
 * Get the mock script path from environment.
 */
export function getMockScriptPath(): string | undefined {
  return process.env[MOCK_LLM_VAR];
}

/**
 * Mock query function that replaces the SDK's query() in test mode.
 *
 * Returns an async generator that yields messages in the same format
 * as the real SDK, but uses scripted responses from the mock script.
 *
 * Tool results can come from:
 * 1. Mock results in the script (mockResult/mockError on MockToolCall)
 * 2. A custom toolExecutor if provided
 * 3. Default "OK" if neither is specified
 *
 * @param options - Mock query options including hooks
 */
export async function* mockQuery(
  options: MockQueryOptions = {}
): AsyncGenerator<SDKMessage, void, unknown> {
  const scriptPath = getMockScriptPath();
  if (!scriptPath) {
    throw new Error(`Mock mode enabled but ${MOCK_LLM_VAR} not set`);
  }

  const client = new MockClaudeClient(scriptPath);
  logger.info(`[mockQuery] Running in mock mode with script: ${scriptPath}`);

  try {
    while (true) {
      const response = client.nextResponse(false);

      // Script exhausted - we're done
      if (!response) {
        break;
      }

      // Check for error response
      if (response.error) {
        yield client.buildErrorResult(response.error);
        return;
      }

      // Build and yield the assistant message
      const assistantMsg = client.buildAssistantMessage(response);
      yield assistantMsg;

      // If there are tool calls, process them
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Build a map of tool call details from the script
        const toolCallMap = new Map<string, MockToolCall>();
        for (const tc of response.toolCalls) {
          // Find the matching tool_use block to get the generated ID
          const block = assistantMsg.message.content.find(
            (b): b is ToolUseBlock =>
              b.type === "tool_use" && b.name === tc.name && (tc.id === undefined || b.id === tc.id)
          );
          if (block) {
            toolCallMap.set(block.id, tc);
          }
        }

        // Process each tool call
        for (const block of assistantMsg.message.content) {
          if (block.type === "tool_use") {
            const toolBlock = block as ToolUseBlock;
            const scriptToolCall = toolCallMap.get(toolBlock.id);

            // Check for mock error
            if (scriptToolCall?.mockError) {
              // Yield user message with error result
              const errorUserMsg = client.buildUserMessage(
                toolBlock.id,
                scriptToolCall.mockError,
                true
              );
              yield errorUserMsg;

              if (options.onToolFailure) {
                await options.onToolFailure(toolBlock.name, toolBlock.id, scriptToolCall.mockError);
              }
              continue;
            }

            // Get tool result (from script, executor, or default)
            let result: string;
            if (scriptToolCall?.mockResult !== undefined) {
              result = scriptToolCall.mockResult;
            } else if (options.toolExecutor) {
              try {
                result = await options.toolExecutor(
                  toolBlock.name,
                  toolBlock.input as Record<string, unknown>,
                  toolBlock.id
                );
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                // Yield user message with error result
                const executorErrorUserMsg = client.buildUserMessage(toolBlock.id, errorMsg, true);
                yield executorErrorUserMsg;

                if (options.onToolFailure) {
                  await options.onToolFailure(toolBlock.name, toolBlock.id, errorMsg);
                }
                continue;
              }
            } else {
              // Default mock result
              result = "OK";
            }

            // Yield user message with tool result (matches SDK message sequence)
            const userMsg = client.buildUserMessage(toolBlock.id, result, false);
            yield userMsg;

            // Call the success hook if provided
            if (options.onToolResult) {
              await options.onToolResult(toolBlock.name, toolBlock.id, result);
            }
          }
        }
      }
    }

    // Yield success result
    yield client.buildResultMessage();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[mockQuery] Error: ${errorMsg}`);
    yield client.buildErrorResult(errorMsg);
  }
}
