# Phase 5: Remove Prop Drilling from MessageList → TurnRenderer Chain

This is the final cleanup phase. By this point, Phases 1–4 have introduced context, selector hooks, and streaming isolation. This phase removes the now-unnecessary props from the intermediate components.

## MessageList

### Before (current)

```tsx
interface MessageListProps {
  threadId: string;
  turns: Turn[];
  messages: MessageParam[];
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  onToolResponse?: (toolId: string, response: string) => void;
  workingDirectory?: string;
}
```

Usage: `MessageList` passes `messages`, `isStreaming`, `toolStates`, `onToolResponse`, `threadId`, and `workingDirectory` through to each `TurnRenderer`. It uses `threadId` directly for `StreamingContent` and the `hasStreamingContent` store selector. It uses `isStreaming` for `showWorkingIndicator` logic and to pass to `TurnRenderer`. It uses `workingDirectory` for `StreamingContent`.

### After

```tsx
interface MessageListProps {
  turns: Turn[];
}
```

- `threadId` → from `useThreadContext()` (Phase 1)
- `messages` → removed; `AssistantMessage` selects its own content via `useMessageContent` (Phase 2)
- `isStreaming` → removed; `MessageList` derives `showWorkingIndicator` from `useThreadStore` thread status selector (Phase 4)
- `toolStates` → removed; each tool block selects its own via `useToolState` (Phase 3)
- `onToolResponse` → removed; never actually passed by any parent (dead prop); `LiveAskUserQuestion` already uses `questionService.respond()` for live questions
- `workingDirectory` → from `useThreadContext()` (Phase 1)

`turns` remains as a prop because `MessageList` needs the array for virtual list `count` and for indexing which turn to render at each virtual slot. This is structural data for the virtualizer, not content data.

### MessageList internal changes

The `hasStreamingContent` selector and `showWorkingIndicator` logic currently depend on `threadId` (prop) and `isStreaming` (prop). After phases 1 and 4:

```tsx
// Before
const showWorkingIndicator = useMemo(() => {
  if (!isStreaming || turns.length === 0) return false;
  const lastTurn = turns[turns.length - 1];
  return lastTurn?.type === "user";
}, [isStreaming, turns]);

// After
const { threadId } = useThreadContext();
const threadIsRunning = useThreadStore(
  useCallback(s => s.threads[threadId]?.status === "running", [threadId])
);
const showWorkingIndicator = useMemo(() => {
  if (!threadIsRunning || turns.length === 0) return false;
  const lastTurn = turns[turns.length - 1];
  return lastTurn?.type === "user";
}, [threadIsRunning, turns]);
```

`StreamingContent` currently receives `threadId` and `workingDirectory` as props. After Phase 1, both come from `useThreadContext()` inside `StreamingContent` itself (or passed from MessageList which gets them from context — either way, no longer drilled from parent).

## TurnRenderer

### Before (current)

```tsx
interface TurnRendererProps {
  turn: Turn;
  turnIndex: number;
  messages: MessageParam[];
  isLast?: boolean;
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  onToolResponse?: (toolId: string, response: string) => void;
  threadId: string;
  workingDirectory?: string;
}
```

Usage: `TurnRenderer` routes to `UserMessage` (just `turn`) or `AssistantMessage` (passing `messages`, `messageIndex`, `isStreaming && isLast`, `toolStates`, `onToolResponse`, `threadId`, `workingDirectory`).

### After

```tsx
interface TurnRendererProps {
  turn: Turn;
  turnIndex: number;
}
```

All removed props are either from context or selected by child components:

- `messages` → removed; `AssistantMessage` selects its own content (Phase 2)
- `isLast` → removed; `AssistantMessage` derives its own streaming state via `useIsStreamingMessage` (Phase 4)
- `isStreaming` → removed; same as above (Phase 4)
- `toolStates` → removed; each tool block selects its own (Phase 3)
- `onToolResponse` → removed; dead prop (Phase 2)
- `threadId` → from `useThreadContext()` (Phase 1)
- `workingDirectory` → from `useThreadContext()` (Phase 1)

TurnRenderer simplifies to:

```tsx
function TurnRenderer({ turn, turnIndex }: TurnRendererProps) {
  if (turn.type === "user" && (isToolResultOnlyTurn(turn) || isSystemInjectedTurn(turn))) {
    return null;
  }

  if (turn.type === "user") {
    return (
      <div data-testid={`user-message-${turnIndex}`}>
        <UserMessage turn={turn} />
      </div>
    );
  }

  return (
    <div data-testid={`assistant-message-${turnIndex}`}>
      <AssistantMessage messageIndex={turn.messageIndex} />
    </div>
  );
}
```

## AssistantMessage

### Before (current)

```tsx
interface AssistantMessageProps {
  messages: MessageParam[];
  messageIndex: number;
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  onToolResponse?: (toolId: string, response: string) => void;
  threadId: string;
  workingDirectory?: string;
}
```

Usage: Does `messages[messageIndex]` to get content blocks. Uses `toolStates?.[block.id]` for each tool block's state. Passes `isStreaming && isLastBlock` to `TextBlock` for cursor. Wraps everything in `WorkspaceRootProvider` with `workingDirectory`. Passes `onToolResponse` to `LiveAskUserQuestion`.

### After (Phase 2)

```tsx
interface AssistantMessageProps {
  messageIndex: number;
}
```

- `messages` → removed; uses `useMessageContent(threadId, messageIndex)` selector (Phase 2)
- `isStreaming` → removed; uses `useIsStreamingMessage(threadId, messageIndex)` hook (Phase 4)
- `toolStates` → removed; each tool block uses `useToolState` internally (Phase 3)
- `onToolResponse` → removed; dead prop, `LiveAskUserQuestion` uses `questionService.respond()` (Phase 2)
- `threadId` → from `useThreadContext()` (Phase 1)
- `workingDirectory` → from `useThreadContext()` (Phase 1); replaces `WorkspaceRootProvider` wrapper

## ThreadView

### Before (current)

```tsx
interface ThreadViewProps {
  threadId: string;
  messages: MessageParam[];
  isStreaming: boolean;
  status: ThreadStatus;
  error?: string;
  onRetry?: () => void;
  toolStates?: Record<string, ToolExecutionState>;
  onToolResponse?: (toolId: string, response: string) => void;
  workingDirectory?: string;
}
```

Usage: Calls `groupMessagesIntoTurns(messages)`. Uses `messages.length === 0` for empty/error checks. Uses `isStreaming` for empty state guard. Passes all props through to `MessageList`.

Note: `onToolResponse` is declared in the interface but **never passed** by any call site (ThreadContent, ChatPane, ControlPanelWindow all omit it).

### After

```tsx
interface ThreadViewProps {
  threadId: string;
  messages: MessageParam[];
  status: ThreadStatus;
  error?: string;
  onRetry?: () => void;
  workingDirectory?: string;
}
```

- `isStreaming` → removed; ThreadView derives this from `status === "running"` for its empty state guard, or reads thread status from the store (Phase 4)
- `toolStates` → removed; each tool block selects its own (Phase 3)
- `onToolResponse` → removed; dead prop, never passed by any call site

`messages` stays as a prop to ThreadView because ThreadView uses it for:
1. `groupMessagesIntoTurns(messages)` — needs the full array for turn computation
2. Empty state check (`messages.length === 0`)
3. Error state rendering guard (`status === "error" && messages.length > 0`)

This is the right level for that prop — ThreadView is the boundary between "data fetching" (ThreadContent) and "rendering" (MessageList). ThreadContent owns the message computation (including optimistic messages), and ThreadView does turn grouping.

### ThreadView render after changes

```tsx
<ThreadProvider threadId={threadId} workingDirectory={workingDirectory ?? ""}>
  <MessageList ref={ref} turns={turns} />
</ThreadProvider>
```

Note on `isStreaming` removal from ThreadView: currently ThreadView uses `isStreaming` in two places:
1. Empty state: `messages.length === 0 && !isStreaming` — can use `status !== "running"` instead since `isStreaming` is derived from `viewStatus === "running"` in ThreadContent
2. `EmptyState` component: `<EmptyState isRunning={isStreaming} />` — can use `status === "running"` instead

Both are equivalent since `isStreaming` is always `viewStatus === "running"` in the parent. After the change, ThreadView's status guards become:

```tsx
if (status === "idle" || (messages.length === 0 && status !== "running")) {
  return <EmptyState isRunning={status === "running"} />;
}
```

## ThreadContent → ThreadView (call site changes)

### Before (current)

```tsx
<ThreadView
  key={threadId}
  ref={messageListRef}
  threadId={threadId}
  messages={messages}
  isStreaming={isStreaming}
  status={viewStatus}
  toolStates={toolStates}
  workingDirectory={workingDirectory || undefined}
  error={activeState?.error}
/>
```

### After

```tsx
<ThreadView
  key={threadId}
  ref={messageListRef}
  threadId={threadId}
  messages={messages}
  status={viewStatus}
  workingDirectory={workingDirectory || undefined}
  error={activeState?.error}
/>
```

Removed: `isStreaming`, `toolStates`. The `onRetry` prop is retained in the interface (some call sites like ChatPane pass it) but isn't shown in this call site.

The `isStreaming` and `toolStates` derivations in ThreadContent (`const isStreaming = viewStatus === "running"` and `const toolStates = ...`) can also be deleted as dead code.

## StreamingContent

### Before (current)

```tsx
interface StreamingContentProps {
  threadId: string;
  workingDirectory?: string;
}
```

Rendered by `MessageList` with explicit props.

### After

```tsx
// No props needed — reads everything from context and store
function StreamingContent() {
  const { threadId, workingDirectory } = useThreadContext();
  const blocks = useStreamingBlocks(threadId);
  // ...
}
```

`StreamingContent` already reads streaming blocks from `useThreadStore` internally. After Phase 1, `threadId` and `workingDirectory` come from context, eliminating the need for any props.

## `onToolResponse` removal analysis

`onToolResponse` is a dead prop throughout the entire chain:

| Component | Declares in interface? | Actually passed by parent? |
|---|---|---|
| `ThreadView` | Yes | **No** — ThreadContent, ChatPane, ControlPanelWindow all omit it |
| `MessageList` | Yes | **No** — ThreadView's `<MessageList>` JSX never includes it |
| `TurnRenderer` | Yes | **Yes** — MessageList passes `onToolResponse={onToolResponse}` (but value is always `undefined`) |
| `AssistantMessage` | Yes | **Yes** — TurnRenderer passes it (always `undefined`) |
| `LiveAskUserQuestion` | Yes | **Yes** — AssistantMessage passes it (always `undefined`) |

In `LiveAskUserQuestion`, the prop is only used as a fallback for historical/completed questions:
```tsx
onSubmit={(response) => onToolResponse?.(blockId, response)}
```

Since `onToolResponse` is always `undefined`, this callback never fires. All live question answering goes through `questionService.respond()`. Safe to remove entirely.

## Verification

After all five phases, the prop chains should be:

```
ThreadContent
  → ThreadView: threadId, messages, status, error, onRetry?, workingDirectory?
    → [ThreadProvider wraps below with threadId + workingDirectory]
    → MessageList: turns
      → TurnRenderer: turn, turnIndex
        → UserMessage: turn
        → AssistantMessage: messageIndex
          → [reads content via useMessageContent(threadId, messageIndex)]
          → [reads isStreaming via useIsStreamingMessage(threadId, messageIndex)]
          → TextBlock: content, isStreaming, workingDirectory (leaf — fine as props)
          → ThinkingBlock: content, threadId, blockKey (leaf — fine as props)
          → ToolBlockRouter: toolUseId, toolName, toolInput
            → LiveAskUserQuestion: blockId, blockInput, threadId (uses questionService + useToolState)
            → [SpecializedBlock]: id, name, input, threadId (selects own state via useToolState)
            → ToolUseBlock: id, name, input, threadId (selects own state via useToolState)
      → StreamingContent: (no props — uses useThreadContext + useStreamingBlocks)
      → WorkingIndicator: (no props)
```

Every intermediate component passes only structural identifiers. Content data is selected at the leaf.

## Implementation checklist

1. Remove `threadId`, `workingDirectory`, `messages`, `isStreaming`, `toolStates`, `onToolResponse` from `MessageListProps`
2. Update `MessageList` to use `useThreadContext()` for `threadId` / `workingDirectory`
3. Update `MessageList` to derive `showWorkingIndicator` from store status instead of `isStreaming` prop
4. Remove all passthrough props from `MessageList` → `TurnRenderer` JSX
5. Remove `messages`, `isLast`, `isStreaming`, `toolStates`, `onToolResponse`, `threadId`, `workingDirectory` from `TurnRendererProps`
6. Update `TurnRenderer` to pass only `messageIndex` to `AssistantMessage`
7. Simplify `AssistantMessage` to zero-prop interface (just `messageIndex`)
8. Update `StreamingContent` to use context instead of props
9. Remove `isStreaming`, `toolStates`, `onToolResponse` from `ThreadViewProps`
10. Update `ThreadView` to derive streaming state from `status` prop
11. Remove `isStreaming` and `toolStates` derivations from ThreadContent (dead code cleanup)
12. Update all three ThreadView call sites (ThreadContent, ChatPane, ControlPanelWindow)
