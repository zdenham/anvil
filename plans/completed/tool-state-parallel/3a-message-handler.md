# Stream 3A: MessageHandler Service

**Depends on:** Stream 2A (output.ts functions)
**Blocks:** Stream 4 (integration)
**Parallel with:** Stream 3B

## Goal

Create dedicated service for parsing SDK messages and routing to state updates.

## File to Create

`agents/src/runners/message-handler.ts`

## Implementation

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  appendAssistantMessage,
  markToolRunning,
  markToolComplete,
  complete,
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
  handle(message: SDKMessage): boolean {
    switch (message.type) {
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

  private handleAssistant(msg: SDKAssistantMessage): boolean {
    // Mark all tool_use blocks as running
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        markToolRunning(block.id, block.name);
      }
    }

    appendAssistantMessage({
      role: "assistant",
      content: msg.message.content,
    });

    return true;
  }

  private handleUser(msg: SDKUserMessage): boolean {
    if (!msg.parent_tool_use_id) {
      logger.debug("[MessageHandler] Ignoring non-tool user message");
      return true;
    }

    const toolUseId = msg.parent_tool_use_id;
    const result = this.extractToolResult(msg);
    const isError = this.detectToolError(msg);

    markToolComplete(toolUseId, result, isError);

    return true;
  }

  private handleResult(msg: SDKResultMessage): boolean {
    switch (msg.subtype) {
      case "success":
        complete({
          durationApiMs: msg.duration_api_ms,
          totalCostUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        });
        break;
      case "error_during_execution":
        logger.warn(`[MessageHandler] Execution error: ${msg.error_message ?? "unknown"}`);
        break;
      case "error_max_turns":
        logger.warn(`[MessageHandler] Max turns reached: ${msg.num_turns}`);
        break;
      default:
        if (!msg.is_error) {
          complete({
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
```

## Unit Tests

Create `agents/src/runners/message-handler.test.ts` with tests for:
- `handleAssistant` marks tool_use blocks as running
- `handleUser` marks tools complete with result
- `handleUser` detects errors
- `handleUser` ignores non-tool user messages
- `handleResult` calls complete on success
- `handleResult` does not call complete on error

See main plan for full test implementation.

## Verification

```bash
pnpm typecheck
pnpm test agents/src/runners/message-handler.test.ts
```
