# Thread Naming Fixes

## Problem Statement

Thread naming has several issues:
1. **Thread names don't update for threads started from the main window** - The `THREAD_NAME_GENERATED` event is emitted by the agent but not properly handled/forwarded to the UI
2. **Thread renames from spotlight seem slow** - Need to verify the event flow is working correctly
3. **Unnecessary LLM calls for short prompts** - If the user prompt is < 25 characters, we should use it directly instead of making an LLM call

## Root Cause Analysis

After investigating the codebase, I found **two bugs** preventing thread naming from working:

### Bug 1: Event Not Forwarded to EventBus

In `src/lib/agent-service.ts`, the `handleAgentEvent()` function has a switch statement that handles specific events and emits them to the eventBus. **`THREAD_NAME_GENERATED` is NOT in this switch statement**, so it falls through to the default case:

```typescript
// src/lib/agent-service.ts:149-193
function handleAgentEvent(event: AgentEventMessage, threadId?: string): void {
  const { name, payload } = event;

  switch (name) {
    case EventName.THREAD_CREATED:
    case EventName.THREAD_UPDATED:
    case EventName.THREAD_STATUS_CHANGED:
    // ... other events ...
    case EventName.AGENT_CANCELLED:
      eventBus.emit(name as any, payload as any);
      break;
    // ... other cases ...
    default:
      logger.warn(`[handleAgentEvent] Unhandled event: ${name}`);  // <-- THREAD_NAME_GENERATED hits this!
  }
}
```

### Bug 2: No Listener to Refresh Thread Metadata

Even if the event were emitted to the eventBus, there's no listener in `src/entities/threads/listeners.ts` to handle it:

```typescript
// Current listeners (missing THREAD_NAME_GENERATED):
eventBus.on(EventName.THREAD_CREATED, ...)
eventBus.on(EventName.THREAD_UPDATED, ...)
eventBus.on(EventName.THREAD_STATUS_CHANGED, ...)
eventBus.on(EventName.AGENT_STATE, ...)
eventBus.on(EventName.AGENT_COMPLETED, ...)
eventBus.on(EventName.THREAD_ARCHIVED, ...)
// NO HANDLER FOR THREAD_NAME_GENERATED!
```

### Why Spotlight "Appears" to Work

Spotlight might appear to work because:
1. The thread metadata file IS correctly updated on disk by the agent
2. When the user navigates to the thread later, the metadata is re-read from disk
3. The issue is that there's no live update - the UI doesn't reflect the name change until a manual refresh

### Thread Naming Does Run in Parallel

The code confirms thread naming runs asynchronously:
```typescript
// agents/src/runners/simple-runner-strategy.ts:286
this.initiateThreadNaming(threadId, prompt, threadPath);  // No await - fire and forget

// agents/src/runners/simple-runner-strategy.ts:377-406
generateThreadName(prompt, apiKey)
  .then(async (name) => {
    // Update metadata on disk
    // Emit event
    events.threadNameGenerated(threadId, name);
  })
  .catch((error) => {
    // Log error but don't fail
  });
```

## Solution

### Fix 1: Add `THREAD_NAME_GENERATED` to `handleAgentEvent()` switch statement

**File:** `src/lib/agent-service.ts`

Add the event to the list of events that get emitted to the eventBus:

```typescript
case EventName.THREAD_CREATED:
case EventName.THREAD_UPDATED:
case EventName.THREAD_STATUS_CHANGED:
case EventName.WORKTREE_ALLOCATED:
case EventName.WORKTREE_RELEASED:
case EventName.ACTION_REQUESTED:
case EventName.AGENT_CANCELLED:
case EventName.THREAD_NAME_GENERATED:  // <-- ADD THIS
  eventBus.emit(name as any, payload as any);
  break;
```

### Fix 2: Add listener for `THREAD_NAME_GENERATED` in thread listeners

**File:** `src/entities/threads/listeners.ts`

Add a new listener that refreshes the thread metadata when its name is generated:

```typescript
eventBus.on(EventName.THREAD_NAME_GENERATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_NAME_GENERATED]) => {
  try {
    await threadService.refreshById(threadId);
    logger.info(`[ThreadListener] Refreshed thread ${threadId} after name generated`);
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh thread after name generated ${threadId}:`, e);
  }
});
```

### Fix 3: Skip LLM call for short prompts (< 25 characters)

**File:** `agents/src/services/thread-naming-service.ts`

Modify `generateThreadName()` to skip the LLM call for short prompts:

```typescript
export async function generateThreadName(
  prompt: string,
  apiKey: string
): Promise<string> {
  // For short prompts, use the prompt directly as the thread name
  // This saves API costs and improves latency
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= 25) {
    return trimmedPrompt;
  }

  // For longer prompts, use LLM to generate a concise name
  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a thread name for this user message:\n\n${prompt}`,
    maxOutputTokens: 50,
  });

  return text.trim().slice(0, 30);
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Add `THREAD_NAME_GENERATED` to `handleAgentEvent()` switch |
| `src/entities/threads/listeners.ts` | Add listener for `THREAD_NAME_GENERATED` event |
| `agents/src/services/thread-naming-service.ts` | Add short prompt optimization |

## Testing

1. **Main window thread naming:** Create a thread from the main window and verify the name updates automatically
2. **Spotlight thread naming:** Create a thread from spotlight and verify the name updates automatically
3. **Short prompt optimization:** Create a thread with prompt "Fix typo" (< 25 chars) and verify no LLM call is made, name is "Fix typo"
4. **Long prompt naming:** Create a thread with a longer prompt and verify LLM-generated name appears

## Event Flow After Fix

```
1. User creates thread (main window or spotlight)
   │
2. spawnSimpleAgent() spawns agent process
   │
3. SimpleRunnerStrategy.setup() creates thread metadata
   │
4. initiateThreadNaming() fires (async, non-blocking)
   │
5. generateThreadName() completes
   │
6. Thread metadata updated on disk with name
   │
7. events.threadNameGenerated(threadId, name) emits JSON to stdout
   │
8. handleSimpleAgentOutput() parses JSON line
   │
9. handleAgentEvent() receives event
   │                           │
   │                           ▼ [FIX 1]
10. eventBus.emit(THREAD_NAME_GENERATED, payload)
   │
   ▼ [FIX 2]
11. Thread listener receives event
   │
12. threadService.refreshById(threadId) reloads from disk
   │
13. UI updates with new thread name
```
