# Queued Message UI Feedback - Refined Implementation Plan

## Problem Statement

When a user queues a message (sends a message while the agent is running), there is insufficient UI feedback:

1. **Expected**: The queued message should be pinned/visible until acknowledgement is received
2. **Expected**: Once acknowledged, the message should render as a normal user message in the chat
3. **Actual**: Messages appear in a minimal banner that can be dismissed, and don't transition cleanly to committed state

## Solution Overview

The fix involves two coordinated changes:

1. **Agent-side**: Persist queued messages to disk immediately (they already are via `appendUserMessage`) and emit a state event so the UI re-renders
2. **Frontend-side**: Remove messages from the Zustand store once they are acknowledged and committed to `activeState.messages`

The key insight is that the agent **already persists queued messages to disk** at `stdin-message-stream.ts:75`:

```typescript
// Append to state immediately (SDK won't emit this message back)
await appendUserMessage(msg.content);
```

This calls `appendUserMessage()` which pushes to `state.messages` and calls `emitState()`, which:
1. Writes state.json to disk
2. Emits `{ type: "state", state: payload }` to stdout

So the persistence and event emission are already happening. The issue is purely on the frontend: the Zustand store keeps holding the message even after it's in `activeState.messages`.

## Current Flow (with gap identified)

```
1. User queues message
   → sendQueuedMessage() adds to Zustand store (optimistic)
   → Writes to agent stdin

2. Agent receives message
   → Emits "queued-message:ack" event
   → Calls appendUserMessage() → emitState()
   → State is persisted to disk AND emitted to UI

3. Frontend receives ack event
   → confirmMessage(messageId) removes from Zustand store ✓

4. Frontend receives state event
   → activeState.messages now includes the user message ✓

THE GAP: Between step 1 and step 3, the message shows in the banner.
         After step 3+4, the message shows in the chat as a normal user message.
         This is the CORRECT behavior, but the banner is styled poorly and dismissible.
```

## Refined Solution

### UI Behavior (No New Components Needed)

1. **While pending**: Show in `QueuedMessagesBanner` (current behavior, but improve styling)
   - Remove the dismiss/collapse X button - pending messages should always be visible
   - Keep the amber pulse indicator and "Queued" label

2. **Once acknowledged**:
   - `confirmMessage()` removes from Zustand store → banner disappears
   - `activeState.messages` already contains the message → renders as normal `UserMessage`
   - This transition happens naturally because:
     - The ack event triggers `confirmMessage()`
     - The state event updates `activeState.messages`
     - Both events come from the same `emitState()` call on the agent side

### Verification: Current Code Already Works

Looking at `stdin-message-stream.ts:64-75`:

```typescript
// Emit ack event BEFORE yielding to SDK
stdout({
  type: "event",
  name: "queued-message:ack",
  payload: { messageId: msg.id },
});

// Append to state immediately (SDK won't emit this message back)
await appendUserMessage(msg.content);
```

And `output.ts:96-99`:

```typescript
export async function appendUserMessage(content: string): Promise<void> {
  state.messages.push({ role: "user", content });
  await emitState();
}
```

The message IS being persisted to disk and the state IS being emitted. The frontend receives both the ack event and the updated state.

## Implementation Changes

### 1. Remove Dismiss Button from Banner

**File**: `src/components/simple-task/queued-messages-banner.tsx`

Remove the X button and collapsed state - pending messages should not be dismissible:

```typescript
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

### 2. Verify State Update Flow

Ensure the agent-service.ts properly processes both events. Looking at the current code:

- `handleAgentEvent()` at lines 157-171 handles `QUEUED_MESSAGE_ACK`
- State updates come through a different path (likely `handleAgentOutput()`)

Need to verify that state updates from `emitState()` properly update `activeState.messages` which triggers a re-render that shows the user message in the chat.

### 3. Optional: Style Banner Messages Like User Messages

If we want visual consistency, update the banner to style messages more like the actual `UserMessage` component (right-aligned, accent background). But this is optional since the message will transition to a real UserMessage quickly.

## Files to Modify

1. **`src/components/simple-task/queued-messages-banner.tsx`**
   - Remove X button and collapsed state
   - Messages should always be visible while pending

2. **Verify (no changes expected)**:
   - `src/lib/agent-service.ts` - confirm state updates flow correctly
   - `agents/src/runners/stdin-message-stream.ts` - already correct
   - `agents/src/output.ts` - already correct

## Success Criteria

1. When a message is queued, it appears in the banner (not dismissible)
2. When the agent acknowledges + persists the message:
   - The banner message disappears (Zustand store cleared)
   - The message appears in the chat as a normal user message (from activeState.messages)
3. The transition from "queued banner" to "committed message" is seamless
4. Multiple queued messages work correctly
5. No race conditions between ack and state events

## Testing Scenarios

1. Queue a single message while agent is running
   - Should appear in banner immediately
   - Should transition to chat when ack received

2. Queue multiple messages rapidly
   - All should appear in banner
   - All should transition to chat in order

3. Agent completes while messages are queued
   - Messages should still be visible and eventually committed

4. Error during queue (agent not running)
   - Message should be rolled back from store

## Why This Approach Is Simpler

The original plan proposed creating new components and injecting messages into the message array. But:

1. The agent already persists queued messages to disk
2. The agent already emits state updates
3. The frontend already receives these updates
4. The Zustand store already gets cleared on ack

The only issue is that the banner is styled as a notification that can be dismissed, rather than a temporary holding area for pending messages. The fix is to:
- Make the banner non-dismissible
- Trust that the transition to committed state happens quickly and naturally
