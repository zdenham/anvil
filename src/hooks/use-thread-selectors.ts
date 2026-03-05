import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useThreadStore } from "@/entities/threads/store";
import type { ToolExecutionState, StoredMessage } from "@core/types/events";

/**
 * Select a single message by its stable ID from a thread's render state.
 * Returns undefined if the message doesn't exist yet.
 *
 * Path: threadStates[threadId].messages.find(m => m.id === messageId)
 */
export function useMessage(threadId: string, messageId: string): StoredMessage | undefined {
  return useThreadStore(
    useCallback(
      (s) => s.threadStates[threadId]?.messages?.find((m: StoredMessage) => m.id === messageId),
      [threadId, messageId],
    ),
  );
}

/**
 * Select content blocks for a specific message by its stable ID.
 * Uses referential equality -- see phase-1 plan "Why useShallow" section.
 *
 * Path: threadStates[threadId].messages.find(m => m.id === messageId).content
 */
export function useMessageContent(threadId: string, messageId: string): unknown[] {
  return useThreadStore(
    useShallow(
      useCallback(
        (s) => {
          const msg = s.threadStates[threadId]?.messages?.find((m: StoredMessage) => m.id === messageId);
          return Array.isArray(msg?.content) ? msg.content : [];
        },
        [threadId, messageId],
      ),
    ),
  );
}

/**
 * Select tool execution state for a specific tool use ID.
 * Only re-renders when THIS tool's state changes.
 *
 * Uses useShallow because HYDRATE replaces all tool state references
 * even when content is identical. useShallow does a one-level-deep
 * comparison which is sufficient since ToolExecutionState properties
 * are all primitives (status, result, isError, toolName).
 *
 * Path: threadStates[threadId].toolStates[toolUseId]
 */
export function useToolState(threadId: string, toolUseId: string): ToolExecutionState {
  return useThreadStore(
    useShallow(
      useCallback(
        (s) => s.threadStates[threadId]?.toolStates?.[toolUseId] ?? { status: "running" as const },
        [threadId, toolUseId],
      ),
    ),
  );
}
