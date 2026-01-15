# Types and Utilities

Foundation layer providing parsing utilities and helper functions for the conversation UI.

**Prerequisites:** None (this is the foundation layer)

## Files Owned

```
src/lib/
├── types/
│   └── agent-messages.ts     # ALREADY EXISTS - DO NOT MODIFY
└── utils/
    ├── jsonl.ts              # JSONL parsing utilities
    ├── turn-grouping.ts      # Message → Turn grouping logic
    ├── tool-icons.ts         # Tool name → icon mapping
    ├── tool-state.ts         # Derive tool execution state from messages
    ├── file-changes.ts       # File change map utilities
    └── time-format.ts        # Time formatting utilities
```

## Types (ALREADY IMPLEMENTED)

`src/lib/types/agent-messages.ts` already exists and correctly derives from `@anthropic-ai/sdk`:

```typescript
// SDK-derived (use these field names!):
// - TextMessage.text (NOT content)
// - ThinkingMessage.thinking (NOT content)
// - ToolUseMessage.id, .name, .input

// App-specific:
// - UserPromptMessage { type: "user_prompt", content: string }
// - TurnStartMessage { type: "turn_start", turnIndex, prompt }
// - SystemMessage, FileChangeMessage, CompleteMessage, ErrorMessage
```

**DO NOT redefine these types. Import from `@/lib/types/agent-messages`.**

## Implementation

### 1. Create jsonl.ts

JSONL parsing with error tolerance for malformed lines:

```typescript
// src/lib/utils/jsonl.ts
import type { AgentMessage } from "@/lib/types/agent-messages";

/**
 * Parse JSONL content into AgentMessage array.
 * Tolerates malformed lines - logs warning and skips them.
 */
export function parseJsonl(content: string): AgentMessage[] {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as AgentMessage;
      } catch (err) {
        console.warn(`Failed to parse JSONL line ${index}:`, line);
        return null;
      }
    })
    .filter((msg): msg is AgentMessage => msg !== null);
}

/**
 * Stringify a message to JSONL format (single line, no trailing newline).
 */
export function stringifyJsonlLine(message: AgentMessage): string {
  return JSON.stringify(message);
}
```

### 2. Create turn-grouping.ts

Groups consecutive messages into logical "turns" for rendering. Uses `UserPromptMessage` and `TurnStartMessage`
from the message stream to identify turn boundaries (no synthetic messages needed).

```typescript
// src/lib/utils/turn-grouping.ts
import type { AgentMessage, UserPromptMessage } from "@/lib/types/agent-messages";

export interface Turn {
  type: "user" | "assistant" | "system";
  messages: AgentMessage[];
}

/**
 * Group messages into logical turns for rendering.
 *
 * Turn boundaries are determined by:
 * - UserPromptMessage / TurnStartMessage → new user turn
 * - SystemMessage → standalone system turn
 * - CompleteMessage / ErrorMessage → finalizes current assistant turn
 *
 * @param messages - Array of agent messages from the stream (includes UserPromptMessage)
 * @returns Array of turns
 */
export function groupMessagesIntoTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const msg of messages) {
    // User prompt starts a new user turn
    if (msg.type === "user_prompt" || msg.type === "turn_start") {
      if (currentTurn && currentTurn.messages.length > 0) {
        turns.push(currentTurn);
      }
      turns.push({ type: "user", messages: [msg] });
      currentTurn = { type: "assistant", messages: [] };
      continue;
    }

    // System messages are standalone turns
    if (msg.type === "system") {
      if (currentTurn && currentTurn.messages.length > 0) {
        turns.push(currentTurn);
        currentTurn = { type: "assistant", messages: [] };
      }
      turns.push({ type: "system", messages: [msg] });
      continue;
    }

    // Complete/error messages finalize the current turn
    if (msg.type === "complete" || msg.type === "error") {
      if (currentTurn) {
        currentTurn.messages.push(msg);
        turns.push(currentTurn);
      }
      currentTurn = null;
      continue;
    }

    // All other messages (text, thinking, tool_use, tool_result, file_change)
    // belong to the current assistant turn
    if (!currentTurn) {
      currentTurn = { type: "assistant", messages: [] };
    }
    currentTurn.messages.push(msg);
  }

  // Push final turn if it has messages
  if (currentTurn && currentTurn.messages.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

/**
 * Check if a turn is still being streamed (no terminal message).
 */
export function isTurnStreaming(turn: Turn): boolean {
  const lastMsg = turn.messages.at(-1);
  return !lastMsg || (lastMsg.type !== "complete" && lastMsg.type !== "error");
}

/**
 * Get the prompt text from a user turn.
 */
export function getUserTurnPrompt(turn: Turn): string {
  if (turn.type !== "user") return "";
  const msg = turn.messages[0];
  if (msg?.type === "user_prompt") return (msg as UserPromptMessage).content;
  if (msg?.type === "turn_start") return msg.prompt;
  return "";
}
```

### 3. Create tool-icons.ts

Maps tool names to display icons:

```typescript
// src/lib/utils/tool-icons.ts

export interface ToolIconConfig {
  icon: string;
  description: string;
}

const TOOL_ICON_PATTERNS: Array<{
  pattern: RegExp;
  config: ToolIconConfig;
}> = [
  {
    pattern: /^(read|Read)/i,
    config: { icon: "file-text", description: "File read" },
  },
  {
    pattern: /^(write|Write|edit|Edit)/i,
    config: { icon: "pencil", description: "File write" },
  },
  {
    pattern: /^(bash|Bash)/i,
    config: { icon: "terminal", description: "Shell command" },
  },
  {
    pattern: /^(search|Grep|Glob)/i,
    config: { icon: "search", description: "Search" },
  },
  {
    pattern: /^(web|WebFetch|WebSearch)/i,
    config: { icon: "globe", description: "Web request" },
  },
  {
    pattern: /^(Task)/i,
    config: { icon: "git-branch", description: "Subagent" },
  },
];

const DEFAULT_TOOL_ICON: ToolIconConfig = {
  icon: "wrench",
  description: "Tool",
};

/**
 * Get icon configuration for a tool by name.
 * Returns Lucide icon name and description.
 */
export function getToolIcon(toolName: string): ToolIconConfig {
  for (const { pattern, config } of TOOL_ICON_PATTERNS) {
    if (pattern.test(toolName)) {
      return config;
    }
  }
  return DEFAULT_TOOL_ICON;
}

/**
 * Get display name for a tool (cleaned up for UI).
 */
export function getToolDisplayName(toolName: string): string {
  // Remove common prefixes/suffixes, capitalize
  return toolName
    .replace(/^(tool_|mcp_)/i, "")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
```

### 4. Create file-changes.ts

Utilities for managing file change state:

```typescript
// src/lib/utils/file-changes.ts
import type { FileChangeMessage } from "@/lib/types/agent-messages";

/**
 * Build a Map of file changes from an array of FileChangeMessage.
 * Later entries for the same path overwrite earlier ones (last write wins).
 */
export function buildFileChangesMap(
  changes: FileChangeMessage[]
): Map<string, FileChangeMessage> {
  const map = new Map<string, FileChangeMessage>();
  for (const change of changes) {
    map.set(change.path, change);
  }
  return map;
}

/**
 * Get operation icon for file change.
 */
export function getFileOperationIcon(
  operation: FileChangeMessage["operation"]
): string {
  switch (operation) {
    case "create":
      return "file-plus";
    case "modify":
      return "file-edit";
    case "delete":
      return "file-minus";
    case "rename":
      return "file-symlink";
    default:
      return "file";
  }
}

/**
 * Get human-readable operation label.
 */
export function getFileOperationLabel(
  operation: FileChangeMessage["operation"]
): string {
  switch (operation) {
    case "create":
      return "Created";
    case "modify":
      return "Modified";
    case "delete":
      return "Deleted";
    case "rename":
      return "Renamed";
    default:
      return "Changed";
  }
}
```

### 5. Create time-format.ts

Relative time formatting for timestamps:

```typescript
// src/lib/utils/time-format.ts

/**
 * Format timestamp as relative time ("2m ago", "1h ago").
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format timestamp as ISO string for datetime attribute.
 */
export function formatIsoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format timestamp as absolute time for tooltips.
 */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format duration in milliseconds as human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
```

### 6. Create tool-state.ts

Derives tool execution state from the message stream:

```typescript
// src/lib/utils/tool-state.ts
import type {
  AgentMessage,
  ToolUseMessage,
  ToolResultMessage,
} from "@/lib/types/agent-messages";

export interface ToolState {
  toolUse: ToolUseMessage;
  result?: ToolResultMessage;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

/**
 * Derive tool execution states from message stream.
 * Returns a Map keyed by tool_use ID.
 */
export function deriveToolStates(
  messages: AgentMessage[]
): Map<string, ToolState> {
  const tools = new Map<string, ToolState>();

  for (const msg of messages) {
    if (msg.type === "tool_use") {
      tools.set(msg.id, {
        toolUse: msg,
        status: "running",
      });
    } else if (msg.type === "tool_result") {
      const tool = tools.get(msg.tool_use_id);
      if (tool) {
        tool.result = msg;
        tool.status = msg.is_error ? "error" : "complete";
        tool.durationMs = msg.timestamp - tool.toolUse.timestamp;
      }
    }
  }

  return tools;
}
```

## Testing

1. **JSONL parsing**: Test with valid lines, malformed lines, and empty content
2. **Turn grouping**: Test message sequences with tool use, multiple turns, and edge cases
3. **Tool icons**: Verify all patterns match expected tools

```typescript
// Example test cases for turn-grouping.ts
describe("groupMessagesIntoTurns", () => {
  it("creates user turn from UserPromptMessage", () => {
    const messages = [
      { type: "user_prompt", content: "Hello", timestamp: 1 },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0].type).toBe("user");
  });

  it("groups consecutive assistant messages after user prompt", () => {
    const messages = [
      { type: "user_prompt", content: "Help me", timestamp: 1 },
      { type: "text", text: "I'll help", citations: null, timestamp: 2 },
      { type: "tool_use", id: "1", name: "Read", input: {}, timestamp: 3 },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(2); // user + assistant
  });

  it("creates new user turn on TurnStartMessage", () => {
    const messages = [
      { type: "user_prompt", content: "First", timestamp: 1 },
      { type: "text", text: "Response 1", citations: null, timestamp: 2 },
      { type: "complete", durationMs: 100, success: true, timestamp: 3 },
      { type: "turn_start", turnIndex: 1, prompt: "Second", timestamp: 4 },
      { type: "text", text: "Response 2", citations: null, timestamp: 5 },
    ];
    const turns = groupMessagesIntoTurns(messages);
    expect(turns).toHaveLength(4); // user1 + assistant1 + user2 + assistant2
  });
});
```

## Checklist

- [ ] Create `src/lib/utils/jsonl.ts`
- [ ] Create `src/lib/utils/turn-grouping.ts`
- [ ] Create `src/lib/utils/tool-icons.ts`
- [ ] Create `src/lib/utils/file-changes.ts`
- [ ] Create `src/lib/utils/time-format.ts`
- [ ] Create `src/lib/utils/tool-state.ts`
- [ ] Create `src/lib/utils/index.ts` barrel export
