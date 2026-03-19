// @vitest-environment node
/**
 * Queued Messages Store Tests
 *
 * Tests the Zustand store for queued messages.
 * This is the single source of truth for queued message state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useQueuedMessagesStore } from '@/stores/queued-messages-store';

describe('Queued Messages Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useQueuedMessagesStore.setState({ messages: {} });
  });

  describe('addMessage', () => {
    it('adds message with correct threadId', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Hello');

      expect(store.isMessagePending('msg-1')).toBe(true);
      expect(store.getMessagesForThread('thread-A')).toHaveLength(1);
      expect(store.getMessagesForThread('thread-B')).toHaveLength(0);
    });

    it('stores message content correctly', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Hello World');

      const messages = store.getMessagesForThread('thread-A');
      expect(messages[0].content).toBe('Hello World');
      expect(messages[0].id).toBe('msg-1');
      expect(messages[0].threadId).toBe('thread-A');
    });

    it('adds timestamp automatically', () => {
      const before = Date.now();
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Hello');
      const after = Date.now();

      const messages = store.getMessagesForThread('thread-A');
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(messages[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('confirmMessage', () => {
    it('removes only the specified message', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'First');
      store.addMessage('thread-A', 'msg-2', 'Second');

      store.confirmMessage('msg-1');

      expect(store.isMessagePending('msg-1')).toBe(false);
      expect(store.isMessagePending('msg-2')).toBe(true);
    });

    it('handles confirming non-existent message gracefully', () => {
      const store = useQueuedMessagesStore.getState();
      expect(() => store.confirmMessage('non-existent')).not.toThrow();
    });

    it('is idempotent (confirming same message twice is safe)', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Message');

      store.confirmMessage('msg-1');
      expect(store.isMessagePending('msg-1')).toBe(false);

      // Second confirm should not throw
      expect(() => store.confirmMessage('msg-1')).not.toThrow();
    });
  });

  describe('getMessagesForThread', () => {
    it('returns only messages for specified thread', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-a1', 'A1');
      store.addMessage('thread-B', 'msg-b1', 'B1');
      store.addMessage('thread-A', 'msg-a2', 'A2');

      const threadAMessages = store.getMessagesForThread('thread-A');
      expect(threadAMessages).toHaveLength(2);
      expect(threadAMessages.map(m => m.id)).toEqual(['msg-a1', 'msg-a2']);

      const threadBMessages = store.getMessagesForThread('thread-B');
      expect(threadBMessages).toHaveLength(1);
    });

    it('returns messages sorted by timestamp', () => {
      // Set messages directly with specific timestamps
      useQueuedMessagesStore.setState({
        messages: {
          'msg-3': { id: 'msg-3', threadId: 'thread-A', content: 'Third', timestamp: 3000 },
          'msg-1': { id: 'msg-1', threadId: 'thread-A', content: 'First', timestamp: 1000 },
          'msg-2': { id: 'msg-2', threadId: 'thread-A', content: 'Second', timestamp: 2000 },
        }
      });

      const store = useQueuedMessagesStore.getState();
      const messages = store.getMessagesForThread('thread-A');
      expect(messages.map(m => m.content)).toEqual(['First', 'Second', 'Third']);
    });

    it('returns empty array for thread with no messages', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Hello');

      expect(store.getMessagesForThread('thread-B')).toEqual([]);
    });
  });

  describe('isMessagePending', () => {
    it('returns true for pending messages', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-pending', 'Pending message');

      expect(store.isMessagePending('msg-pending')).toBe(true);
    });

    it('returns false for non-existent messages', () => {
      const store = useQueuedMessagesStore.getState();
      expect(store.isMessagePending('non-existent')).toBe(false);
    });

    it('returns false after message is confirmed', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Message');

      expect(store.isMessagePending('msg-1')).toBe(true);
      store.confirmMessage('msg-1');
      expect(store.isMessagePending('msg-1')).toBe(false);
    });
  });

  describe('removeMessage', () => {
    it('removes the specified message', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'First');
      store.addMessage('thread-A', 'msg-2', 'Second');

      store.removeMessage('msg-1');

      expect(store.isMessagePending('msg-1')).toBe(false);
      expect(store.isMessagePending('msg-2')).toBe(true);
    });

    it('handles removing non-existent message gracefully', () => {
      const store = useQueuedMessagesStore.getState();
      expect(() => store.removeMessage('non-existent')).not.toThrow();
    });
  });

  describe('drainThread', () => {
    it('returns all pending messages for a thread sorted by timestamp', () => {
      useQueuedMessagesStore.setState({
        messages: {
          'msg-3': { id: 'msg-3', threadId: 'thread-A', content: 'Third', timestamp: 3000 },
          'msg-1': { id: 'msg-1', threadId: 'thread-A', content: 'First', timestamp: 1000 },
          'msg-2': { id: 'msg-2', threadId: 'thread-A', content: 'Second', timestamp: 2000 },
        }
      });

      const store = useQueuedMessagesStore.getState();
      const drained = store.drainThread('thread-A');

      expect(drained).toHaveLength(3);
      expect(drained.map(m => m.content)).toEqual(['First', 'Second', 'Third']);
    });

    it('atomically removes drained messages from store', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'A1');
      store.addMessage('thread-B', 'msg-2', 'B1');

      store.drainThread('thread-A');

      expect(store.isMessagePending('msg-1')).toBe(false);
      expect(store.isMessagePending('msg-2')).toBe(true);
    });

    it('second call returns empty array (atomic drain)', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-1', 'Hello');

      const first = store.drainThread('thread-A');
      const second = store.drainThread('thread-A');

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it('returns empty array for thread with no messages', () => {
      const store = useQueuedMessagesStore.getState();
      const drained = store.drainThread('empty-thread');
      expect(drained).toEqual([]);
    });

    it('does not affect messages from other threads', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-a', 'A');
      store.addMessage('thread-B', 'msg-b', 'B');
      store.addMessage('thread-C', 'msg-c', 'C');

      store.drainThread('thread-A');

      expect(store.getMessagesForThread('thread-B')).toHaveLength(1);
      expect(store.getMessagesForThread('thread-C')).toHaveLength(1);
    });
  });

  describe('thread isolation', () => {
    it('confirming messages from one thread does not affect others', () => {
      const store = useQueuedMessagesStore.getState();
      store.addMessage('thread-A', 'msg-a', 'A');
      store.addMessage('thread-B', 'msg-b', 'B');

      store.confirmMessage('msg-a');

      expect(store.getMessagesForThread('thread-A')).toHaveLength(0);
      expect(store.getMessagesForThread('thread-B')).toHaveLength(1);
    });

    it('messages from different threads are isolated', () => {
      const store = useQueuedMessagesStore.getState();

      // Add messages for different threads
      store.addMessage('thread-A', 'msg-a1', 'A1');
      store.addMessage('thread-B', 'msg-b1', 'B1');
      store.addMessage('thread-A', 'msg-a2', 'A2');

      // All should be pending
      expect(store.isMessagePending('msg-a1')).toBe(true);
      expect(store.isMessagePending('msg-b1')).toBe(true);
      expect(store.isMessagePending('msg-a2')).toBe(true);

      // Confirm all thread-A messages
      store.confirmMessage('msg-a1');
      store.confirmMessage('msg-a2');

      // Only thread-B message should remain
      expect(store.isMessagePending('msg-a1')).toBe(false);
      expect(store.isMessagePending('msg-b1')).toBe(true);
      expect(store.isMessagePending('msg-a2')).toBe(false);
    });

    it('clearing one thread does not affect others', () => {
      const store = useQueuedMessagesStore.getState();

      // Set up multiple threads with multiple messages each
      const threads = ['thread-1', 'thread-2', 'thread-3'];
      let msgId = 0;

      for (const threadId of threads) {
        for (let i = 0; i < 3; i++) {
          store.addMessage(threadId, `msg-${msgId}`, `Message ${msgId}`);
          msgId++;
        }
      }

      // Should have 9 total messages
      expect(Object.keys(useQueuedMessagesStore.getState().messages).length).toBe(9);

      // Confirm all thread-2 messages
      const thread2Messages = store.getMessagesForThread('thread-2');
      for (const msg of thread2Messages) {
        store.confirmMessage(msg.id);
      }

      // Should have 6 remaining (3 from thread-1, 3 from thread-3)
      expect(Object.keys(useQueuedMessagesStore.getState().messages).length).toBe(6);

      // Verify correct threads remain
      const storeState = useQueuedMessagesStore.getState();
      for (const msg of Object.values(storeState.messages)) {
        expect(msg.threadId).not.toBe('thread-2');
      }
    });
  });
});
