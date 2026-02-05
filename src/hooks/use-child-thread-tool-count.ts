/**
 * Hook to count tool calls in a child thread.
 *
 * Calculates the number of tool_use blocks in the thread's messages
 * to display in the SubAgentReferenceBlock.
 */

import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";
import type { ContentBlock, MessageParam } from "@anthropic-ai/sdk/resources/messages";

/**
 * Count tool_use blocks in messages.
 * Only counts tool calls from assistant messages.
 */
function countToolCalls(messages: MessageParam[]): number {
  let count = 0;

  for (const message of messages) {
    if (message.role !== "assistant") continue;

    const content = message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as ContentBlock[]) {
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        count++;
      }
    }
  }

  return count;
}

/**
 * Hook to get the tool call count for a child thread.
 *
 * @param childThreadId - The ID of the child thread
 * @returns The number of tool calls in the child thread
 */
export function useChildThreadToolCount(childThreadId: string): number {
  const threadState = useThreadStore((state) => state.threadStates[childThreadId]);

  return useMemo(() => {
    if (!threadState?.messages) {
      return 0;
    }
    return countToolCalls(threadState.messages);
  }, [threadState?.messages]);
}
