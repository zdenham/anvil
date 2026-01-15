import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  appendAssistantMessage,
  appendUserMessage,
  markToolRunning,
  markToolComplete,
  complete,
  setSessionId,
} from "../output.js";
import { logger } from "../lib/logger.js";

/**
 * MessageHandler processes SDK messages and updates thread state.
 *
 * Single responsibility: Route SDK messages to appropriate state updates.
 * Does NOT handle side effects (hooks handle those).
 */
export class MessageHandler {
  /**
   * Process a single SDK message.
   * Returns true if processing should continue.
   */
  async handle(message: SDKMessage): Promise<boolean> {
    switch (message.type) {
      case "system":
        return this.handleSystem(message);
      case "assistant":
        return this.handleAssistant(message);
      case "user":
        return this.handleUser(message);
      case "result":
        return this.handleResult(message);
      case "tool_progress":
        return this.handleToolProgress(message);
      default:
        logger.debug(`[MessageHandler] Ignoring message type: ${(message as { type: string }).type}`);
        return true;
    }
  }

  private async handleSystem(msg: SDKMessage & { type: "system" }): Promise<boolean> {
    // Capture session ID from init message for future resumption
    if (msg.subtype === "init") {
      logger.info(`[MessageHandler] Session started: ${msg.session_id}`);
      await setSessionId(msg.session_id);
    }
    return true;
  }

  private async handleAssistant(msg: SDKAssistantMessage): Promise<boolean> {
    // Log the message type for debugging consecutive messages
    const blockTypes = msg.message.content.map(b => b.type);
    logger.debug(
      `[MessageHandler] handleAssistant: blocks=[${blockTypes.join(",")}], ` +
      `stop_reason=${msg.message.stop_reason}`
    );

    // Mark all tool_use blocks as running
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        await markToolRunning(block.id, block.name);
      }
    }

    // Cast content type - BetaContentBlock[] is structurally compatible with ContentBlockParam[]
    await appendAssistantMessage({
      role: "assistant",
      content: msg.message.content as Parameters<typeof appendAssistantMessage>[0]["content"],
    });

    return true;
  }

  private async handleUser(msg: SDKUserMessage): Promise<boolean> {
    // Tool result message - existing behavior
    if (msg.parent_tool_use_id) {
      const toolUseId = msg.parent_tool_use_id;
      const result = this.extractToolResult(msg);
      const isError = this.detectToolError(msg);

      logger.debug(
        `[MessageHandler] handleUser: tool_result for toolUseId=${toolUseId}, ` +
        `isError=${isError}, result_len=${result.length}`
      );

      await markToolComplete(toolUseId, result, isError);
      return true;
    }

    // Queued user message (not synthetic, not tool result)
    // isSynthetic is explicitly set to false for queued messages from stdin stream.
    // The initial prompt has isSynthetic: true, so it won't be appended here
    // (runAgentLoop already calls appendUserMessage for it).
    if (msg.isSynthetic === false) {
      const content = typeof msg.message.content === "string"
        ? msg.message.content
        : (msg.message.content as Array<{ type: string; text?: string }>)
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map(block => block.text)
            .join("\n");

      await appendUserMessage(content);
      logger.info("[MessageHandler] Processed queued user message");
      return true;
    }

    // Other non-tool user messages (synthetic or undefined) - ignore
    logger.debug("[MessageHandler] Ignoring synthetic/initial user message");
    return true;
  }

  private async handleResult(msg: SDKResultMessage): Promise<boolean> {
    switch (msg.subtype) {
      case "success":
        await complete({
          durationApiMs: msg.duration_api_ms,
          totalCostUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        });
        break;
      case "error_during_execution": {
        const errorMsg = "errors" in msg && msg.errors.length > 0
          ? msg.errors[0]
          : "unknown";
        logger.warn(`[MessageHandler] Execution error: ${errorMsg}`);
        break;
      }
      case "error_max_turns":
        logger.warn(`[MessageHandler] Max turns reached: ${msg.num_turns}`);
        break;
      default:
        if (!msg.is_error) {
          await complete({
            durationApiMs: msg.duration_api_ms,
            totalCostUsd: msg.total_cost_usd,
            numTurns: msg.num_turns,
          });
        }
    }
    return false;  // Stop processing
  }

  private handleToolProgress(msg: SDKToolProgressMessage): boolean {
    logger.debug(
      `[MessageHandler] Tool ${msg.tool_name} running for ${msg.elapsed_time_seconds}s`
    );
    return true;
  }

  private extractToolResult(msg: SDKUserMessage): string {
    if (msg.tool_use_result !== undefined) {
      return typeof msg.tool_use_result === "string"
        ? msg.tool_use_result
        : JSON.stringify(msg.tool_use_result);
    }

    const messageParam = msg.message;
    if (!messageParam) return "";

    const content = messageParam.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null && "type" in block) {
          if (block.type === "tool_result" && "content" in block) {
            const resultContent = block.content;
            return typeof resultContent === "string"
              ? resultContent
              : JSON.stringify(resultContent);
          }
        }
      }
    }
    return "";
  }

  private detectToolError(msg: SDKUserMessage): boolean {
    const result = msg.tool_use_result;
    if (typeof result === "object" && result !== null && "is_error" in result) {
      return Boolean(result.is_error);
    }

    const messageParam = msg.message;
    if (!messageParam) return false;

    const content = messageParam.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result" &&
          "is_error" in block
        ) {
          return Boolean(block.is_error);
        }
      }
    }

    return false;
  }
}
