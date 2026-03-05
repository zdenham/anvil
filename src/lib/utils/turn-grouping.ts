import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import type { StoredMessage } from "@core/types/events";

/**
 * A turn represents a single message in the thread.
 * Each MessageParam maps to exactly one Turn.
 */
export interface Turn {
  type: "user" | "assistant";
  message: MessageParam;
  /** Stable ID of this message (from StoredMessage.id) */
  messageId: string;
}

/**
 * Group messages into turns for rendering.
 * Simple 1:1 mapping - each StoredMessage becomes one Turn.
 *
 * Messages are StoredMessage instances (MessageParam + id).
 * The function accepts MessageParam[] for type compatibility but
 * expects the actual objects to carry an `id` field.
 *
 * @param messages - StoredMessage array from ThreadState
 * @returns Array of turns keyed by stable message ID
 */
export function groupMessagesIntoTurns(messages: StoredMessage[]): Turn[] {
  return messages.map((msg) => ({
    type: msg.role as "user" | "assistant",
    message: msg as unknown as MessageParam,
    messageId: msg.id,
  }));
}

/**
 * Check if a turn is still being streamed.
 *
 * @param turn - The turn to check
 * @param isLastTurn - Whether this is the last turn in the list
 * @param threadStreaming - Whether the thread is currently streaming
 */
export function isTurnStreaming(
  turn: Turn,
  isLastTurn: boolean,
  threadStreaming: boolean
): boolean {
  return turn.type === "assistant" && isLastTurn && threadStreaming;
}

/**
 * Get the text content from a user turn.
 * Handles both string content and array content with text blocks.
 */
export function getUserTurnPrompt(turn: Turn): string {
  if (turn.type !== "user") return "";

  const content = turn.message.content;

  // String content - simple case
  if (typeof content === "string") {
    return content;
  }

  // Array content - find text blocks (tool_result blocks are not user prompts)
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text") {
        return block.text;
      }
    }
  }

  return "";
}

/**
 * Check if a user turn contains only tool results (no user prompt text).
 * These are "invisible" turns in the UI - tool results are shown with tool_use.
 */
export function isToolResultOnlyTurn(turn: Turn): boolean {
  if (turn.type !== "user") return false;

  const content = turn.message.content;

  // String content is never tool-result-only
  if (typeof content === "string") return false;

  // Check if all blocks are tool_result
  if (Array.isArray(content)) {
    return content.every((block) => block.type === "tool_result");
  }

  return false;
}

/**
 * Check if a user turn is a system-injected message (not from the human user).
 * These are messages like permission mode change notifications that should be
 * hidden from the UI but remain in state.json for the agent's context.
 */
export function isSystemInjectedTurn(turn: Turn): boolean {
  if (turn.type !== "user") return false;
  const content = turn.message.content;
  if (typeof content === "string") return content.startsWith("[System] ");
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && block.text.startsWith("[System] ")) return true;
    }
  }
  return false;
}

/**
 * Get assistant message content blocks.
 */
export function getAssistantContent(turn: Turn): ContentBlock[] {
  if (turn.type !== "assistant") return [];

  const content = turn.message.content;
  if (Array.isArray(content)) {
    return content as ContentBlock[];
  }

  // String content (shouldn't happen for assistant, but handle gracefully)
  if (typeof content === "string") {
    return [{ type: "text", text: content, citations: null }] as ContentBlock[];
  }

  return [];
}
