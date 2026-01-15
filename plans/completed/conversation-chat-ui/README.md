# Conversation Chat UI

Build a chat conversation window to render streaming agent responses with tool use visualization, following Anthropic Claude agent SDK message standards.

## Key Principles

From `system-integration.md`:

- **Disk always wins**: On mount/refresh, reload from files (`messages.jsonl`). Stdout streaming is for low-latency display only—not persistence.
- **Stdout for display, files for persistence**: Real-time updates via stdout (purpose-built for child process output). File watching rejected (OS-level APIs coalesce rapid events).
- **Derive from Anthropic types**: Use `@anthropic-ai/sdk` types wherever possible.

## Goals

1. Display human/assistant message bubbles in a chat format
2. Stream assistant text responses with live typing indicator
3. Render tool use blocks with collapsible input/output
4. Support multiple tool uses per turn
5. Auto-scroll during streaming, pause on user scroll
6. Handle loading, empty, and error states gracefully

## Non-Goals (Deferred)

- Message input/compose UI (handled elsewhere)
- Conversation history persistence
- Multi-conversation tabs
- Edit/regenerate messages

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    Conversation Window                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     Message List                                │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ [User] How do I refactor this function?                  │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────────────┐  │ │
│  │  │ [Assistant]                                               │  │ │
│  │  │ I'll analyze the code and suggest improvements.          │  │ │
│  │  │                                                           │  │ │
│  │  │ ┌──────────────────────────────────────────────────────┐ │  │ │
│  │  │ │ 🔧 read_file                              [▼ Expand] │ │  │ │
│  │  │ │ Input: { path: "src/utils.ts" }                      │ │  │ │
│  │  │ │ Output: (collapsed)                                  │ │  │ │
│  │  │ └──────────────────────────────────────────────────────┘ │  │ │
│  │  │                                                           │  │ │
│  │  │ Here's the refactored version...▌                        │  │ │
│  │  └──────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Subplans

Execute in order (dependencies flow top-to-bottom):

| Plan | Description | Files Owned |
|------|-------------|-------------|
| [01-types-and-utilities.md](./01-types-and-utilities.md) | Shared types, JSONL parsing, turn grouping, tool icons | `src/lib/types/`, `src/lib/utils/` |
| [02-hooks.md](./02-hooks.md) | State management (zustand), conversation service, thin hooks | `src/stores/`, `src/lib/conversation-service.ts`, `src/hooks/` |
| [03-state-components.md](./03-state-components.md) | Loading, empty, and error state components | `src/components/conversation/*-state.tsx` |
| [04-message-blocks.md](./04-message-blocks.md) | Atomic message rendering components | `src/components/conversation/*-block.tsx` |
| [05-layout-components.md](./05-layout-components.md) | Container and layout components | `src/components/conversation/*.tsx` (containers) |

## Shared Contracts

All subplans share these contracts. See `plans/system-integration.md` for full type definitions.

### Message Types

Uses shared types from `src/lib/types/agent-messages.ts`, which derive from `@anthropic-ai/sdk`:

```typescript
import type { AgentMessage } from "@/lib/types/agent-messages";

// SDK-derived types (extend Anthropic SDK with timestamp):
// - TextMessage        = TextBlock & { timestamp }     → { type: "text", text: string, ... }
// - ThinkingMessage    = ThinkingBlock & { timestamp } → { type: "thinking", thinking: string, ... }
// - ToolUseMessage     = ToolUseBlock & { timestamp }  → { type: "tool_use", id, name, input }
// - ToolResultMessage  { type: "tool_result", tool_use_id, content, is_error? }
//
// App-specific types (NOT in SDK):
// - SystemMessage      { type: "system", subtype: "init", model, tools }
// - FileChangeMessage  { type: "file_change", path, operation, diff }
// - CompleteMessage    { type: "complete", durationMs, success, summary? }
// - ErrorMessage       { type: "error", message, code? }
// - TurnStartMessage   { type: "turn_start", turnIndex, prompt }
// - UserPromptMessage  { type: "user_prompt", content }
//
// All messages include `timestamp: number`
```

### Conversation State (Zustand Store)

State is managed in a zustand store, not local React state:

```typescript
// src/stores/conversation-store.ts
export interface ConversationState {
  conversationId: string | null;
  messages: AgentMessage[];  // Includes UserPromptMessage for user turns
  fileChanges: Map<string, FileChangeMessage>; // Keyed by path, last write wins
  status: "idle" | "loading" | "running" | "completed" | "error";
  error?: string;
  metadata?: ConversationMetadata;
}

// Access via combined hook (recommended)
const { messages, status, isStreaming, reload } = useConversation(id, workingDir);

// Or access individual pieces
const isStreaming = useIsStreaming();
```

### Turn Grouping

The UI groups messages into logical "turns" for rendering. Turn boundaries are determined by
message types in the stream - no synthetic messages needed:

```typescript
interface Turn {
  type: "user" | "assistant" | "system";
  messages: AgentMessage[];
}

// Turn boundaries:
// - UserPromptMessage / TurnStartMessage → new user turn
// - SystemMessage → standalone system turn
// - CompleteMessage / ErrorMessage → ends assistant turn
```

### Window Entry Points

- `conversation.html` - HTML entry point
- `src/conversation-main.tsx` - React entry, reads `id` from URL params

## File Structure

```
src/
├── components/conversation/
│   ├── conversation-view.tsx      # Main container
│   ├── message-list.tsx           # Virtualized scrollable container (react-virtuoso)
│   ├── turn-renderer.tsx          # Routes turn type to appropriate component
│   ├── user-message.tsx           # User bubble (renders prompt)
│   ├── assistant-message.tsx      # Groups agent messages into turns
│   ├── system-message.tsx         # System init message (model, tools)
│   ├── text-block.tsx             # Streaming markdown (Streamdown)
│   ├── thinking-block.tsx         # Collapsible agent reasoning
│   ├── tool-use-block.tsx         # Collapsible tool card
│   ├── file-change-block.tsx      # File operation notification
│   ├── streaming-cursor.tsx       # Animated cursor
│   ├── loading-state.tsx          # Loading spinner/skeleton
│   ├── empty-state.tsx            # No messages yet
│   └── error-state.tsx            # Error display with retry
│
├── stores/
│   └── conversation-store.ts      # Zustand store for conversation state
│
├── hooks/
│   ├── use-conversation.ts        # Combined load + state hook (main API)
│   ├── use-agent-stream.ts        # Low-level Tauri shell stdout subscription
│   ├── use-scroll-anchor.ts       # Auto-scroll behavior
│   ├── use-reduced-motion.ts      # Reduced motion preference
│   └── use-relative-time.ts       # Auto-updating relative time
│
└── lib/
    ├── conversation-service.ts    # CRUD operations on conversation files
    ├── types/
    │   └── agent-messages.ts      # Shared message types (derives from @anthropic-ai/sdk)
    └── utils/
        ├── jsonl.ts               # JSONL parsing utilities
        ├── turn-grouping.ts       # Message → Turn grouping logic
        ├── tool-icons.ts          # Tool name → icon mapping
        ├── tool-state.ts          # Derive tool execution state from messages
        ├── file-changes.ts        # File change map utilities
        └── time-format.ts         # Time formatting utilities
```

## UI Design

### Color Palette (Dark Theme)

```css
--bg-chat: #0c0c0c;
--bg-user-bubble: #2563eb; /* blue-600 */
--bg-assistant-bubble: #1c1c1c;
--bg-tool-card: #262626;
--border-tool: #404040;
--text-primary: #fafafa;
--text-secondary: #a1a1a1;
--accent-tool: #f59e0b; /* amber-500 */
```

### Typography

- Chat text: 15px, system font
- Code blocks: 13px, JetBrains Mono / monospace
- Tool name: 13px, medium weight, uppercase

### Message Bubbles

- User: rounded-2xl, right-aligned, max-width 80%
- Assistant: rounded-2xl, left-aligned, full width
- Tool card: rounded-lg, inset within assistant bubble, border-left accent

## Integration with Other Systems

See `plans/system-integration.md` for how this connects to:

- **Agent Execution System** (`agent-execution/`): Produces messages to `messages.jsonl` and `changes.jsonl`
- **Diff Viewer** (`diff-viewer.md`): Displayed alongside chat in conversation window

### Contracts This System Must Fulfill

1. **Message Consumption**: Use shared types from `src/lib/types/agent-messages.ts`
2. **Disk-First Loading**: On mount/refresh, load from `messages.jsonl` (authoritative source)
3. **Real-time Overlay**: During active runs, stdout streaming adds new messages for low-latency display
4. **Window Integration**: Expose `ConversationView` for embedding in tabbed conversation window
5. **Diff Tab Coordination**: Pass `fileChanges` Map to parent, provide callback for navigation

## Dependencies

- `zustand` - State management (conversation store)
- `react-virtuoso` - Virtualized list for message scrolling
- `streamdown` - Streaming markdown renderer (Vercel)
