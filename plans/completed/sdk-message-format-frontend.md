# SDK Message Format - Frontend Migration

Extends `sdk-message-format.md` to update the frontend UI to work with `MessageParam[]` directly, eliminating custom flat `AgentMessage` types.

## Problem

The agent runner already outputs `MessageParam[]` (SDK format):
```typescript
{ role: "user", content: "hello" }
{ role: "assistant", content: [{ type: "text", text: "..." }, { type: "tool_use", ... }] }
```

But the frontend expects flat `AgentMessage[]`:
```typescript
{ type: "user_prompt", content: "hello" }
{ type: "text", text: "..." }
{ type: "tool_use", id: "...", name: "...", input: {} }
```

We added a `message-transformer.ts` as a workaround, but this is fighting the data shape. The frontend should work with SDK types directly.

## Solution

1. Update `Turn` structure to hold `MessageParam` instead of `AgentMessage[]`
2. Update turn-grouping to work with `{ role, content }` structure
3. Update rendering components to render `ContentBlock[]` from SDK
4. Remove all custom flat message types (keep only `FileChange`, `ConversationState`, `ResultMetrics`)
5. Delete the transformer

## Files to Modify

### Core Type Changes

| File | Change |
|------|--------|
| `src/lib/types/agent-messages.ts` | Remove flat types, keep FileChange/ResultMetrics/ConversationState with `messages: MessageParam[]` |
| `src/lib/utils/message-transformer.ts` | **DELETE** |

### Turn Grouping

| File | Change |
|------|--------|
| `src/lib/utils/turn-grouping.ts` | Rewrite to work with `MessageParam[]` |

### Rendering Components

| File | Change |
|------|--------|
| `src/components/conversation/conversation-window.tsx` | Remove transformer, pass `MessageParam[]` directly |
| `src/components/conversation/conversation-view.tsx` | Update to use new Turn structure |
| `src/components/conversation/assistant-message.tsx` | Render `ContentBlock[]` from `MessageParam.content` |
| `src/components/conversation/user-message.tsx` | Extract text from `MessageParam` |
| `src/components/conversation/turn-renderer.tsx` | Update type imports |
| `src/components/conversation/system-message.tsx` | Keep as-is (system messages are app-specific) |
| `src/components/conversation/file-change-block.tsx` | Keep as-is (file changes are app-specific) |

### Utilities

| File | Change |
|------|--------|
| `src/lib/utils/tool-state.ts` | Update to extract tool_use/tool_result from `ContentBlock[]` |
| `src/lib/utils/file-changes.ts` | Update to work with new structure (file changes are separate from messages) |
| `src/lib/utils/jsonl.ts` | **DELETE** (no longer needed - we use state.json) |

### Hooks

| File | Change |
|------|--------|
| `src/hooks/use-streaming-conversation.ts` | Update `ConversationState` type |
| `src/hooks/use-conversation-messages.ts` | Update `ConversationState` type |
| `src/hooks/use-agent-execution.ts` | Update `ConversationState` type |
| `src/hooks/use-agent-stream.ts` | **DELETE** or update (if still used) |
| `src/hooks/use-file-contents.ts` | Keep - uses `FileChangeMessage` which stays |

### Services/Stores

| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Already correct (uses `ConversationState`) |
| `src/lib/conversation-service.ts` | Update imports |
| `src/entities/conversations/store.ts` | Update imports |
| `src/entities/events.ts` | Update `ConversationState` import |

## Implementation Details

### 1. New Type Definitions

```typescript
// src/lib/types/agent-messages.ts
import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";

// Re-export SDK types for convenience
export type { MessageParam, ContentBlock };

// App-specific types (NOT in SDK)
export interface FileChange {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  oldPath?: string;
  diff: string;
}

export interface ResultMetrics {
  durationApiMs: number;
  totalCostUsd: number;
  numTurns: number;
}

export interface ConversationState {
  messages: MessageParam[];
  fileChanges: FileChange[];
  metrics?: ResultMetrics;
  status: "running" | "complete" | "error";
  error?: string;
  timestamp: number;
}

// System init is app-specific (not from SDK)
export interface SystemInit {
  model: string;
  tools: string[];
}
```

### 2. New Turn Structure

```typescript
// src/lib/utils/turn-grouping.ts
import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";

export interface Turn {
  type: "user" | "assistant";
  message: MessageParam;
}

export function groupMessagesIntoTurns(messages: MessageParam[]): Turn[] {
  return messages.map(msg => ({
    type: msg.role,
    message: msg,
  }));
}

export function getUserPromptText(turn: Turn): string {
  if (turn.type !== "user") return "";
  const content = turn.message.content;
  if (typeof content === "string") return content;
  // Array content - find text block or return empty
  const textBlock = content.find(b => b.type === "text");
  return textBlock?.text ?? "";
}

export function isTurnStreaming(turn: Turn, isLastTurn: boolean, conversationStreaming: boolean): boolean {
  return turn.type === "assistant" && isLastTurn && conversationStreaming;
}
```

### 3. Updated AssistantMessage

```typescript
// src/components/conversation/assistant-message.tsx
import type { MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages";

interface AssistantMessageProps {
  message: MessageParam;
  isStreaming?: boolean;
  onFileChangeClick?: (path: string) => void;
}

export function AssistantMessage({ message, isStreaming, onFileChangeClick }: AssistantMessageProps) {
  const content = message.content as ContentBlock[];

  // Derive tool states from content blocks
  const toolStates = deriveToolStates(content, /* need to find matching tool_results */);

  return (
    <div className="...">
      {content.map((block, idx) => {
        switch (block.type) {
          case "text":
            return <TextBlock key={idx} content={block.text} isStreaming={isStreaming && idx === content.length - 1} />;
          case "thinking":
            return <ThinkingBlock key={idx} content={block.thinking} />;
          case "tool_use":
            const state = toolStates.get(block.id);
            return <ToolUseBlock key={idx} {...block} {...state} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

### 4. Updated Tool State Derivation

Tool results come in the NEXT user message after the assistant message. We need to look ahead:

```typescript
// src/lib/utils/tool-state.ts
import type { MessageParam, ContentBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

export interface ToolState {
  result?: string;
  isError?: boolean;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

export function deriveToolStatesFromConversation(
  messages: MessageParam[],
  assistantMsgIndex: number
): Map<string, ToolState> {
  const states = new Map<string, ToolState>();
  const assistantMsg = messages[assistantMsgIndex];

  if (assistantMsg.role !== "assistant") return states;

  const content = assistantMsg.content as ContentBlock[];
  const toolUses = content.filter(b => b.type === "tool_use");

  // Initialize all tool uses as running
  for (const tu of toolUses) {
    states.set(tu.id, { status: "running" });
  }

  // Look for tool results in subsequent user message
  const nextMsg = messages[assistantMsgIndex + 1];
  if (nextMsg?.role === "user" && Array.isArray(nextMsg.content)) {
    for (const block of nextMsg.content) {
      if (block.type === "tool_result") {
        const result = block as ToolResultBlockParam;
        states.set(result.tool_use_id, {
          result: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
          isError: result.is_error,
          status: result.is_error ? "error" : "complete",
        });
      }
    }
  }

  return states;
}
```

### 5. File Changes Handling

File changes are SEPARATE from messages (stored in `state.fileChanges`). They don't come from ContentBlocks.

```typescript
// ConversationWindow already has access to fileChanges from conversationState
const fileChanges = conversationState?.fileChanges ?? [];
```

The `FileChangeBlock` component stays the same - it renders these app-specific file change records.

## Migration Steps

0. **Revert transformer band-aid** - remove `message-transformer.ts` and undo changes to `conversation-window.tsx` that added transformation
1. **Update types** (`agent-messages.ts`) - remove flat types, update `ConversationState`
2. **Rewrite turn-grouping** - simple 1:1 mapping of messages to turns
3. **Update tool-state** - derive from `ContentBlock[]` and look-ahead for results
4. **Update AssistantMessage** - render `ContentBlock[]` directly
5. **Update UserMessage** - extract text from `MessageParam`
6. **Update ConversationWindow** - remove transformer, pass messages directly
7. **Update ConversationView** - use new turn structure
8. **Delete** `message-transformer.ts`, `jsonl.ts`
9. **Update all imports** - fix any remaining references to deleted types

## Testing

1. Start a new conversation - verify user message displays
2. Verify assistant text renders with streaming cursor
3. Verify thinking blocks render (collapsed)
4. Verify tool_use blocks render with status
5. Verify tool_result appears in tool block after completion
6. Verify file changes display in sidebar
7. Resume an existing conversation - verify history displays

## Notes

- `SystemMessage` stays as app-specific type (initialization info not from SDK)
- `FileChange` stays as app-specific type (git diff info not from SDK)
- The SDK doesn't have timestamps on blocks - if needed, use message-level timestamp
