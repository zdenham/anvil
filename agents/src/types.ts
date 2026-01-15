/**
 * Type definitions for agent messages.
 *
 * These types mirror src/lib/types/agent-messages.ts in the frontend.
 * The runner emits JSON messages that conform to these types.
 *
 * For SDK types (TextBlock, ToolUseBlock, etc.), import directly from:
 * @anthropic-ai/sdk/resources/messages
 */

export type {
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages";
