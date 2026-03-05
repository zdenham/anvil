# Phase 1: Thread Context Provider + Shared Selector Hooks

## Thread Context

Create a lightweight React context at the `ThreadView` level to eliminate prop drilling of values that are stable for the lifetime of a thread view.

### File: `src/components/thread/thread-context.tsx`

```tsx
import { createContext, useContext, useMemo } from "react";

interface ThreadContextValue {
  threadId: string;
  workingDirectory: string;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function ThreadProvider({
  threadId,
  workingDirectory,
  children,
}: ThreadContextValue & { children: React.ReactNode }) {
  // Memoize the value to prevent re-renders when parent re-renders
  const value = useMemo(
    () => ({ threadId, workingDirectory }),
    [threadId, workingDirectory]
  );
  return (
    <ThreadContext.Provider value={value}>
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreadContext() {
  const ctx = useContext(ThreadContext);
  if (!ctx) throw new Error("useThreadContext must be used within ThreadProvider");
  return ctx;
}
```

**Why context instead of zustand?** `threadId` and `workingDirectory` are already known from the component tree — they don't come from a global store. Context is the correct React primitive for "values that scope a subtree." The store holds the *data* those IDs point to.

### Provider placement

In `thread-view.tsx`, wrap the `MessageList` with `ThreadProvider`:

```tsx
<ThreadProvider threadId={threadId} workingDirectory={workingDirectory ?? ""}>
  <MessageList ref={ref} turns={turns} messages={messages} isStreaming={isStreaming} />
</ThreadProvider>
```

This replaces the existing `WorkspaceRootProvider` (which currently lives inside `AssistantMessage` and serves the same purpose for `workingDirectory`). The `WorkspaceRootProvider` is defined in `src/hooks/use-workspace-root.ts` and wraps the entire `<article>` in `AssistantMessage`.

## Shared Selector Hooks

### File: `src/hooks/use-thread-selectors.ts`

These hooks encapsulate zustand selectors with proper equality checks so multiple components can reuse them without duplicating selector logic.

**Store shape reference** (from `src/entities/threads/store.ts`):

```
threadStates: Record<string, ThreadRenderState>
```

Where `ThreadRenderState` is `ThreadState` (from `core/types/events.ts`):

```
ThreadState {
  messages: StoredMessage[]       // StoredMessage = { id, role, content, ... }
  fileChanges: FileChange[]
  workingDirectory: string
  status: AgentThreadStatus       // "running" | "complete" | "error" | "cancelled"
  timestamp: number
  toolStates: Record<string, ToolExecutionState>
  sessionId?: string
  lastCallUsage?: TokenUsage
  cumulativeUsage?: TokenUsage
  metrics?: ResultMetrics
  error?: string
}
```

During streaming, `ThreadStateMachine.getState()` appends a WIP message to the `messages` array. WIP message content blocks have `isStreaming: true` (typed as `RenderContentBlock` from `core/types/events.ts`).

```ts
import { useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useThreadStore } from "@/entities/threads/store";
import type { ToolExecutionState, StoredMessage } from "@core/types/events";

/**
 * Select a single message by index from a thread's render state.
 * Returns undefined if the message doesn't exist yet.
 *
 * Path: threadStates[threadId].messages[messageIndex]
 */
export function useMessage(threadId: string, messageIndex: number): StoredMessage | undefined {
  return useThreadStore(
    useCallback(
      (s) => s.threadStates[threadId]?.messages?.[messageIndex],
      [threadId, messageIndex]
    )
  );
}

/**
 * Select content blocks for a specific message.
 * Uses referential equality — see "Why useShallow" section below.
 *
 * Path: threadStates[threadId].messages[messageIndex].content
 */
export function useMessageContent(threadId: string, messageIndex: number): unknown[] {
  return useThreadStore(
    useCallback(
      (s) => {
        const msg = s.threadStates[threadId]?.messages?.[messageIndex];
        return Array.isArray(msg?.content) ? msg.content : [];
      },
      [threadId, messageIndex]
    )
  );
}

/**
 * Select tool execution state for a specific tool use ID.
 * Only re-renders when THIS tool's state changes.
 *
 * Path: threadStates[threadId].toolStates[toolUseId]
 *
 * ToolExecutionState shape (all primitives):
 *   { status: "running" | "complete" | "error", result?: string, isError?: boolean, toolName?: string }
 */
export function useToolState(threadId: string, toolUseId: string): ToolExecutionState {
  return useThreadStore(
    useShallow(
      useCallback(
        (s) => s.threadStates[threadId]?.toolStates?.[toolUseId] ?? { status: "running" as const },
        [threadId, toolUseId]
      )
    )
  );
}

/**
 * Select just the message count for the thread.
 * Useful for determining "is last message" without subscribing to content changes.
 *
 * Path: threadStates[threadId].messages.length
 */
export function useMessageCount(threadId: string): number {
  return useThreadStore(
    useCallback(
      (s) => s.threadStates[threadId]?.messages?.length ?? 0,
      [threadId]
    )
  );
}
```

### Why `useShallow` on `useToolState` (and not the others)

State updates flow through two paths into the store:

1. **During streaming**: `store.dispatch()` runs the event through `ThreadStateMachine.apply()`, which calls the shared `threadReducer`. The reducer uses spread operators (`{ ...state, toolStates: { ...state.toolStates, [id]: newTool } }`) — each reducer call produces a new top-level `ThreadRenderState` object, but only the changed nested objects get new references. A tool state object is only recreated when that specific tool's status changes (e.g., `MARK_TOOL_RUNNING`, `MARK_TOOL_COMPLETE`).

2. **During HYDRATE (cold start / reconnect)**: `store.setThreadState()` calls `machine.apply({ type: "HYDRATE", state })`, which does `this.threadState = { ...state }` and clears the WIP overlay. This replaces the entire `ThreadState`, so every nested value (including individual tool state objects) gets a new reference, even if the content is identical.

Because HYDRATE produces new references for all tool states, `useShallow` is needed on `useToolState` to prevent every tool block from re-rendering on hydration. `useShallow` does a one-level-deep comparison, which is sufficient because `ToolExecutionState` properties are all primitives (`status`, `result`, `isError`, `toolName`).

For `useMessage` and `useMessageContent`, the situation is more nuanced:
- During streaming, committed messages keep their references (the reducer only spreads the `messages` array, not individual messages).
- The WIP message is a fresh object each time, but it only appears as the *last* message — committed messages at earlier indices are stable.
- During HYDRATE, all messages get new references. However, messages are rendered by `TurnRenderer` which already receives its data via the `messages` prop from `MessageList`, so these hooks would primarily be used in Phase 2+ when we switch to index-based rendering. At that point, if profiling shows over-firing, we can add `useShallow` or a deep-equal comparator.

**Bottom line**: `useShallow` is needed on `useToolState` now. The other hooks can start with referential equality and be upgraded if profiling warrants it.

## Changes to existing files

| File | Change |
|---|---|
| `src/components/thread/thread-view.tsx` | Wrap `MessageList` in `ThreadProvider`, stop passing `threadId` / `workingDirectory` as props to `MessageList` |
| `src/components/thread/message-list.tsx` | Remove `threadId`, `workingDirectory` from `MessageListProps`. Get from `useThreadContext()`. Update `TurnRenderer`, `StreamingContent` callsites. |
| `src/components/thread/turn-renderer.tsx` | Remove `threadId`, `workingDirectory` from `TurnRendererProps`. Get from `useThreadContext()`. Update `AssistantMessage` callsite. |
| `src/components/thread/assistant-message.tsx` | Remove `threadId`, `workingDirectory` from `AssistantMessageProps`. Get from `useThreadContext()`. Remove `WorkspaceRootProvider` wrapper (replaced by `ThreadProvider`). |
| `src/components/thread/streaming-content.tsx` | Remove `workingDirectory` from `StreamingContentProps`. Get from `useThreadContext()`. (Already reads `threadId` from its own prop — switch to context.) |
| `src/hooks/use-workspace-root.ts` | Keep file for now (some tool blocks may still use `useWorkspaceRoot()`). Consumers can migrate to `useThreadContext().workingDirectory` in follow-up. |

### Props that continue to drill (intentionally)

These props are **not** moved to context because they change per-render or per-item:

| Prop | Reason |
|---|---|
| `turns` / `messages` | Array data that changes on every new message — belongs in props or store selectors, not context |
| `isStreaming` | Derived from `viewStatus` in `ThreadContent`, changes frequently |
| `toolStates` | The full `Record<string, ToolExecutionState>` is passed as a prop today. In Phase 2+, individual components will use `useToolState(threadId, toolUseId)` instead, eliminating this prop entirely. |
| `onToolResponse` | Callback prop. Currently `undefined` (not wired from `ThreadContent`). When it is wired, it should stay as a prop or move to context depending on how many components need it. |

## Risk: selector stability with reducer-produced state

### During streaming (low risk)

The `threadReducer` produces state via immutable spread patterns. Each action only creates new references for the specific subtree it modifies:
- `MARK_TOOL_RUNNING` / `MARK_TOOL_COMPLETE` → new `toolStates` object and new entry for the specific tool ID
- `APPEND_ASSISTANT_MESSAGE` → new `messages` array, existing message objects keep references
- `STREAM_DELTA` → new WIP message content array, but this only affects the last (WIP) message

This means selectors for a specific message index or tool ID will only fire when that specific data changes. Low re-render risk.

### During HYDRATE (medium risk)

HYDRATE replaces the entire `ThreadState` (`this.threadState = { ...state }`). Every nested object and array gets a new reference. This happens:
- On cold start (loading thread from disk)
- On reconnect (gap detected in seq numbers)
- When `setThreadState` is called from `threadService`

With `useShallow` on `useToolState`, tool blocks are protected. For `useMessage` / `useMessageContent`, HYDRATE-induced re-renders are acceptable because:
1. HYDRATE is infrequent (startup, reconnect)
2. Content likely *did* change if we're hydrating (gap recovery means we missed actions)
3. If profiling shows issues, we can add deep-equal comparators to those hooks

### WIP message overlay (low risk)

`ThreadStateMachine.getState()` merges committed state with the WIP message:
```ts
return { ...this.threadState, messages: [...this.threadState.messages, this.wipMessage] };
```

This creates a new `messages` array and top-level state object on every streaming delta. However:
- Committed messages at indices 0..N-1 retain their original references
- Only the WIP message at index N is new
- Selectors for `messages[i]` where `i < N` will see the same reference and skip re-render

**Mitigation**: Add a quick perf check with React DevTools Profiler after this phase to confirm selectors are not over-firing, particularly during HYDRATE and rapid streaming.
