# Follow-Up Messages Not Working - Diagnosis and Fix Plan

## Problem Statement
Follow-up messages in the conversation view are not working. When a user tries to send a follow-up message after the initial conversation completes, it fails.

## Root Cause Analysis

### The Issue: Missing Entity Store Hydration in Conversation Panel

The conversation panel (`conversation-main.tsx`) does **not** call `hydrateEntities()` at startup, unlike the spotlight window (`spotlight-main.tsx`).

**Evidence:**

1. **spotlight-main.tsx** (lines 6, 12-14):
```typescript
import { hydrateEntities } from "./entities";

// Hydrate entity stores from disk (spotlight runs in separate JS context)
logger.log("[spotlight-main] Starting hydration...");
hydrateEntities()
  .then(() => {
    // ... setup continues
  });
```

2. **conversation-main.tsx** - No hydration call at all:
```typescript
// Only sets up incoming bridge, NO hydrateEntities() call
setupIncomingBridge().then(() => {
  // ...
});
```

### Why This Breaks Follow-Up Messages

When `handleSendMessage` is called in `conversation-window.tsx` (line 191-207):

```typescript
const handleSendMessage = useCallback(async (message: string) => {
  try {
    await resumeAgent(conversationId, message, { /* callbacks */ });
  } catch (error) {
    logger.error("[ConversationWindow] Failed to send message:", error);
  }
}, [conversationId]);
```

The `resumeAgent` function in `agent-service.ts` (lines 264-268) does:

```typescript
// 1. Look up the existing conversation
const conversation = conversationService.get(conversationId);
if (!conversation) {
  throw new Error(`Conversation not found: ${conversationId}`);
}
```

`conversationService.get()` reads from the Zustand store:
```typescript
get(id: string): ConversationMetadata | undefined {
  return useConversationStore.getState().conversations[id];
}
```

**Since the store was never hydrated, `conversations` is an empty object `{}`, so `get()` returns `undefined`, and `resumeAgent` throws "Conversation not found".**

### Additional Affected Functionality

The `settingsService` is also not hydrated, which is used in `resumeAgent` (lines 257-258):
```typescript
const settings = settingsService.get();
const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;
```

This might work due to the env variable fallback, but it's still incorrect.

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CURRENT (BROKEN) FLOW                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Spotlight Window                    Conversation Panel                 │
│  ─────────────────                   ──────────────────                 │
│                                                                         │
│  1. hydrateEntities() ✓              1. setupIncomingBridge() only      │
│  2. Creates conversation             2. No hydration! Stores empty      │
│  3. Opens conversation panel         3. Receives streaming state        │
│  4. Agent runs...                    4. Displays messages ✓             │
│  5. Agent completes                  5. User sends follow-up            │
│                                      6. resumeAgent() called            │
│                                      7. conversationService.get() → ❌   │
│                                         Store is empty!                 │
│                                      8. Throws "Conversation not found" │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Proposed Fix

### Option 1: Add Full Hydration (Simplest)

Add `hydrateEntities()` call to `conversation-main.tsx`:

```typescript
// conversation-main.tsx
import { hydrateEntities } from "./entities";

// In the initialization flow:
hydrateEntities().then(() => {
  setupIncomingBridge().then(() => {
    // ready
  });
});
```

**Pros:**
- Simple, one-line fix
- Consistent with spotlight-main.tsx pattern
- Ensures all services (settings, conversations, etc.) are available

**Cons:**
- Loads ALL conversations from disk (could be slow with many conversations)
- Slightly delays conversation panel ready state

### Option 2: Selective Hydration (More Efficient)

Only hydrate the specific conversation needed:

```typescript
// Add to conversation service:
async ensureLoaded(id: string): Promise<ConversationMetadata | null> {
  const existing = useConversationStore.getState().conversations[id];
  if (existing) return existing;

  const metadata = await persistence.readJson<ConversationMetadata>(
    `conversations/${id}.json`
  );
  if (metadata) {
    useConversationStore.getState()._applyCreate(metadata);
  }
  return metadata;
}

// In conversation-main.tsx:
listen<OpenConversationPayload>("open-conversation", async (event) => {
  await conversationService.ensureLoaded(event.payload.conversationId);
  await settingsService.hydrate(); // Still need settings for API key
  setConversationId(event.payload.conversationId);
});
```

**Pros:**
- Only loads what's needed
- Faster startup

**Cons:**
- More code changes
- Need to also hydrate settings

### Option 3: Refactor resumeAgent to Not Need Metadata (Larger Change)

Modify `resumeAgent` to read conversation metadata directly from disk instead of the store.

**Pros:**
- Removes dependency on hydrated store

**Cons:**
- Significant refactor
- Adds async I/O in the resume flow
- Inconsistent with rest of codebase

## Recommended Approach

**Option 1 (Full Hydration)** is recommended because:
1. It's the simplest fix with minimal code changes
2. It's consistent with how spotlight-main.tsx works
3. Performance impact is likely minimal (conversations are small JSON files)
4. It ensures all services work correctly (settings, conversations, etc.)

## Implementation Steps

1. **Add hydration to conversation-main.tsx:**
   ```typescript
   import { hydrateEntities } from "./entities";

   // Before setting up bridges:
   await hydrateEntities();
   ```

2. **Update the initialization flow:**
   ```typescript
   useEffect(() => {
     if (bridgeSetupStartedRef.current) return;
     bridgeSetupStartedRef.current = true;

     logger.log("[ConversationPanel] Hydrating entities...");
     hydrateEntities().then(() => {
       logger.log("[ConversationPanel] Hydration complete, setting up incoming bridge...");
       setupIncomingBridge().then(() => {
         logger.log("[ConversationPanel] Incoming bridge ready!");
         bridgeReadyRef.current = true;
         setBridgeReady(true);
         // ... rest of existing code
       });
     });
   }, []);
   ```

3. **Test:**
   - Start a new conversation from spotlight
   - Wait for it to complete
   - Send a follow-up message
   - Verify the agent resumes and responds

## Files to Modify

- `src/conversation-main.tsx` - Add `hydrateEntities()` call

## Related Documentation

- `plans/completed/cross-window-event-bridge.md` - Notes that hydration should happen (but wasn't implemented)
- `plans/spotlight-task-creation-snappiness.md` - Discusses selective hydration as optimization
