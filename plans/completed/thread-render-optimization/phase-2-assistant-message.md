# Phase 2: Refactor AssistantMessage to Select Its Own Data

## Current problem

`AssistantMessage` receives the **entire `messages[]` array** as a prop, just to do `messages[messageIndex]`. It also receives the `toolStates` record to compute per-tool state inline during render. This means:

- Any new message appended → all AssistantMessage instances re-render (new array ref)
- Any tool state change → all AssistantMessage instances re-render (new record ref)
- `React.memo` can't help because prop references always change

## Streaming architecture context

The streaming architecture has split assistant rendering into two paths:

1. **`AssistantMessage`** — renders **committed** content blocks from `threadStates[threadId].messages[messageIndex]`. These are blocks that have been persisted and applied through `ThreadStateMachine`'s `THREAD_ACTION` path.
2. **`StreamingContent`** (`src/components/thread/streaming-content.tsx`) — renders **WIP** content blocks from `ThreadStateMachine`'s WIP overlay. These are in-flight text/thinking blocks with `isStreaming: true`, rendered via `TrickleBlock` with a blinking cursor.

`MessageList` reserves a separate "streaming slot" at the end of the virtual list. When `hasStreamingContent` is true (WIP blocks exist in the last message), the slot renders `StreamingContent`. When the thread is running but no WIP blocks exist yet, it renders `WorkingIndicator`.

**Key implication**: `AssistantMessage` never renders WIP streaming blocks. The `isStreaming` prop it currently receives is used solely to show a cursor on the last committed text block during streaming. However, with `StreamingContent` now handling cursor display on WIP blocks, the `isStreaming` prop on `AssistantMessage` is **vestigial** — committed blocks should not show a streaming cursor because any active streaming content is rendered by `StreamingContent` in its dedicated slot. This prop can be removed in this phase.

## New interface

```tsx
interface AssistantMessageProps {
  /** Index of this message in the thread's messages array */
  messageIndex: number;
}
```

Down from 7 props to 1. Everything else comes from context + selectors.

## Implementation

### AssistantMessage (`src/components/thread/assistant-message.tsx`)

```tsx
import { memo, useCallback } from "react";
import type {
  ContentBlock,
  ServerToolUseBlock,
  WebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { useThreadStore } from "@/entities/threads/store";
import { useThreadContext } from "@/hooks/use-thread-context";
import { TextBlock } from "./text-block";
import { ThinkingBlock } from "./thinking-block";
import { ToolBlockRouter } from "./tool-block-router";
import { WorkspaceRootProvider } from "@/hooks/use-workspace-root";

interface AssistantMessageProps {
  /** Index of this assistant message in the messages array */
  messageIndex: number;
}

/**
 * Container for a single assistant turn.
 * Renders committed content: text, thinking, tool use.
 *
 * WIP streaming content (text/thinking with isStreaming: true) is rendered
 * separately by StreamingContent in MessageList's streaming slot.
 */
export const AssistantMessage = memo(function AssistantMessage({
  messageIndex,
}: AssistantMessageProps) {
  const { threadId, workingDirectory } = useThreadContext();
  const content = useMessageContent(threadId, messageIndex);

  return (
    <WorkspaceRootProvider value={workingDirectory}>
      <article role="article" aria-label="Assistant response" className="group">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            {content.map((block, index) => {
              switch (block.type) {
                case "text":
                  return (
                    <TextBlock
                      key={`text-${index}`}
                      content={block.text}
                      isStreaming={false}
                      workingDirectory={workingDirectory}
                    />
                  );

                case "thinking":
                  return (
                    <ThinkingBlock
                      key={`thinking-${index}`}
                      content={block.thinking}
                      threadId={threadId}
                      blockKey={`thinking-${index}`}
                    />
                  );

                case "tool_use":
                  return (
                    <ToolBlockRouter
                      key={block.id}
                      toolUseId={block.id}
                      toolName={block.name}
                      toolInput={block.input as Record<string, unknown>}
                    />
                  );

                case "server_tool_use":
                  return (
                    <ServerToolUseRenderer
                      key={(block as ServerToolUseBlock).id}
                      block={block as ServerToolUseBlock}
                      content={content}
                    />
                  );

                case "web_search_tool_result":
                  // Handled by server_tool_use case — skip to avoid duplicate rendering
                  return null;

                default:
                  return null;
              }
            })}
          </div>
        </div>
      </article>
    </WorkspaceRootProvider>
  );
});
```

### useMessageContent selector

A Zustand selector hook that subscribes to exactly one message's content blocks. Re-renders only when that message's content changes.

```tsx
/** Select content blocks for a single message. */
function useMessageContent(threadId: string, messageIndex: number): ContentBlock[] {
  return useThreadStore(
    useCallback(
      (s) => {
        const msg = s.threadStates[threadId]?.messages[messageIndex];
        return (msg?.content as ContentBlock[]) ?? [];
      },
      [threadId, messageIndex],
    ),
  );
}
```

Note: This selector returns the content array reference directly from the store. Because `ThreadStateMachine` only replaces message objects when their content actually changes (via reducer), the reference is stable across unrelated state updates.

### `isStreaming` prop removal

The current `isStreaming` prop on `AssistantMessage` is used to show a cursor on the last committed text block:

```tsx
// Current — in AssistantMessage
const showCursor = isStreaming && isLastBlock;
<TextBlock isStreaming={showCursor} ... />
```

This is no longer needed because:
- **WIP text** (actively streaming) is rendered by `StreamingContent` with its own cursor via `StreamingCursor`
- **Committed text** (persisted through `THREAD_ACTION`) is final — no cursor needed
- The `isStreaming` prop was a holdover from before `StreamingContent` existed

After this change, `TextBlock` always receives `isStreaming={false}` from `AssistantMessage`. The `isStreaming` prop on `TextBlock` itself stays (it's used by `StreamingContent`'s `TrickleBlock`), but `AssistantMessage` no longer computes or passes it dynamically.

## Key changes

1. **No more `messages` prop** — uses `useMessageContent(threadId, messageIndex)` selector
2. **No more `toolStates` prop** — tool blocks select their own state (Phase 3)
3. **No more `onToolResponse` prop** — tool response callbacks go through `questionService` directly (already the case for `LiveAskUserQuestion` via `useQuestionStore`)
4. **No more `isStreaming` prop** — WIP streaming content is handled by `StreamingContent` component; committed content never streams
5. **`threadId` and `workingDirectory` from context** — no prop drilling

## ToolBlockRouter (new thin component)

Extract routing logic from `AssistantMessage` into a standalone component at `src/components/thread/tool-block-router.tsx`. This takes `toolUseId` + `toolName` + `toolInput` and renders the right specialized/generic block.

The key difference from today: it does NOT receive `result`/`isError`/`status` as props. The rendered tool block selects those itself (Phase 3). Until Phase 3, `ToolBlockRouter` can call `useToolState` as a bridge.

```tsx
// src/components/thread/tool-block-router.tsx
import { memo } from "react";
import { useThreadContext } from "@/hooks/use-thread-context";
import { getSpecializedToolBlock } from "./tool-blocks";
import { ToolUseBlock } from "./tool-use-block";
import { ToolPermissionWrapper } from "./tool-permission-wrapper";
import { LiveAskUserQuestion } from "./live-ask-user-question";
import { useToolState } from "@/hooks/use-tool-state";

interface ToolBlockRouterProps {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Routes a tool_use content block to the appropriate rendering component.
 *
 * Props are all stable strings/objects from the content block, making this
 * component safe to memo. Until Phase 3 (tool blocks select own state),
 * this component bridges by calling useToolState and passing result/status
 * as props.
 */
export const ToolBlockRouter = memo(function ToolBlockRouter({
  toolUseId,
  toolName,
  toolInput,
}: ToolBlockRouterProps) {
  const { threadId } = useThreadContext();
  const toolState = useToolState(threadId, toolUseId);

  // AskUserQuestion has its own interactive UI and store integration
  if (toolName === "AskUserQuestion") {
    return (
      <LiveAskUserQuestion
        blockId={toolUseId}
        blockInput={toolInput}
        toolState={toolState}
        threadId={threadId}
      />
    );
  }

  const SpecializedBlock = getSpecializedToolBlock(toolName);
  if (SpecializedBlock) {
    return (
      <ToolPermissionWrapper
        toolUseId={toolUseId}
        toolName={toolName}
        toolInput={toolInput}
        threadId={threadId}
      >
        <SpecializedBlock
          id={toolUseId}
          name={toolName}
          input={toolInput}
          result={toolState.result}
          isError={toolState.isError}
          status={toolState.status}
          threadId={threadId}
        />
      </ToolPermissionWrapper>
    );
  }

  return (
    <ToolUseBlock
      id={toolUseId}
      name={toolName}
      input={toolInput}
      result={toolState.result}
      isError={toolState.isError}
      status={toolState.status}
      threadId={threadId}
    />
  );
});
```

Note: `ToolBlockRouter` is a **bridge** component. After Phase 3 (tool blocks select their own state), `useToolState` moves out of here and into each tool block. At that point, `ToolBlockRouter` becomes a pure router with only stable string props, and the `memo` wrap becomes maximally effective.

## ServerToolUseRenderer (extracted helper)

The `server_tool_use` handling logic stays inside `assistant-message.tsx` as a private helper component, since it needs access to the full `content` array to find the matching `web_search_tool_result` block.

```tsx
/** Renders server-side tool use blocks (e.g., web_search). */
function ServerToolUseRenderer({
  block,
  content,
}: {
  block: ServerToolUseBlock;
  content: ContentBlock[];
}) {
  const { threadId } = useThreadContext();

  // Find the corresponding web_search_tool_result block in the content array
  const resultBlock = content.find(
    (b): b is WebSearchToolResultBlock =>
      b.type === "web_search_tool_result" &&
      (b as WebSearchToolResultBlock).tool_use_id === block.id,
  ) as WebSearchToolResultBlock | undefined;

  const hasResult = !!resultBlock;
  const isError =
    resultBlock?.content &&
    !Array.isArray(resultBlock.content) &&
    (resultBlock.content as { type?: string }).type === "web_search_tool_result_error";

  const resultString = resultBlock ? JSON.stringify(resultBlock.content) : undefined;

  const SpecializedBlock = getSpecializedToolBlock(block.name);
  if (SpecializedBlock) {
    return (
      <SpecializedBlock
        key={block.id}
        id={block.id}
        name={block.name}
        input={block.input as Record<string, unknown>}
        result={resultString}
        isError={isError}
        status={hasResult ? "complete" : "running"}
        threadId={threadId}
      />
    );
  }

  return (
    <ToolUseBlock
      key={block.id}
      id={block.id}
      name={block.name}
      input={block.input as Record<string, unknown>}
      result={resultString}
      isError={isError}
      status={hasResult ? "complete" : "running"}
      threadId={threadId}
    />
  );
}
```

Note: `server_tool_use` bypasses `ToolBlockRouter` because its result comes from a sibling content block, not from `toolStates`. This is an inherent difference in the Anthropic API — server-side tools embed their results in the content array rather than going through the tool execution lifecycle.

## What stays as props vs moves to selectors

| Data | Source | Reason |
|---|---|---|
| `messageIndex` | prop | Stable number, needed for selector key |
| `threadId` | context (`useThreadContext`) | Stable for thread lifetime |
| `workingDirectory` | context (`useThreadContext`) | Stable for thread lifetime |
| Content blocks | selector `useMessageContent` | Changes only when this message's content changes |
| Tool state | selector in `ToolBlockRouter` (bridge) → Phase 3 moves to tool block | Each tool selects its own |
| `toolInput` | prop from content block → `ToolBlockRouter` | Stable reference from content block |

## Impact on `TurnRenderer`

`TurnRenderer` (`src/components/thread/turn-renderer.tsx`) simplifies dramatically:

```tsx
interface TurnRendererProps {
  turn: Turn;
  turnIndex: number;
  isLast?: boolean;
}

function TurnRenderer({ turn, turnIndex, isLast }: TurnRendererProps) {
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

Removed props: `messages`, `toolStates`, `onToolResponse`, `threadId`, `workingDirectory`, `isStreaming`.

The `isLast` prop is kept but no longer passed to `AssistantMessage` — it may still be useful for `TurnRenderer`-level styling or analytics. If unused after this phase, it can be removed in Phase 5.

## Impact on `MessageList`

`MessageList` (`src/components/thread/message-list.tsx`) loses several props:

```tsx
// Before
interface MessageListProps {
  threadId: string;
  turns: Turn[];
  messages: MessageParam[];
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  onToolResponse?: (toolId: string, response: string) => void;
  workingDirectory?: string;
}

// After (Phase 2 — partial cleanup, full cleanup in Phase 5)
interface MessageListProps {
  threadId: string;
  turns: Turn[];
  isStreaming?: boolean;
  workingDirectory?: string;
}
```

`messages`, `toolStates`, and `onToolResponse` are no longer passed through. `threadId`, `isStreaming`, and `workingDirectory` remain for now — `isStreaming` is used by `MessageList` itself for the streaming slot logic, and `threadId`/`workingDirectory` are used for `StreamingContent`/`WorkingIndicator`. These move to context in Phase 5.

## server_tool_use handling

The `server_tool_use` case finds its matching `web_search_tool_result` in the content array. This still works because `AssistantMessage` has access to `content` (from the `useMessageContent` selector). The only change is extracting it to `ServerToolUseRenderer` for readability. No behavioral change.

## Dependencies

- **Phase 1 provides**: `useThreadContext` hook, `ThreadContextProvider`, `useToolState` hook
- **Phase 2 provides to Phase 3**: `ToolBlockRouter` component (Phase 3 moves `useToolState` from router to individual blocks)
- **Phase 2 provides to Phase 5**: Demonstrates the selector pattern; Phase 5 applies it to remaining prop-drilled values

## Files to create

| File | Purpose |
|---|---|
| `src/components/thread/tool-block-router.tsx` | New routing component extracted from AssistantMessage |

## Files to modify

| File | Change |
|---|---|
| `src/components/thread/assistant-message.tsx` | Remove 6 props, add `useMessageContent` selector, extract tool routing to `ToolBlockRouter`, extract `ServerToolUseRenderer` helper, remove `isStreaming` cursor logic |
| `src/components/thread/turn-renderer.tsx` | Remove `messages`, `toolStates`, `onToolResponse`, `threadId`, `workingDirectory`, `isStreaming` props; stop passing them to `AssistantMessage` |
| `src/components/thread/message-list.tsx` | Remove `messages`, `toolStates`, `onToolResponse` props; stop passing them to `TurnRenderer` |
| `src/components/thread/thread-view.tsx` | Remove `toolStates`, `onToolResponse` props from `MessageList` call; stop passing `messages` |
