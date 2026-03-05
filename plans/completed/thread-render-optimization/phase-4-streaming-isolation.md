# Phase 4: Streaming Isolation

## Current problem

`isStreaming` is a boolean prop that drills from the top-level container through five component layers:

```
ThreadContent / ControlPanelWindowContent
  derives: isStreaming = viewStatus === "running"

  → ThreadView (prop: isStreaming)
    → MessageList (prop: isStreaming)
      → TurnRenderer (prop: isStreaming, combined with isLast)
        → AssistantMessage (prop: isStreaming)
          → TextBlock (prop: isStreaming, rendered as cursor)
```

When streaming starts or stops, this boolean flip re-renders the **entire** tree: `ThreadView`, `MessageList`, every `TurnRenderer`, every `AssistantMessage`, and every `TextBlock`. But only three consumers actually need the value:

| Consumer | What it needs | Current source |
|---|---|---|
| `MessageList` | "is thread running?" to decide `WorkingIndicator` vs streaming slot | `isStreaming` prop |
| `AssistantMessage` | "am I the streaming message?" to pass `showCursor` to last `TextBlock` | `isStreaming && isLast` prop chain |
| `TextBlock` | `showCursor` for blinking cursor + `MarkdownRenderer` streaming mode | `isStreaming` prop from `AssistantMessage` |

Meanwhile, `StreamingContent` (the component that renders the actual streaming text via `TrickleBlock`) already reads directly from the store and does not use the `isStreaming` prop at all.

### Why this is wasteful

`ThreadView` and `TurnRenderer` are pure pass-throughs — they forward the prop but never read it. Every non-last `TurnRenderer` and `AssistantMessage` receives `isStreaming={false}` (because of the `isLast && isStreaming` guard), so the prop flip from `false` to `false` is a no-op... but React still re-renders the parent (`MessageList`) which re-renders all items.

## Architecture context

### ThreadStateMachine + store

The streaming architecture now centers on `ThreadStateMachine` (in `src/lib/thread-state-machine.ts`):

- **Committed state**: applied via `THREAD_ACTION` through the shared reducer. Contains only persisted messages.
- **WIP message**: an overlay created by `STREAM_DELTA` events. Content blocks in the WIP message have `isStreaming: true` set per-block.
- **`getState()`** merges committed + WIP: `[...committedMessages, wipMessage]`.
- The store's `threadStates[threadId]` holds this merged `ThreadRenderState`.

### StreamingContent component

`StreamingContent` already reads streaming blocks from the store:

```ts
// streaming-content.tsx
function useStreamingBlocks(threadId: string) {
  return useThreadStore(useCallback((s) => {
    const state = s.threadStates[threadId];
    const last = state.messages[state.messages.length - 1];
    return (last.content as RenderContentBlock[])
      .filter((b) => b.isStreaming === true);
  }, [threadId]));
}
```

It renders them via `TrickleBlock` with a `StreamingCursor` on the last block. This component is independent of the prop chain.

### MessageList streaming slot

`MessageList` reserves a slot at `index === turns.length` for either `StreamingContent` or `WorkingIndicator`. The decision is:

```ts
const showStreamingSlot = hasStreamingContent || showWorkingIndicator;
```

Where `hasStreamingContent` already reads from the store, but `showWorkingIndicator` depends on the `isStreaming` prop.

### AssistantMessage cursor

`AssistantMessage` uses `isStreaming` prop to show a blinking cursor on its last `TextBlock`. This cursor is for **committed messages that are still being streamed** (rare edge case with the new architecture where WIP messages are separate). In practice, since WIP content is now rendered by `StreamingContent` with its own cursor, this cursor on `AssistantMessage` is mainly a remnant.

However, there is a brief window where committed content arrives (via `APPEND_ASSISTANT_MESSAGE` action) while the thread is still running, where this cursor provides visual continuity. We should preserve this behavior but source it from the store.

## Solution

### 1. `useIsThreadRunning` hook — replace the drilled boolean

Create a targeted hook that reads thread running state from the store:

```ts
// src/hooks/use-is-thread-running.ts
import { useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";

/**
 * Returns true when the thread's metadata status is "running".
 * Uses a primitive boolean selector — only fires when the value changes.
 */
export function useIsThreadRunning(threadId: string): boolean {
  return useThreadStore(
    useCallback(
      (s) => s.threads[threadId]?.status === "running",
      [threadId],
    ),
  );
}
```

This reads from `ThreadMetadata.status` (the entity-level status), which is the same source `ThreadContent` uses today: `entityStatus === "running"` after mapping through `viewStatus`.

### 2. Remove `isStreaming` from `MessageList` props

`MessageList` uses `isStreaming` for exactly one thing: `showWorkingIndicator`.

**Before:**
```ts
const showWorkingIndicator = useMemo(() => {
  if (!isStreaming || turns.length === 0) return false;
  const lastTurn = turns[turns.length - 1];
  return lastTurn?.type === "user";
}, [isStreaming, turns]);
```

**After:**
```ts
const isRunning = useIsThreadRunning(threadId);

const showWorkingIndicator = useMemo(() => {
  if (!isRunning || turns.length === 0) return false;
  const lastTurn = turns[turns.length - 1];
  return lastTurn?.type === "user";
}, [isRunning, turns]);
```

Remove `isStreaming` from `MessageListProps` entirely. Remove it from the `TurnRenderer` call too — `TurnRenderer` no longer receives or forwards `isStreaming`.

### 3. Remove `isStreaming` from `TurnRenderer` props

`TurnRenderer` currently combines `isLast && isStreaming` and passes it to `AssistantMessage`. After this change, `TurnRenderer` does not receive `isStreaming` at all.

**Before:**
```tsx
<AssistantMessage
  messages={messages}
  messageIndex={turn.messageIndex}
  isStreaming={isLast && isStreaming}
  ...
/>
```

**After:**
```tsx
<AssistantMessage
  messages={messages}
  messageIndex={turn.messageIndex}
  isLast={isLast}
  ...
/>
```

`TurnRenderer` passes `isLast` so `AssistantMessage` can derive streaming state itself.

### 4. `AssistantMessage` derives its own streaming state

`AssistantMessage` currently receives `isStreaming` as a prop and uses it for `showCursor` on the last `TextBlock`. Replace with a store read:

```ts
const AssistantMessage = memo(function AssistantMessage({
  messages,
  messageIndex,
  isLast = false,
  toolStates,
  onToolResponse,
  threadId,
  workingDirectory,
}: AssistantMessageProps) {
  const isRunning = useIsThreadRunning(threadId);
  const isStreaming = isLast && isRunning;

  // ... rest unchanged, uses isStreaming for showCursor
});
```

Only the last `AssistantMessage` (where `isLast === true`) subscribes meaningfully to the running state. All other instances short-circuit: `isLast` is `false`, so `isStreaming` is always `false` regardless of the store value. The `memo` wrapper prevents re-renders when the derived value doesn't change.

**Key point:** `useIsThreadRunning` returns a primitive boolean, so the selector only triggers when the value actually changes. Non-last messages never re-render from streaming state changes.

### 5. Remove `isStreaming` from `ThreadView` props

`ThreadView` currently receives `isStreaming` and forwards it to `MessageList`. It also uses it for `EmptyState`:

```ts
if (status === "idle" || (messages.length === 0 && !isStreaming)) {
  return <EmptyState isRunning={isStreaming} />;
}
```

**After:**
```ts
const isRunning = useIsThreadRunning(threadId);

if (status === "idle" || (messages.length === 0 && !isRunning)) {
  return <EmptyState isRunning={isRunning} />;
}
```

Remove `isStreaming` from `ThreadViewProps`. `ThreadView` reads its own running state from the store.

### 6. Remove `isStreaming` derivation from `ThreadContent` / `ControlPanelWindowContent`

These top-level components currently derive `isStreaming = viewStatus === "running"` and pass it to `ThreadView`. After this change:

- Remove `const isStreaming = viewStatus === "running"` (no longer needed for `ThreadView`)
- `ThreadView` no longer receives `isStreaming` prop
- `ControlPanelHeader` still needs `isStreaming` for its status dot and cancel button — derive it locally from the store or keep the existing derivation for the header only

**Important:** `ControlPanelHeader` receives `isStreaming` for the status dot indicator and the cancel button. This is a separate concern from the thread rendering chain. The header can either:
- (a) Keep receiving `isStreaming` from `ControlPanelWindowContent` (it already has the derivation for other reasons like `canQueueMessages`)
- (b) Read from the store directly via `useIsThreadRunning`

Option (a) is simpler since `ControlPanelWindowContent` already has the `viewStatus` for queue/resume logic. The goal is to remove the prop from the **thread rendering chain**, not from every consumer.

## Changes summary

| Component | Before | After |
|---|---|---|
| `ThreadContent` | derives `isStreaming`, passes to `ThreadView` | keeps `viewStatus` for queue logic, does NOT pass `isStreaming` to `ThreadView` |
| `ControlPanelWindowContent` | derives `isStreaming`, passes to `ThreadView` + header | passes to header only, NOT to `ThreadView` |
| `ThreadView` | receives `isStreaming` prop, forwards to `MessageList` | reads `useIsThreadRunning(threadId)` for `EmptyState` guard |
| `MessageList` | receives `isStreaming` prop for `showWorkingIndicator` | reads `useIsThreadRunning(threadId)` directly |
| `TurnRenderer` | receives `isStreaming`, combines with `isLast`, forwards | receives `isLast` only, no `isStreaming` |
| `AssistantMessage` | receives `isStreaming` prop for cursor | receives `isLast`, reads `useIsThreadRunning(threadId)` |
| `TextBlock` | receives `isStreaming` for cursor (unchanged) | unchanged — still receives from `AssistantMessage` |
| `StreamingContent` | reads from store (unchanged) | unchanged |

## New file

```
src/hooks/use-is-thread-running.ts   (~10 lines)
```

## Files modified

```
src/components/content-pane/thread-content.tsx     — remove isStreaming prop from ThreadView
src/components/control-panel/control-panel-window.tsx — remove isStreaming prop from ThreadView
src/components/thread/thread-view.tsx              — remove isStreaming prop, add useIsThreadRunning
src/components/thread/message-list.tsx             — remove isStreaming prop, add useIsThreadRunning
src/components/thread/turn-renderer.tsx            — remove isStreaming prop, pass isLast to AssistantMessage
src/components/thread/assistant-message.tsx         — remove isStreaming prop, add isLast + useIsThreadRunning
```

## Impact

**Before:** streaming start/stop triggers re-render of `ThreadView` + `MessageList` + every `TurnRenderer` + every `AssistantMessage`.

**After:** streaming start/stop only re-renders:
- `ThreadView` (only if it's on the `EmptyState` boundary — `messages.length === 0`)
- `MessageList` (for `showWorkingIndicator` logic — primitive boolean selector)
- The **last** `AssistantMessage` (for cursor display)
- `StreamingContent` (already optimized — reads from store)

All other messages: **zero re-renders** from streaming state changes.

## Edge cases

1. **Optimistic "running" state in `ThreadContent`**: `ThreadContent` derives `viewStatus === "running"` for cases where there's an optimistic prompt but no real messages yet. This still works because `useIsThreadRunning` reads from `ThreadMetadata.status`, which is set to `"running"` when the agent starts. The brief gap before agent start is covered by `ThreadContent`'s `viewStatus` logic for the `EmptyState` guard in `ThreadView` — but since `ThreadView` now reads from the store, we need to ensure the metadata status is updated before the first render. This is already the case: `threadService.setActiveThread()` fires before the component mounts.

2. **WIP cursor duplication**: The committed `AssistantMessage` shows a cursor via `showCursor`, and `StreamingContent` shows its own `StreamingCursor`. These never overlap because WIP content is in a separate message from committed content — the `ThreadStateMachine` only merges them in `getState()`, and the WIP message always appears as the last message in the array, which is rendered in the streaming slot (not as a `TurnRenderer` item).

3. **`ControlPanelHeader` cancel button**: The header needs to know if the thread is streaming to show the cancel button. This is NOT part of the thread rendering chain and remains unchanged — `ControlPanelWindowContent` keeps its `isStreaming` derivation for the header and queue logic.
