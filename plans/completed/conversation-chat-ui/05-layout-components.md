# Layout Components

Container and layout components that compose message blocks into the conversation UI.

**Prerequisites:** All previous sub-plans (01-04)

## Files Owned

```
src/components/conversation/
├── conversation-view.tsx     # Main container
├── message-list.tsx          # Virtualized scrollable container
├── turn-renderer.tsx         # Routes turn type to component
├── user-message.tsx          # User prompt bubble
├── assistant-message.tsx     # Groups agent messages into turns
└── system-message.tsx        # System init message
```

## Dependencies

```bash
pnpm add react-virtuoso  # Virtualized list with variable heights
```

## Implementation

### 1. Create user-message.tsx

User prompt bubble:

```typescript
// src/components/conversation/user-message.tsx
import { cn } from "@/lib/utils";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { formatAbsoluteTime, formatIsoTime } from "@/lib/utils/time-format";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";

interface UserMessageProps {
  /** The user turn containing UserPromptMessage or TurnStartMessage */
  turn: Turn;
}

/**
 * Right-aligned user message bubble.
 */
export function UserMessage({ turn }: UserMessageProps) {
  const content = getUserTurnPrompt(turn);
  const timestamp = turn.messages[0]?.timestamp;

  const relativeTime = useRelativeTime(timestamp ?? Date.now());
  const absoluteTime = timestamp ? formatAbsoluteTime(timestamp) : undefined;
  const isoTime = timestamp ? formatIsoTime(timestamp) : undefined;

  return (
    <article
      role="article"
      aria-label="Your message"
      className="flex justify-end"
    >
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-2xl",
          "bg-blue-600 text-white",
          "shadow-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>

        {timestamp && (
          <time
            dateTime={isoTime}
            title={absoluteTime}
            aria-label={absoluteTime}
            className="block text-xs text-blue-200 mt-1 opacity-70"
          >
            {relativeTime}
          </time>
        )}
      </div>
    </article>
  );
}
```

### 2. Create system-message.tsx

System initialization message:

```typescript
// src/components/conversation/system-message.tsx
import { Bot, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemMessage as SystemMessageType } from "@/lib/types/agent-messages";

interface SystemMessageProps {
  message: SystemMessageType;
}

/**
 * Displays system initialization info (model, available tools).
 */
export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div
      role="article"
      aria-label="System message"
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg",
        "bg-zinc-900/50 border border-zinc-800"
      )}
    >
      <Bot className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" aria-hidden="true" />

      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Model:</span>{" "}
          <span className="font-mono text-violet-400">{message.model}</span>
        </p>

        {message.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Wrench
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            {message.tools.map((tool) => (
              <span
                key={tool}
                className="px-2 py-0.5 text-xs rounded bg-zinc-800 text-zinc-300"
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3. Create assistant-message.tsx

Container for assistant turn content:

```typescript
// src/components/conversation/assistant-message.tsx
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage, ToolResultMessage } from "@/lib/types/agent-messages";
import { TextBlock } from "./text-block";
import { ThinkingBlock } from "./thinking-block";
import { ToolUseBlock } from "./tool-use-block";
import { FileChangeBlock } from "./file-change-block";
import { deriveToolStates } from "@/lib/utils/tool-state";

interface AssistantMessageProps {
  /** Messages in this assistant turn */
  messages: AgentMessage[];
  /** Whether this turn is still streaming */
  isStreaming?: boolean;
  /** Callback when clicking a file change */
  onFileChangeClick?: (path: string) => void;
}

/**
 * Container for a single assistant turn.
 * Renders mixed content: text, thinking, tool use, file changes.
 */
export function AssistantMessage({
  messages,
  isStreaming = false,
  onFileChangeClick,
}: AssistantMessageProps) {
  // Derive tool states from messages
  const toolStates = deriveToolStates(messages);

  // Find all tool results for lookup
  const toolResults = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.type === "tool_result") {
      toolResults.set(msg.tool_use_id, msg);
    }
  }

  return (
    <article role="article" aria-label="Assistant response" className="group">
      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
            "bg-violet-600/20 text-violet-400"
          )}
        >
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          {messages.map((msg, index) => {
            const isLastMessage = index === messages.length - 1;
            const showCursor = isStreaming && isLastMessage;

            switch (msg.type) {
              case "text":
                return (
                  <TextBlock
                    key={`text-${index}`}
                    content={msg.text}
                    isStreaming={showCursor}
                  />
                );

              case "thinking":
                return (
                  <ThinkingBlock key={`thinking-${index}`} content={msg.thinking} />
                );

              case "tool_use": {
                const state = toolStates.get(msg.id);
                const result = toolResults.get(msg.id);
                return (
                  <ToolUseBlock
                    key={msg.id}
                    id={msg.id}
                    name={msg.name}
                    input={msg.input as Record<string, unknown>}
                    result={result?.content}
                    isError={result?.is_error}
                    status={state?.status ?? "running"}
                    durationMs={state?.durationMs}
                  />
                );
              }

              case "tool_result":
                // Tool results are rendered within ToolUseBlock
                return null;

              case "file_change":
                return (
                  <FileChangeBlock
                    key={`file-${msg.path}-${index}`}
                    path={msg.path}
                    operation={msg.operation}
                    oldPath={msg.oldPath}
                    onClick={onFileChangeClick}
                  />
                );

              default:
                return null;
            }
          })}
        </div>
      </div>
    </article>
  );
}
```

### 4. Create turn-renderer.tsx

Routes turn type to appropriate component:

```typescript
// src/components/conversation/turn-renderer.tsx
import type { Turn } from "@/lib/utils/turn-grouping";
import type { SystemMessage as SystemMessageType } from "@/lib/types/agent-messages";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import { SystemMessage } from "./system-message";

interface TurnRendererProps {
  turn: Turn;
  /** Whether this is the last turn (for streaming indicator) */
  isLast?: boolean;
  /** Whether the conversation is streaming */
  isStreaming?: boolean;
  /** Callback for file change clicks */
  onFileChangeClick?: (path: string) => void;
}

/**
 * Routes a turn to the appropriate component based on type.
 */
export function TurnRenderer({
  turn,
  isLast = false,
  isStreaming = false,
  onFileChangeClick,
}: TurnRendererProps) {
  switch (turn.type) {
    case "user":
      return <UserMessage turn={turn} />;

    case "system": {
      const sysMsg = turn.messages[0] as SystemMessageType;
      return <SystemMessage message={sysMsg} />;
    }

    case "assistant":
      return (
        <AssistantMessage
          messages={turn.messages}
          isStreaming={isLast && isStreaming}
          onFileChangeClick={onFileChangeClick}
        />
      );

    default:
      return null;
  }
}
```

### 5. Create message-list.tsx

Virtualized message list using react-virtuoso:

```typescript
// src/components/conversation/message-list.tsx
import { useRef, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { Turn } from "@/lib/utils/turn-grouping";
import { TurnRenderer } from "./turn-renderer";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";

interface MessageListProps {
  /** Turns to render */
  turns: Turn[];
  /** Whether the conversation is streaming */
  isStreaming?: boolean;
  /** Callback for file change clicks */
  onFileChangeClick?: (path: string) => void;
}

/**
 * Virtualized scrollable message list.
 *
 * Uses react-virtuoso for efficient rendering of variable-height items
 * with automatic scroll anchoring during streaming.
 */
export function MessageList({
  turns,
  isStreaming = false,
  onFileChangeClick,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isAtBottom, scrollToBottom } = useScrollAnchor(containerRef);

  // Render individual turn
  const itemContent = useCallback(
    (index: number, turn: Turn) => (
      <div className="px-4 py-3">
        <TurnRenderer
          turn={turn}
          isLast={index === turns.length - 1}
          isStreaming={isStreaming}
          onFileChangeClick={onFileChangeClick}
        />
      </div>
    ),
    [turns.length, isStreaming, onFileChangeClick]
  );

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      <Virtuoso
        ref={virtuosoRef}
        data={turns}
        itemContent={itemContent}
        followOutput={isStreaming ? "smooth" : false}
        alignToBottom
        className="h-full"
        overscan={200}
      />

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-zinc-800 shadow-lg hover:bg-zinc-700 transition-colors"
          aria-label="Scroll to bottom"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
```

### 6. Create conversation-view.tsx

Main container component:

```typescript
// src/components/conversation/conversation-view.tsx
import { useMemo } from "react";
import type { AgentMessage } from "@/lib/types/agent-messages";
import type { ConversationState } from "@/stores/conversation-store";
import { groupMessagesIntoTurns } from "@/lib/utils/turn-grouping";
import { MessageList } from "./message-list";
import { LoadingState } from "./loading-state";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { StatusAnnouncement } from "./status-announcement";

interface ConversationViewProps {
  /** Agent messages from the conversation (includes UserPromptMessage) */
  messages: AgentMessage[];
  /** Whether the conversation is streaming */
  isStreaming: boolean;
  /** Conversation status */
  status: ConversationState["status"];
  /** Error message if status is error */
  error?: string;
  /** Callback when user clicks a file change block */
  onFileChangeClick?: (path: string) => void;
  /** Callback to retry loading */
  onRetry?: () => void;
}

/**
 * Main conversation view container.
 *
 * Handles state rendering (loading/empty/error) and message display.
 * User prompts are included in the messages array as UserPromptMessage.
 */
export function ConversationView({
  messages,
  isStreaming,
  status,
  error,
  onFileChangeClick,
  onRetry,
}: ConversationViewProps) {
  // Group messages into turns (UserPromptMessage creates user turns)
  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages]);

  // Loading state
  if (status === "loading") {
    return <LoadingState />;
  }

  // Error state with no messages
  if (status === "error" && messages.length === 0) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  // Empty/idle state
  if (status === "idle" || messages.length === 0) {
    return <EmptyState isRunning={isStreaming} />;
  }

  return (
    <div
      className="relative h-full bg-zinc-950"
      role="main"
      aria-label="Conversation with AI assistant"
    >
      <StatusAnnouncement status={status} error={error} />

      <MessageList
        turns={turns}
        isStreaming={isStreaming}
        onFileChangeClick={onFileChangeClick}
      />

      {/* Error banner for errors during streaming */}
      {status === "error" && messages.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-red-950/90 border-t border-red-500/30">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}
```

### 7. Create conversation-window.tsx

Window wrapper with diff tab coordination:

```typescript
// src/components/conversation/conversation-window.tsx
import { useState } from "react";
import { useConversation } from "@/hooks/use-conversation";
import { ConversationView } from "./conversation-view";
// import { DiffViewer } from "../diff-viewer/diff-viewer"; // From diff-viewer plan

interface ConversationWindowProps {
  conversationId: string;
  workingDirectory: string;
}

/**
 * Complete conversation window with chat and diff tabs.
 */
export function ConversationWindow({
  conversationId,
  workingDirectory,
}: ConversationWindowProps) {
  const { messages, fileChanges, status, error, isStreaming, reload } =
    useConversation(conversationId, workingDirectory);

  const [activeTab, setActiveTab] = useState<"chat" | "diff">("chat");

  const handleFileChangeClick = (path: string) => {
    setActiveTab("diff");
    // TODO: Scroll DiffViewer to this file
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("chat")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "chat"
              ? "text-white border-b-2 border-blue-500"
              : "text-muted-foreground hover:text-white"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab("diff")}
          className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === "diff"
              ? "text-white border-b-2 border-blue-500"
              : "text-muted-foreground hover:text-white"
          }`}
        >
          Changes
          {fileChanges.size > 0 && (
            <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500 text-white">
              {fileChanges.size}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "chat" ? (
          <ConversationView
            messages={messages}
            isStreaming={isStreaming}
            status={status}
            error={error}
            onFileChangeClick={handleFileChangeClick}
            onRetry={reload}
          />
        ) : (
          <div className="h-full p-4 text-muted-foreground">
            {/* DiffViewer will be implemented per diff-viewer.md */}
            <p>Diff viewer placeholder ({fileChanges.size} files changed)</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Keyboard Navigation

Add keyboard handling to MessageList:

```typescript
// In message-list.tsx, add to containerRef
function useMessageListKeyboard(containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Home") {
        e.preventDefault();
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.key === "End") {
        e.preventDefault();
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [containerRef]);
}
```

## Window Entry Point

Create entry point for conversation windows:

```typescript
// src/conversation-main.tsx
import { createRoot } from "react-dom/client";
import { ConversationWindow } from "@/components/conversation/conversation-window";

// Get conversation ID from URL params
const params = new URLSearchParams(window.location.search);
const conversationId = params.get("id");
const workingDirectory = params.get("cwd") ?? ".";

if (!conversationId) {
  document.body.innerHTML = "<p>Missing conversation ID</p>";
} else {
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <ConversationWindow
      conversationId={conversationId}
      workingDirectory={workingDirectory}
    />
  );
}
```

```html
<!-- conversation.html -->
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Conversation</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/conversation-main.tsx"></script>
  </body>
</html>
```

## Accessibility Summary

| Component | ARIA Role | Live Region |
|-----------|-----------|-------------|
| MessageList | `role="log"` | `aria-live="polite"` |
| UserMessage | `role="article"` | - |
| AssistantMessage | `role="article"` | - |
| StatusAnnouncement | `role="status"` | `aria-live="polite"` |

## Checklist

- [ ] Install react-virtuoso: `pnpm add react-virtuoso`
- [ ] Create `src/components/conversation/user-message.tsx`
- [ ] Create `src/components/conversation/system-message.tsx`
- [ ] Create `src/components/conversation/assistant-message.tsx`
- [ ] Create `src/components/conversation/turn-renderer.tsx`
- [ ] Create `src/components/conversation/message-list.tsx`
- [ ] Create `src/components/conversation/conversation-view.tsx`
- [ ] Create `src/components/conversation/conversation-window.tsx`
- [ ] Create `src/conversation-main.tsx` entry point
- [ ] Create `conversation.html` entry point
- [ ] Update vite config for multi-page build
- [ ] Test virtualization with large conversations
- [ ] Test scroll anchoring during streaming
- [ ] Verify keyboard navigation
