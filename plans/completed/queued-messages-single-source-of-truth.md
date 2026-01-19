# Queued Messages: Single Source of Truth Refactor

## Problem

Currently, queued messages have **dual state**:

1. **`pendingQueuedMessages` Map** in `agent-service.ts` (lines 47, 75)
   - Keyed by `messageId`
   - Stores `{ threadId, content, timestamp }`
   - Used for: sending to agent stdin, checking if pending, confirmation

2. **`queuedMessages` useState** in `simple-task-window.tsx` (line 103)
   - Array of `{ id, content, timestamp }`
   - Used for: rendering the QueuedMessagesBanner

This causes problems:
- **Sync issues**: Local state can diverge from the Map
- **Cleanup complexity**: Need effects to clear local state on threadId change
- **Bug potential**: Old thread's messages can appear in new thread if component doesn't unmount

## Solution

Single source of truth: a Zustand store that replaces both.

### Key Insight

Instead of cleanup, **filter by threadId at render time**. The store holds all queued messages, and components select only those matching their threadId.

---

## Implementation Plan

### Step 1: Create Zustand Store

**File**: `src/stores/queued-messages-store.ts`

```typescript
import { create } from 'zustand';

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

// Selector hook for thread-specific messages (memoized)
export function useQueuedMessagesForThread(threadId: string): QueuedMessage[] {
  return useQueuedMessagesStore((state) => state.getMessagesForThread(threadId));
}
```

---

### Step 2: Update agent-service.ts

**File**: `src/lib/agent-service.ts`

**Remove**:
- `pendingQueuedMessages` from `ProcessMaps` interface (line 47)
- `pendingQueuedMessages` initialization in `getProcessMaps()` (line 61)
- `pendingQueuedMessages` assignment (line 75)
- `isQueuedMessagePending()` function (lines 1149-1151)
- `confirmQueuedMessage()` function (lines 1156-1158)
- `clearPendingQueuedMessages()` function (lines 1163-1169)

**Modify `sendQueuedMessage()`** (lines 1109-1144):

```typescript
import { useQueuedMessagesStore } from '@/stores/queued-messages-store';

export async function sendQueuedMessage(
  threadId: string,
  message: string
): Promise<string> {
  const child = agentProcesses.get(threadId);
  if (!child) {
    throw new Error(`No active process for thread: ${threadId}`);
  }

  const messageId = crypto.randomUUID();
  const timestamp = Date.now();

  const payload = JSON.stringify({
    type: 'queued_message',
    id: messageId,
    content: message,
    timestamp,
  }) + '\n';

  // Add to store BEFORE sending (optimistic)
  useQueuedMessagesStore.getState().addMessage(threadId, messageId, message);

  try {
    await child.write(payload);
    logger.info('[agent-service] Sent queued message', { threadId, messageId });
    return messageId;
  } catch (err) {
    // Rollback on failure
    useQueuedMessagesStore.getState().confirmMessage(messageId);
    throw err;
  }
}
```

**Keep `handleAgentEvent()`** but update to use store:

```typescript
case EventName.QUEUED_MESSAGE_ACK:
  if (threadId) {
    const messageId = (payload as { messageId: string }).messageId;
    // Confirm in store
    useQueuedMessagesStore.getState().confirmMessage(messageId);
    // Still emit event for any other listeners
    eventBus.emit(EventName.QUEUED_MESSAGE_ACK, {
      threadId,
      messageId,
    });
  }
  break;
```

---

### Step 3: Update simple-task-window.tsx

**File**: `src/components/simple-task/simple-task-window.tsx`

**Remove**:
- Import of `clearPendingQueuedMessages`, `confirmQueuedMessage` (line 11)
- `queuedMessages` useState (line 103)
- `queuedMessagesRef` (lines 104-105)
- The `setQueuedMessages` call after `sendQueuedMessage` (lines 225-229)
- The `QUEUED_MESSAGE_ACK` event listener effect (lines 245-263)
- The cleanup effect for `clearPendingQueuedMessages` (lines 265-270)

**Add**:
```typescript
import { useQueuedMessagesForThread } from '@/stores/queued-messages-store';

// Inside component:
const queuedMessages = useQueuedMessagesForThread(threadId);
```

**Simplify `handleSubmitFollowUp()`**:
```typescript
if (canQueueMessages) {
  try {
    await sendQueuedMessage(threadId, userPrompt);
    // No local state update needed - store handles it
  } catch (err) {
    logger.error("[SimpleTaskWindow] Failed to queue message", err);
  }
}
```

---

### Step 4: Update Tests

**File**: `src/lib/__tests__/queued-messages.test.ts`

Rewrite to test the Zustand store directly:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useQueuedMessagesStore } from '@/stores/queued-messages-store';

describe('Queued Messages Store', () => {
  beforeEach(() => {
    // Reset store state
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
      const store = useQueuedMessagesStore.getState();

      // Add in reverse order
      useQueuedMessagesStore.setState({
        messages: {
          'msg-3': { id: 'msg-3', threadId: 'thread-A', content: 'Third', timestamp: 3000 },
          'msg-1': { id: 'msg-1', threadId: 'thread-A', content: 'First', timestamp: 1000 },
          'msg-2': { id: 'msg-2', threadId: 'thread-A', content: 'Second', timestamp: 2000 },
        }
      });

      const messages = store.getMessagesForThread('thread-A');
      expect(messages.map(m => m.content)).toEqual(['First', 'Second', 'Third']);
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
  });
});
```

---

## Migration Checklist

- [ ] Create `src/stores/queued-messages-store.ts`
- [ ] Update `src/lib/agent-service.ts`:
  - [ ] Remove `pendingQueuedMessages` from ProcessMaps
  - [ ] Remove `isQueuedMessagePending`, `confirmQueuedMessage`, `clearPendingQueuedMessages`
  - [ ] Update `sendQueuedMessage` to use store
  - [ ] Update `handleAgentEvent` to confirm via store
- [ ] Update `src/components/simple-task/simple-task-window.tsx`:
  - [ ] Remove local `queuedMessages` state
  - [ ] Remove cleanup effects
  - [ ] Use `useQueuedMessagesForThread(threadId)` hook
  - [ ] Simplify submit handler
- [ ] Rewrite `src/lib/__tests__/queued-messages.test.ts` to test store
- [ ] Run tests and verify behavior

---

## Benefits

1. **No cleanup needed**: Just filter by threadId at render time
2. **No sync issues**: Single source of truth
3. **Simpler component**: No local state, no effects for cleanup
4. **HMR resilient**: Zustand stores persist across HMR (with persist middleware if needed)
5. **Testable**: Store logic is pure and easy to test in isolation

---

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Thread switch | Component re-renders, `useQueuedMessagesForThread(newThreadId)` returns empty array |
| Component unmount | No cleanup needed, messages stay in store (harmless) |
| Agent process dies | Messages remain "pending" until manually cleared or agent restarts |
| Multiple windows | All windows share same store, see same queued messages |

---

## Optional: Cleanup Stale Messages

If messages should be cleared when a thread's agent process exits, add to `handleAgentEvent`:

```typescript
case EventName.AGENT_COMPLETED:
case EventName.AGENT_CANCELLED:
  // Clear any remaining queued messages for this thread
  const messages = useQueuedMessagesStore.getState().getMessagesForThread(threadId);
  for (const msg of messages) {
    useQueuedMessagesStore.getState().confirmMessage(msg.id);
  }
  break;
```

This is optional - stale messages are filtered out by threadId anyway and don't cause UI issues.
