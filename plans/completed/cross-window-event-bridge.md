# Cross-Window Event Bridge

## Problem Statement

When a task is started from the spotlight panel, the conversation view shows "Loading conversation..." indefinitely instead of streaming the conversation in real-time.

### Root Cause Analysis

1. **Isolated JavaScript Contexts**: Each Tauri webview (spotlight, conversation panel, main window) runs in its own JS context with its own:
   - Zustand store instances
   - Mitt event bus instances
   - React component trees

2. **Mitt is In-Memory Only**: The `eventBus` created via `mitt<AppEvents>()` only works within a single JS context. Events emitted in spotlight never reach the conversation panel.

3. **One-Time Hydration**: Each window calls `hydrateEntities()` at startup, loading state from disk. When spotlight creates a new conversation, the conversation panel's store doesn't know about it.

4. **Streaming Data Stays Local**: Agent state updates flow like this:
   ```
   Agent runner (stdout) → agent-service.ts → onState callback → LOGGED ONLY
   ```
   The `onState` callback in `spotlight.tsx` just logs - it doesn't broadcast to other windows.

### Current Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│    Spotlight Panel      │     │   Conversation Panel    │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │ eventBus (mitt A) │  │     │  │ eventBus (mitt B) │  │
│  │ zustand store A   │  │     │  │ zustand store B   │  │
│  └───────────────────┘  │     │  └───────────────────┘  │
│                         │     │                         │
│  Agent streams here     │     │  Reads disk once        │
│  but events stay local  │     │  Never gets updates     │
└─────────────────────────┘     └─────────────────────────┘
            ╳ No connection between them ╳
```

### Target Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│    Spotlight Panel      │     │   Conversation Panel    │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │ eventBus (mitt)   │  │     │  │ eventBus (mitt)   │  │
│  │ zustand store     │  │     │  │ zustand store     │  │
│  └────────┬──────────┘  │     │  └────────┬──────────┘  │
│           │             │     │           │             │
│           ▼             │     │           ▲             │
│  ┌───────────────────┐  │     │  ┌───────────────────┐  │
│  │  Event Bridge     │  │     │  │  Event Bridge     │  │
│  │  (Tauri emit)     │──┼─────┼─▶│  (Tauri listen)   │  │
│  └───────────────────┘  │     │  └───────────────────┘  │
└─────────────────────────┘     └─────────────────────────┘
```

## Implementation Plan

### Phase 1: Event Bridge Infrastructure

#### 1.1 Create Event Bridge Module

Create `src/lib/event-bridge.ts`:

```typescript
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { eventBus, type AppEvents } from "@/entities/events";

// Events that should be broadcast across windows
const BROADCAST_EVENTS = [
  "agent:spawned",
  "agent:state",
  "agent:completed",
  "agent:error",
  "conversation:created",
  "conversation:updated",
  "conversation:status-changed",
] as const;

type BroadcastEvent = (typeof BROADCAST_EVENTS)[number];

/**
 * Bridges local mitt events to Tauri for cross-window broadcast.
 * Call this in windows that EMIT events (e.g., spotlight).
 */
export function setupOutgoingBridge(): void {
  for (const eventName of BROADCAST_EVENTS) {
    eventBus.on(eventName, (payload) => {
      emit(`app:${eventName}`, payload);
    });
  }
}

/**
 * Bridges incoming Tauri events to local mitt.
 * Call this in windows that RECEIVE events (e.g., conversation panel).
 */
export async function setupIncomingBridge(): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];

  for (const eventName of BROADCAST_EVENTS) {
    const unlisten = await listen<AppEvents[BroadcastEvent]>(
      `app:${eventName}`,
      (event) => {
        eventBus.emit(eventName, event.payload as any);
      }
    );
    unlisteners.push(unlisten);
  }

  return unlisteners;
}
```

#### 1.2 Update Entry Points

**spotlight-main.tsx** - emits events:
```typescript
import { setupOutgoingBridge } from "./lib/event-bridge";

// After hydrateEntities()
setupOutgoingBridge();
```

**conversation-main.tsx** - receives events:
```typescript
import { setupIncomingBridge } from "./lib/event-bridge";

// After hydrateEntities()
setupIncomingBridge();
```

### Phase 2: Emit Agent Events from Spotlight

#### 2.1 Update Spotlight Task Creation

In `src/components/spotlight/spotlight.tsx`, update `createTask()`:

```typescript
import { eventBus } from "@/entities";

async createTask(content: string): Promise<void> {
  // ... existing task/repo setup ...

  try {
    const conversation = await startAgent(
      { agentType: "coder", workingDirectory: latestVersion.path, prompt: content, taskId: task.id },
      {
        onState: (state) => {
          // Emit to local mitt → bridge forwards to Tauri → other windows
          eventBus.emit("agent:state", {
            conversationId: conversation.id,
            state
          });
        },
        onComplete: (exitCode, costUsd) => {
          eventBus.emit("agent:completed", {
            conversationId: conversation.id,
            exitCode,
            costUsd
          });
        },
        onError: (error) => {
          eventBus.emit("agent:error", {
            conversationId: conversation.id,
            error
          });
        },
      }
    );

    // Emit spawned event
    eventBus.emit("agent:spawned", {
      conversationId: conversation.id,
      taskId: task.id
    });

    await openConversation(conversation.id);
  } catch (error) {
    logger.error("Failed to start agent:", error);
  }
}
```

### Phase 3: Update Conversation Window to Use Streaming State

#### 3.1 Create Streaming Hook

Create `src/hooks/use-streaming-conversation.ts`:

```typescript
import { useState, useEffect } from "react";
import { eventBus } from "@/entities";
import type { ConversationState } from "@/lib/types/agent-messages";

/**
 * Hook that subscribes to real-time agent:state events.
 * Use this for live streaming during agent execution.
 */
export function useStreamingConversation(conversationId: string | null) {
  const [streamingState, setStreamingState] = useState<ConversationState | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    const handleState = ({ conversationId: id, state }: { conversationId: string; state: ConversationState }) => {
      if (id === conversationId) {
        setStreamingState(state);
      }
    };

    const handleCompleted = ({ conversationId: id }: { conversationId: string }) => {
      if (id === conversationId) {
        // Mark streaming as done - component can switch to disk-based state
      }
    };

    eventBus.on("agent:state", handleState);
    eventBus.on("agent:completed", handleCompleted);

    return () => {
      eventBus.off("agent:state", handleState);
      eventBus.off("agent:completed", handleCompleted);
    };
  }, [conversationId]);

  return { streamingState };
}
```

#### 3.2 Update Conversation Window

Update `src/components/conversation/conversation-window.tsx`:

```typescript
import { useStreamingConversation } from "@/hooks/use-streaming-conversation";
import { useConversationMessages } from "@/hooks/use-conversation-messages";

export function ConversationWindow({ conversationId }: ConversationWindowProps) {
  // Disk-based state (for completed conversations or recovery)
  const { conversationState: diskState, status: diskStatus } = useConversationMessages(conversationId);

  // Real-time streaming state
  const { streamingState } = useStreamingConversation(conversationId);

  // Prefer streaming state if available, fall back to disk state
  const conversationState = streamingState ?? diskState;
  const isStreaming = streamingState?.status === "running";

  // ... rest of component
}
```

### Phase 4: Handle Store Synchronization

#### 4.1 Re-hydrate on Conversation Open

The conversation panel may open before the new conversation is in its store. Add re-hydration:

In `src/conversation-main.tsx`:

```typescript
useEffect(() => {
  const unlistenPromise = listen<OpenConversationPayload>(
    "open-conversation",
    async (event) => {
      // Re-hydrate to pick up newly created conversation
      await conversationService.hydrate();
      setConversationId(event.payload.conversationId);
    }
  );
  // ...
}, []);
```

Or alternatively, listen for `conversation:created` events and add to store.

### Phase 5: Update Event Types

#### 5.1 Extend AppEvents Type

Update `src/entities/events.ts` to include cost in completed event:

```typescript
export type AppEvents = {
  // ... existing events ...
  "agent:completed": { conversationId: string; exitCode: number; costUsd?: number };
};
```

## File Changes Summary

| File | Change |
|------|--------|
| `src/lib/event-bridge.ts` | **NEW** - Tauri↔mitt bridge |
| `src/spotlight-main.tsx` | Add `setupOutgoingBridge()` |
| `src/conversation-main.tsx` | Add `setupIncomingBridge()`, re-hydrate on open |
| `src/components/spotlight/spotlight.tsx` | Emit events in `onState`/`onComplete`/`onError` callbacks |
| `src/hooks/use-streaming-conversation.ts` | **NEW** - Subscribe to streaming events |
| `src/components/conversation/conversation-window.tsx` | Use streaming hook, prefer live state |
| `src/entities/events.ts` | Add `costUsd` to completed event type |

## Testing Plan

1. **Basic streaming**: Start a task, verify conversation panel shows real-time updates
2. **Multi-window**: Open multiple conversation panels, verify all receive updates
3. **Completed conversations**: Open a past conversation, verify it loads from disk
4. **Recovery**: Kill app mid-stream, restart, verify conversation resumes from disk state
5. **Error handling**: Verify agent errors are displayed in conversation panel

## Future Considerations

1. **Debouncing**: If agent emits state very rapidly, consider debouncing Tauri events
2. **Selective broadcast**: Only broadcast to windows that have the conversation open
3. **State reconciliation**: Handle case where streaming state and disk state diverge
