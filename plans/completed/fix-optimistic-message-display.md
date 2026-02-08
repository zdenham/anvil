# Fix Optimistic Message Display for All Messages

## Problem

When a user sends a message, the message is not displayed immediately. The user has to wait for the agent to start and write `state.json` to disk before seeing their message rendered. This affects:

1. **First message on an empty thread** (created via Cmd+N)
2. **Follow-up messages** (resuming an existing conversation)

## Root Cause Analysis

### Working Path: Spotlight/EmptyPaneContent (New Thread + First Message)

1. User types message in Spotlight or empty pane
2. `thread-creation-service.createThread()` is called
3. `threadService.createOptimistic()` is called with the `prompt` parameter
4. **`THREAD_OPTIMISTIC_CREATED` event is emitted** with the prompt
5. The optimistic thread is created with `turns[0].prompt` populated
6. `ContentPane` reads `initialPrompt` from `s.threads[view.threadId]?.turns[0]?.prompt`
7. `ThreadContent` receives `initialPrompt` prop and displays it immediately ✅

### Broken Path 1: First Message on Existing Empty Thread

1. User creates an empty thread via Cmd+N
2. `threadService.create()` is called with no prompt → `turns[0].prompt` is `undefined`
3. User navigates to the thread and types a message
4. `ThreadContent.handleSubmit()` calls `spawnSimpleAgent()` directly
5. **No optimistic update event is emitted**
6. **No update to thread's `turns[0].prompt`**
7. User sees empty state until agent writes `state.json` ❌

### Broken Path 2: Follow-up Messages (Resume)

1. User has an existing thread with messages
2. User types a new message and presses Enter
3. `ThreadContent.handleSubmit()` calls `resumeSimpleAgent()` directly
4. **No optimistic update** - message not added to local state
5. User sees existing messages but their new message doesn't appear ❌
6. Message only appears after agent writes updated `state.json` to disk

## Current Message Rendering Logic

In `thread-content.tsx` (lines 213-248):

```typescript
const messages = useMemo((): MessageParam[] => {
  // If we have messages from the store, use those (real data)
  if (activeState?.messages && activeState.messages.length > 0) {
    return activeState.messages;  // From state.json on disk
  }

  // If we have a prompt but no messages yet, show optimistic message
  if (initialPrompt) {
    return [{ role: "user", content: initialPrompt }];  // First message only
  }

  return [];
}, [activeState?.messages, initialPrompt, threadId]);
```

**Problems:**
1. For first message: `initialPrompt` is never set because `turns[0].prompt` wasn't updated
2. For follow-up: No mechanism to append optimistic message to existing `activeState.messages`

## Solution

### Approach: Local Optimistic Message State

Add local state in `ThreadContent` to track optimistic messages that haven't been persisted yet. This handles both first messages and follow-ups uniformly.

```typescript
// Track optimistic messages sent but not yet in state.json
const [optimisticMessages, setOptimisticMessages] = useState<MessageParam[]>([]);

// Clear optimistic messages when they appear in the real state
useEffect(() => {
  if (activeState?.messages?.length && optimisticMessages.length > 0) {
    // Check if our optimistic messages are now in the real state
    // Simple heuristic: if real message count increased, clear optimistic
    setOptimisticMessages([]);
  }
}, [activeState?.messages?.length]);

const messages = useMemo((): MessageParam[] => {
  const realMessages = activeState?.messages ?? [];

  // If no real messages, check initialPrompt first (for thread-creation-service path)
  if (realMessages.length === 0 && initialPrompt) {
    return [{ role: "user", content: initialPrompt }];
  }

  // Append any optimistic messages to real messages
  return [...realMessages, ...optimisticMessages];
}, [activeState?.messages, initialPrompt, optimisticMessages]);
```

Then in `handleSubmit`:

```typescript
const handleSubmit = useCallback(async (userPrompt: string) => {
  // ... existing validation ...

  // Add optimistic message immediately for instant feedback
  setOptimisticMessages(prev => [...prev, { role: "user", content: userPrompt }]);

  // Queue message if agent is currently running
  if (canQueueMessages) {
    // ... existing queue logic ...
    return;
  }

  if (canResumeAgent) {
    if (isFirstMessage && activeMetadata?.repoId && activeMetadata?.worktreeId) {
      await spawnSimpleAgent({ ... });
    } else {
      await resumeSimpleAgent(threadId, userPrompt, workingDirectory);
    }
  }
}, [...]);
```

### Why This Approach

1. **Handles both cases uniformly** - First message and follow-ups use the same mechanism
2. **No event system changes needed** - Works within the component
3. **Self-cleaning** - Optimistic messages are cleared when real state arrives
4. **Thread-safe** - Each `ThreadContent` instance manages its own optimistic state

### Alternative: Event-Based Approach

We could also emit events and update the thread store, but this is more complex:

1. Would need a new `THREAD_MESSAGE_OPTIMISTIC` event
2. Would need to store optimistic messages in the thread store
3. Would need to reconcile with `state.json` updates from disk
4. Cross-window sync complications

The local state approach is simpler and sufficient since optimistic messages only need to be visible in the window where they were sent.

## Phases

- [x] Add `optimisticMessages` local state to `ThreadContent`
- [x] Update `messages` useMemo to append optimistic messages
- [x] Add effect to clear optimistic messages when real state updates
- [x] Update `handleSubmit` to add optimistic message before spawning/resuming
- [x] Test first message on empty thread displays immediately
- [x] Test follow-up messages display immediately

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

1. `src/components/content-pane/thread-content.tsx` - Add optimistic message handling

## Implementation Details

### State Management

```typescript
// Add to ThreadContent component
const [optimisticMessages, setOptimisticMessages] = useState<MessageParam[]>([]);

// Reset when thread changes
useEffect(() => {
  setOptimisticMessages([]);
}, [threadId]);

// Clear when real messages arrive
useEffect(() => {
  if (optimisticMessages.length > 0 && activeState?.messages) {
    // Find optimistic messages that are now in real state
    const realContent = new Set(
      activeState.messages
        .filter(m => m.role === "user")
        .map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content))
    );

    const stillPending = optimisticMessages.filter(m => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return !realContent.has(content);
    });

    if (stillPending.length !== optimisticMessages.length) {
      setOptimisticMessages(stillPending);
    }
  }
}, [activeState?.messages, optimisticMessages]);
```

### Message Computation

```typescript
const messages = useMemo((): MessageParam[] => {
  const realMessages = activeState?.messages ?? [];

  // If no real messages and we have initialPrompt (from thread-creation-service)
  if (realMessages.length === 0 && initialPrompt && optimisticMessages.length === 0) {
    return [{ role: "user", content: initialPrompt }];
  }

  // Append optimistic messages to real messages
  if (optimisticMessages.length > 0) {
    return [...realMessages, ...optimisticMessages];
  }

  return realMessages;
}, [activeState?.messages, initialPrompt, optimisticMessages]);
```

### Submit Handler Update

```typescript
const handleSubmit = useCallback(async (userPrompt: string) => {
  if (!workingDirectory) {
    logger.error("[ThreadContent] Cannot submit: no working directory");
    return;
  }

  // Save to history
  savePromptToHistory(userPrompt, threadId);

  // Add optimistic message immediately
  setOptimisticMessages(prev => [...prev, { role: "user", content: userPrompt }]);

  // Queue message if agent is currently running
  if (canQueueMessages) {
    try {
      await sendQueuedMessage(threadId, userPrompt);
    } catch (error) {
      logger.error("[ThreadContent] Failed to queue message:", error);
      showToast("Failed to queue message");
      // Remove optimistic message on failure
      setOptimisticMessages(prev => prev.filter(m => m.content !== userPrompt));
    }
    return;
  }

  if (canResumeAgent) {
    try {
      if (isFirstMessage && activeMetadata?.repoId && activeMetadata?.worktreeId) {
        await spawnSimpleAgent({ ... });
      } else {
        await resumeSimpleAgent(threadId, userPrompt, workingDirectory);
      }
    } catch (error) {
      // Remove optimistic message on failure
      setOptimisticMessages(prev => prev.filter(m => m.content !== userPrompt));
      throw error;
    }
  }
}, [/* deps */]);
```

## Testing

### Test 1: First Message on Empty Thread
1. Press Cmd+N to create a new empty thread
2. Type a message and press Enter
3. **Expected:** Message appears immediately
4. **Verify:** Message persists after agent writes state.json

### Test 2: Follow-up Message
1. Open an existing thread with messages
2. Type a new message and press Enter
3. **Expected:** New message appears immediately below existing messages
4. **Verify:** Message persists after agent writes state.json

### Test 3: Error Handling
1. Disconnect network or cause spawn to fail
2. Send a message
3. **Expected:** Optimistic message removed on failure

### Test 4: Thread Navigation
1. Send a message (optimistic appears)
2. Navigate away before agent writes state.json
3. Navigate back
4. **Expected:** Either real message (if persisted) or empty state (if not yet persisted)
