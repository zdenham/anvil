# Plan: Implement Proper Message Queueing

## Overview

Enable users to queue messages while an agent is actively processing. Currently, attempting to send a message while the agent is running shows a "Message queueing coming soon" toast. The underlying infrastructure is mostly built - this plan completes the implementation.

## Current State

### What Exists (Already Built)
- **Zustand Store** (`src/stores/queued-messages-store.ts`): Complete state management with `addMessage()`, `confirmMessage()`, `getMessagesForThread()`, and reactive hooks
- **Agent-side Processing** (`agents/src/runners/stdin-message-stream.ts`): Full stdin listener with queue (max 50 messages), ACK event emission, state persistence
- **Message Sending API** (`src/lib/agent-service.ts`): `sendQueuedMessage()` function ready to use
- **UI Banner Component** (`src/components/control-panel/queued-messages-banner.tsx`): Visual feedback component built but not integrated
- **Event Bus**: ACK handling already wired up in `agent-service.ts:handleAgentEvent()`

### What's Disabled
In `src/components/control-panel/control-panel-window.tsx:206-210`:
```typescript
// Message queueing temporarily disabled
if (canQueueMessages) {
  showToast("Message queueing coming soon");
  return;
}
```

## Implementation Steps

### Step 1: Enable Message Queueing in Control Panel

**File**: `src/components/control-panel/control-panel-window.tsx`

Replace the disabled toast with actual queue functionality:

```typescript
// Before (lines 206-210)
if (canQueueMessages) {
  showToast("Message queueing coming soon");
  return;
}

// After
if (canQueueMessages) {
  await sendQueuedMessage(threadId, userPrompt);
  return;
}
```

**Additional changes needed**:
- Import `sendQueuedMessage` from `@/lib/agent-service`
- Add error handling for queue failures
- Show brief feedback when message is queued (not blocking toast)

### Step 2: Integrate Queued Messages Banner

**File**: `src/components/control-panel/control-panel-window.tsx`

Add the banner to show pending messages above the input area:

```typescript
import { QueuedMessagesBanner } from './queued-messages-banner';
import { useQueuedMessagesForThread } from '@/stores/queued-messages-store';

// Inside component:
const queuedMessages = useQueuedMessagesForThread(threadId);

// In JSX, above ChatInput:
<QueuedMessagesBanner messages={queuedMessages} />
```

### Step 3: Update Input Placeholder Text

**File**: `src/components/control-panel/control-panel-window.tsx`

Update placeholder to indicate queueing is available:

```typescript
// When agent is running, change placeholder from disabled state to queueable state
const inputPlaceholder = useMemo(() => {
  if (canQueueMessages) return "Queue a follow-up message...";
  if (canResumeAgent) return "Send a follow-up message...";
  return "Message...";
}, [canQueueMessages, canResumeAgent]);
```

### Step 4: Add Visual Feedback for Queued State

**File**: `src/components/control-panel/control-panel-window.tsx`

Provide visual distinction when typing a message that will be queued:

```typescript
// Add subtle indicator to input area when in queue mode
const isQueueMode = canQueueMessages;

// Pass to ChatInput or wrap in container with visual cue
<div className={cn(
  "relative",
  isQueueMode && "ring-1 ring-amber-500/30"
)}>
  <ChatInput ... />
</div>
```

### Step 5: Handle Queue Errors Gracefully

**File**: `src/components/control-panel/control-panel-window.tsx`

Add error handling for queue failures:

```typescript
if (canQueueMessages) {
  try {
    await sendQueuedMessage(threadId, userPrompt);
    // Optional: brief non-blocking feedback
  } catch (error) {
    logger.error('[ControlPanelWindow] Failed to queue message:', error);
    showToast("Failed to queue message", "error");
  }
  return;
}
```

### Step 6: Add Queue Status to Thread Header

**File**: `src/components/control-panel/control-panel-header.tsx` (or appropriate header component)

Show queue count in thread header when messages are pending:

```typescript
const queuedMessages = useQueuedMessagesForThread(threadId);

{queuedMessages.length > 0 && (
  <div className="flex items-center gap-1 text-xs text-amber-500">
    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
    {queuedMessages.length} queued
  </div>
)}
```

### Step 7: Update Agent Status Text

**File**: Relevant status display component

When agent is running with queued messages, update status display:

```typescript
// Instead of just "Running..."
const statusText = useMemo(() => {
  if (status === 'running') {
    if (queuedMessages.length > 0) {
      return `Running (${queuedMessages.length} message${queuedMessages.length > 1 ? 's' : ''} queued)`;
    }
    return 'Running...';
  }
  // ... other statuses
}, [status, queuedMessages.length]);
```

### Step 8: Test the Full Flow

1. **Start a thread with a task**
2. **While agent is processing**, type a follow-up message
3. **Verify**: Message appears in queued banner immediately
4. **Verify**: Message is sent to agent via stdin
5. **Verify**: Agent emits ACK event
6. **Verify**: Banner clears after ACK
7. **Verify**: Message appears in chat history normally
8. **Test multiple queued messages**: Queue 2-3 messages in succession
9. **Test queue limit**: Verify behavior at max queue size (50)

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/control-panel/control-panel-window.tsx` | Enable queueing, add banner, update placeholder, add error handling |
| `src/components/control-panel/index.ts` | Ensure QueuedMessagesBanner is exported (if not already) |
| `src/components/control-panel/control-panel-header.tsx` | Add queue count indicator (optional) |

## Files That Require No Changes

These are already complete:
- `src/stores/queued-messages-store.ts` - Store is complete
- `src/lib/agent-service.ts` - `sendQueuedMessage()` and ACK handling done
- `agents/src/runners/stdin-message-stream.ts` - Agent-side handling complete
- `agents/src/output.ts` - State persistence complete

## Edge Cases to Handle

1. **Agent completes while message queued**: Message should transition from queued to "pending send" and be sent when agent can be resumed
2. **Agent errors while message queued**: Clear queue and show error, or preserve queue for retry
3. **Window closes while messages queued**: Messages are in Zustand (memory only) - consider persisting to localStorage if needed
4. **Rapid message queueing**: Ensure no race conditions in store updates
5. **Very long messages**: Already handled by banner truncation, but verify stdin can handle large payloads

## Future Enhancements (Out of Scope)

- Allow editing/removing queued messages before they're processed
- Persist queue to localStorage for crash recovery
- Show estimated position in queue
- Allow reordering queued messages

## Success Criteria

- [ ] User can send messages while agent is running
- [ ] Messages appear in queued banner immediately
- [ ] Messages are acknowledged by agent
- [ ] Banner clears when message is acknowledged
- [ ] Messages appear in chat history correctly
- [ ] No duplicate messages in history
- [ ] Error states handled gracefully
- [ ] Input placeholder indicates queue mode
