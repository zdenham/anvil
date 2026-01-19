import { create } from 'zustand';
import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

export interface QueuedMessage {
  id: string;
  threadId: string;
  content: string;
  timestamp: number;
}

interface QueuedMessagesState {
  // All queued messages, keyed by messageId for O(1) lookup
  messages: Record<string, QueuedMessage>;

  // Actions
  addMessage: (threadId: string, id: string, content: string) => void;
  confirmMessage: (messageId: string) => void;

  // Selectors (as methods for use in components)
  getMessagesForThread: (threadId: string) => QueuedMessage[];
  isMessagePending: (messageId: string) => boolean;
}

export const useQueuedMessagesStore = create<QueuedMessagesState>((set, get) => ({
  messages: {},

  addMessage: (threadId, id, content) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [id]: { id, threadId, content, timestamp: Date.now() },
      },
    }));
  },

  confirmMessage: (messageId) => {
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [messageId]: _, ...rest } = state.messages;
      return { messages: rest };
    });
  },

  getMessagesForThread: (threadId) => {
    const { messages } = get();
    return Object.values(messages)
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  isMessagePending: (messageId) => {
    return messageId in get().messages;
  },
}));

// Selector hook for thread-specific messages (reactive)
// Uses shallow equality on message IDs to prevent infinite re-renders
export function useQueuedMessagesForThread(threadId: string): QueuedMessage[] {
  // Select only the message IDs for this thread - useShallow does shallow comparison
  // so the array reference is stable when contents are the same
  const messageIds = useQueuedMessagesStore(
    useShallow((state) => Object.keys(state.messages).filter(
      (id) => state.messages[id].threadId === threadId
    ))
  );

  // Get the full messages record for deriving the actual messages
  const messages = useQueuedMessagesStore((state) => state.messages);

  // Memoize the derived array based on the stable messageIds
  return useMemo(() => {
    return messageIds
      .map((id) => messages[id])
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messageIds, messages]);
}
