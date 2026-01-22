import { useMemo } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";

/**
 * Get the last user message from a thread's turns array.
 * The turns array on ThreadMetadata already contains user prompts.
 */
function getLastUserMessage(thread: ThreadMetadata): string {
  if (!thread.turns || thread.turns.length === 0) {
    return thread.id.slice(0, 8); // Fallback to truncated ID
  }

  // Get the last turn with a prompt (user message)
  const lastTurn = thread.turns[thread.turns.length - 1];
  if (!lastTurn?.prompt) {
    return thread.id.slice(0, 8);
  }

  // Truncate long messages for display
  const maxLength = 100;
  if (lastTurn.prompt.length > maxLength) {
    return lastTurn.prompt.slice(0, maxLength) + "...";
  }

  return lastTurn.prompt;
}

/**
 * Hook to get the last user message for each thread.
 * Uses the turns array on ThreadMetadata which already contains user prompts.
 *
 * @param threads - Array of thread metadata
 * @returns Record mapping thread IDs to their last user message
 */
export function useThreadLastMessages(
  threads: ThreadMetadata[]
): Record<string, string> {
  return useMemo(() => {
    const messages: Record<string, string> = {};

    for (const thread of threads) {
      messages[thread.id] = getLastUserMessage(thread);
    }

    return messages;
  }, [threads]);
}
