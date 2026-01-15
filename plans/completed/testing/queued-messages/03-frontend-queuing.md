# 03 - Frontend Queuing UI and IPC

## Dependencies

None for development. Needs 01 and 02 complete to test end-to-end.

## Parallel With

01-prereq-api-key, 02-agent-stdin-stream

## Scope

Implement frontend changes for:
1. Sending queued messages via stdin to running agents
2. Tracking pending queued messages
3. Showing queued messages banner
4. Updating SimpleTaskWindow submit logic

## Interface Contract (Output)

Send JSON lines to agent stdin via `child.write()`:

```typescript
{
  type: 'queued_message',
  id: string,        // UUID (use crypto.randomUUID())
  content: string,   // User's message
  timestamp: number  // Date.now()
}
```

## Files to Modify

### 1. `src/lib/agent-service.ts`

Add queued message functions:

```typescript
// Note: Use crypto.randomUUID() - the project does not use the uuid library

/** Track queued message IDs for confirmation matching */
const pendingQueuedMessages = new Map<string, {
  threadId: string;
  content: string;
  timestamp: number;
}>();

/**
 * Sends a queued message to a running simple agent via stdin.
 * @returns The unique ID of the queued message for tracking
 */
export async function sendQueuedMessage(
  threadId: string,
  message: string
): Promise<string> {
  // Note: Use agentProcesses (not activeSimpleProcesses) for consistency
  // with sendPermissionResponse and to support all agent types
  const child = agentProcesses.get(threadId);
  if (!child) {
    throw new Error(`No active process for thread: ${threadId}`);
  }

  const messageId = crypto.randomUUID();
  const timestamp = Date.now();

  // Format as JSON line (must end with newline)
  const payload = JSON.stringify({
    type: 'queued_message',
    id: messageId,
    content: message,
    timestamp,
  }) + '\n';

  // Track for confirmation
  pendingQueuedMessages.set(messageId, {
    threadId,
    content: message,
    timestamp,
  });

  try {
    await child.write(payload);
    logger.info('[agent-service] Sent queued message', { threadId, messageId });
    return messageId;
  } catch (err) {
    pendingQueuedMessages.delete(messageId);
    throw err;
  }
}

/**
 * Check if a queued message has been processed.
 */
export function isQueuedMessagePending(messageId: string): boolean {
  return pendingQueuedMessages.has(messageId);
}

/**
 * Mark a queued message as processed.
 */
export function confirmQueuedMessage(messageId: string): void {
  pendingQueuedMessages.delete(messageId);
}

/**
 * Clear all pending queued messages for a thread.
 */
export function clearPendingQueuedMessages(threadId: string): void {
  for (const [id, data] of pendingQueuedMessages.entries()) {
    if (data.threadId === threadId) {
      pendingQueuedMessages.delete(id);
    }
  }
}
```

**Note**: `shell:allow-stdin-write` permission is already granted in `src-tauri/capabilities/default.json:61`.

### 2. `src/components/simple-task/simple-task-window.tsx`

Update to support queuing:

```typescript
// Add these imports to the existing imports
import { useState, useRef } from "react"; // Add useRef to existing import
import {
  sendQueuedMessage,
  confirmQueuedMessage,
  clearPendingQueuedMessages
} from "@/lib/agent-service";
import { QueuedMessagesBanner } from "./queued-messages-banner";

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

function SimpleTaskWindowContent({
  taskId,
  threadId,
  prompt,
}: SimpleTaskWindowContentProps) {
  // ... existing code ...

  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

  // Note: The existing codebase uses 'running' not 'streaming' for the running state
  const canQueueMessages = viewStatus === 'running';
  const canResumeAgent = viewStatus === 'idle' || viewStatus === 'error' || viewStatus === 'cancelled';

  const handleSubmit = async (prompt: string) => {
    if (!workingDirectory) {
      logger.error("[SimpleTaskWindow] Cannot submit: no working directory");
      return;
    }

    if (canQueueMessages) {
      // Agent is running - queue the message
      try {
        const messageId = await sendQueuedMessage(threadId, prompt);
        setQueuedMessages(prev => [...prev, {
          id: messageId,
          content: prompt,
          timestamp: Date.now(),
        }]);
      } catch (err) {
        logger.error("[SimpleTaskWindow] Failed to queue message", err);
        // TODO: Show error toast
      }
    } else if (canResumeAgent) {
      // Agent is idle - resume normally
      // Note: resumeSimpleAgent requires agentMode parameter
      await resumeSimpleAgent(taskId, threadId, prompt, workingDirectory, agentMode);
    } else {
      // Paused or other state - shouldn't happen with current logic
      logger.warn('[SimpleTaskWindow] Cannot submit in current state', { status: viewStatus });
    }
  };

  // Remove queued messages once they appear in conversation
  // NOTE: Content-based matching (SDK doesn't echo message IDs)
  // WARNING: Using queuedMessages in dependency array can cause infinite loops
  // when state updates trigger re-renders. Use a ref or memoize to avoid.
  const queuedMessagesRef = useRef(queuedMessages);
  queuedMessagesRef.current = queuedMessages;

  useEffect(() => {
    if (!activeState?.messages) return;

    const processedIds: string[] = [];
    const currentQueued = queuedMessagesRef.current;

    for (const qm of currentQueued) {
      const foundInConversation = activeState.messages.some(m => {
        if (m.role !== 'user') return false;
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.find(b => b.type === 'text')?.text
            : '';
        return content === qm.content;
      });

      if (foundInConversation) {
        processedIds.push(qm.id);
        confirmQueuedMessage(qm.id);
      }
    }

    if (processedIds.length > 0) {
      setQueuedMessages(prev => prev.filter(qm => !processedIds.includes(qm.id)));
    }
  }, [activeState?.messages]); // Note: Only depend on messages, not queuedMessages

  // Clear on unmount
  useEffect(() => {
    return () => {
      clearPendingQueuedMessages(threadId);
    };
  }, [threadId]);

  return (
    <div className="flex flex-col h-screen bg-surface-900 text-surface-50">
      {/* Note: SimpleTaskHeader requires threadId parameter */}
      <SimpleTaskHeader taskId={taskId} threadId={threadId} status={viewStatus} />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ThreadView
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          toolStates={toolStates}
          onToolResponse={handleToolResponse}
        />
      </div>
      <PermissionUI threadId={threadId} />

      {/* Queued messages banner */}
      <QueuedMessagesBanner messages={queuedMessages} />

      {/* Note: ThreadInput requires threadId parameter */}
      <ThreadInput
        threadId={threadId}
        onSubmit={handleSubmit}
        disabled={false}  // Always enabled now!
        workingDirectory={workingDirectory}
        placeholder={canQueueMessages ? "Queue a message..." : undefined}
      />
    </div>
  );
}
```

## Files to Create

### 3. `src/components/simple-task/queued-messages-banner.tsx`

```typescript
interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

interface QueuedMessagesBannerProps {
  messages: QueuedMessage[];
}

export function QueuedMessagesBanner({ messages }: QueuedMessagesBannerProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-4 py-2 bg-surface-800 border-t border-surface-700">
      <div className="flex items-center gap-2 text-xs text-surface-400 mb-1">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span>
          Queued {messages.length === 1 ? 'message' : 'messages'} (will be sent when agent is ready)
        </span>
      </div>
      <div className="space-y-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="text-sm text-surface-300 bg-surface-700/50 rounded px-2 py-1 truncate"
          >
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Verification

1. Start a task, type follow-up while agent is running (viewStatus === 'running')
2. Verify banner appears immediately (optimistic UI)
3. Verify placeholder changes to "Queue a message..."
4. Verify banner disappears when message appears in thread
5. Verify normal resume works when status is 'idle', 'error', or 'cancelled'
6. Verify no infinite re-render loops when messages arrive

## Known Limitations

**Content-based matching**: SDK doesn't echo our message IDs. If user queues identical messages (e.g., "yes" twice), both marked processed when first appears. Cosmetic issue only - messages still processed correctly.

**Interaction with PermissionUI**: The current implementation keeps PermissionUI as a sibling component above the queued messages banner. This is intentional - permission requests should take priority over queued messages. The existing `sendPermissionResponse` in agent-service.ts already uses `agentProcesses` Map, so both features share the same process reference.

**Agent mode not preserved in resumed messages**: When queuing messages while the agent is running, the `agentMode` state is captured from when the message is eventually sent via `resumeSimpleAgent`. If the user changes agent mode while messages are queued, the new mode will apply to resumed messages but queued messages bypass this (they go directly to the running agent). This is expected behavior - queued messages go to the current running agent as-is.

## Implementation Notes

1. **File size**: The `simple-task-window.tsx` file is currently 133 lines. Adding the queuing logic will increase it by approximately 50 lines. Monitor the file size and consider extracting the queuing logic into a custom hook (`useMessageQueuing`) if it exceeds 250 lines.

2. **Export the new banner**: Add `export { QueuedMessagesBanner } from "./queued-messages-banner";` to `src/components/simple-task/index.ts`.

3. **Type import**: The `QueuedMessage` interface is duplicated between the window and banner components. Consider extracting to a shared types file if this pattern expands.
