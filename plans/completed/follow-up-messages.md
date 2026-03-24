# Plan: Implement Follow-up Messages in Conversation View

## Problem
When a user sends a follow-up message in the conversation view, nothing happens. The message is logged but not sent to the agent.

## Root Cause
The `handleSendMessage` callback in `conversation-window.tsx:188-191` is a stub:
```typescript
const handleSendMessage = useCallback((message: string) => {
  // TODO: Implement sending follow-up messages to the agent
  logger.log("[ConversationWindow] User message:", message);
}, []);
```

## Existing Infrastructure (Already Works)
- **Runner supports resuming**: `--history-file` arg loads prior messages from state.json (runner.ts:171-197)
- **Conversation service**: `addTurn()` method exists (service.ts:142-164)
- **Agent spawning**: `prepareAgent()` and `startAgent()` work correctly
- **Event streaming**: Event bridge and hooks properly relay state updates
- **UI display**: Message components handle new messages automatically

## Implementation Plan

### Step 1: Add `resumeAgent` function to agent-service.ts

Create a new function that resumes an existing conversation with a follow-up message:

```typescript
export async function resumeAgent(
  conversationId: string,
  prompt: string,
  callbacks: AgentStreamCallbacks
): Promise<void>
```

This function should:
1. Look up the conversation metadata via `conversationService.get(conversationId)`
2. Get the state file path: `${anvilDir}/conversations/${conversationId}/state.json`
3. Add a new turn via `conversationService.addTurn(conversationId, prompt)`
4. Mark conversation as running via `conversationService.markRunning(conversationId)`
5. Spawn the runner with `--history-file` pointing to state.json
6. Use same working directory, agent type, and other params from existing conversation

**File**: `src/lib/agent-service.ts`

### Step 2: Update handleSendMessage in conversation-window.tsx

Replace the stub with actual implementation:

```typescript
const handleSendMessage = useCallback(async (message: string) => {
  try {
    await resumeAgent(conversationId, message, {
      onState: (state) => {
        // Already handled by useStreamingConversation hook via event bus
        eventBus.emit("agent:state", { conversationId, state });
      },
      onComplete: (exitCode, costUsd) => {
        eventBus.emit("agent:completed", { conversationId, exitCode, costUsd });
      },
      onError: (error) => {
        eventBus.emit("agent:error", { conversationId, error });
      },
    });
  } catch (error) {
    logger.error("[ConversationWindow] Failed to send message:", error);
  }
}, [conversationId]);
```

**File**: `src/components/conversation/conversation-window.tsx`

### Step 3: Immediately show user message in UI

The message should appear immediately (optimistically) before the agent responds. Two options:

**Option A**: Let streaming handle it
- Runner emits state with the new user message appended
- UI updates via `useStreamingConversation` hook
- Small delay before message shows

**Option B**: Optimistic update (Recommended)
- Emit the user message immediately to the streaming state
- Add a local state update before calling resumeAgent
- Message shows instantly

For simplicity, Option A should work since the runner calls `appendUserMessage()` immediately on start.

### Files to Modify

1. **`src/lib/agent-service.ts`**
   - Add `resumeAgent()` function
   - Export it

2. **`src/components/conversation/conversation-window.tsx`**
   - Import `resumeAgent` and `eventBus`
   - Replace stub `handleSendMessage` with actual implementation
   - Handle loading/error states during send

### Testing

1. Complete a conversation (agent finishes)
2. Type a follow-up message in the chat input
3. Press Enter or click Send
4. Verify:
   - User message appears in the chat
   - Agent starts processing (spinner/loading state)
   - Assistant response streams in
   - File changes update if any

## Notes

- The conversation window already disables input while streaming (`canSendMessage = viewStatus === "completed" && !isStreaming`)
- The runner handles multi-turn context via `messages` array passed to `query()`
- Git worktree and branch are preserved from the original conversation
