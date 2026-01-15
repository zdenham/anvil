# SDK Message Format Refactor

Eliminates the flatten→re-group cycle by storing messages in SDK `MessageParam[]` format directly. Each event emits the full aggregated conversation state for data integrity.

## Problem

Current flow:
1. SDK yields grouped `SDKAssistantMessage` with `message.message.content[]`
2. Runner flattens into individual blocks (text, tool_use, tool_result, etc.)
3. `message-transform.ts` re-groups for multi-turn continuation

This is unnecessary work. The SDK already provides messages in `MessageParam`-compatible format.

## Solution

Store and emit the full `MessageParam[]` array on each event. Benefits:
- No transform layer needed
- Better data integrity (full state each event, not deltas)
- Simpler frontend state management (replace, don't reconstruct)
- Multi-turn continuation works directly

## Files to Modify

```
agents/src/
├── runner.ts              # Accumulate MessageParam[] instead of flattening
├── output.ts              # Emit full conversation state
├── message-transform.ts   # DELETE
```

```
src/
├── lib/types/agent-messages.ts  # Update types for new format
├── lib/agent-service.ts         # Update message handling
├── hooks/use-agent-execution.ts # Update state management
```

## Implementation

### 1. Update output.ts

Replace individual block emissions with full conversation state emission:

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

interface ConversationState {
  messages: MessageParam[];
  fileChanges: FileChange[];
  metrics?: ResultMetrics;
  status: "running" | "complete" | "error";
  error?: string;
}

let state: ConversationState = {
  messages: [],
  fileChanges: [],
  status: "running",
};

export function emitState(): void {
  const payload = { ...state, timestamp: Date.now() };
  console.log(JSON.stringify(payload));
  // Write full state to file (overwrite, not append)
  writeFileSync(statePath, JSON.stringify(payload, null, 2));
}

export function appendUserMessage(content: string): void {
  state.messages.push({ role: "user", content });
  emitState();
}

export function appendAssistantMessage(message: MessageParam): void {
  state.messages.push(message);
  emitState();
}

export function appendToolResult(toolUseId: string, content: string, isError?: boolean): void {
  // Tool results are user messages in SDK format
  state.messages.push({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
  });
  emitState();
}

export function updateFileChange(change: FileChange): void {
  // Upsert by path - later changes supersede earlier ones
  const idx = state.fileChanges.findIndex(c => c.path === change.path);
  if (idx >= 0) {
    state.fileChanges[idx] = change;
  } else {
    state.fileChanges.push(change);
  }
  emitState();
}

export function complete(metrics: ResultMetrics, diff?: string): void {
  state.metrics = metrics;
  state.status = "complete";
  emitState();
}

export function error(message: string): void {
  state.error = message;
  state.status = "error";
  emitState();
}
```

### 2. Update runner.ts

Accumulate SDK messages directly instead of flattening:

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  initState,
  appendUserMessage,
  appendAssistantMessage,
  appendToolResult,
  updateFileChange,
  complete,
  error,
  getMessages,
} from "./output.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Initialize with prior messages if resuming
  let priorMessages: MessageParam[] = [];
  if (args.historyFile && existsSync(args.historyFile)) {
    const state = JSON.parse(readFileSync(args.historyFile, "utf-8"));
    priorMessages = state.messages;
  }

  initState(args.conversationPath, priorMessages);
  appendUserMessage(args.prompt);

  const result = query({
    prompt: args.prompt,
    options: {
      // ... existing options
      messages: priorMessages,
      hooks: {
        PostToolUse: [
          {
            hooks: [
              async (input, toolUseID) => {
                const hookInput = input as PostToolUseHookInput;

                // Emit tool result as user message
                appendToolResult(
                  toolUseID ?? "unknown",
                  typeof hookInput.tool_response === "string"
                    ? hookInput.tool_response
                    : JSON.stringify(hookInput.tool_response)
                );

                // Check for file changes
                if (FILE_MODIFYING_TOOLS.has(hookInput.tool_name)) {
                  for (const file of getChangedFilesSinceHead(args.cwd)) {
                    if (!isBinaryFile(args.cwd, file.path)) {
                      const diff = getFileDiff(args.cwd, file.path);
                      if (diff) {
                        updateFileChange({ path: file.path, operation: file.operation, diff });
                      }
                    }
                  }
                }

                return { continue: true };
              },
            ],
          },
        ],
      },
    },
  });

  for await (const message of result) {
    if (message.type === "assistant") {
      // Store the full assistant message directly
      appendAssistantMessage(message.message as MessageParam);
    } else if (message.type === "result" && message.subtype === "success") {
      complete({
        durationApiMs: message.duration_api_ms,
        totalCostUsd: message.total_cost_usd,
        numTurns: message.num_turns,
      });
    }
  }
}
```

### 3. Delete message-transform.ts

```bash
rm agents/src/message-transform.ts
```

Remove the import from runner.ts.

### 4. Update frontend types

```typescript
// src/lib/types/agent-messages.ts

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

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
```

### 5. Update agent-service.ts

```typescript
command.stdout.on("data", (chunk: string) => {
  stdoutBuffer += chunk;
  const lines = stdoutBuffer.split("\n");
  stdoutBuffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const state = JSON.parse(line) as ConversationState;
      callbacks.onState(state);  // Single callback for full state
    } catch {
      logger.debug(`[agent:${conversation.id}] ${line}`);
    }
  }
});
```

### 6. Update use-agent-execution.ts

Replace message accumulation with state replacement:

```typescript
const [conversationState, setConversationState] = useState<ConversationState | null>(null);

const handleState = useCallback((state: ConversationState) => {
  setConversationState(state);  // Replace, don't merge
}, []);
```

## Storage Format

Before (messages.jsonl - append-only):
```jsonl
{"type":"user_prompt","content":"hello"}
{"type":"text","text":"Hi there"}
{"type":"tool_use","id":"123","name":"Read","input":{...}}
{"type":"tool_result","tool_use_id":"123","content":"..."}
```

After (state.json - overwrite):
```json
{
  "messages": [
    { "role": "user", "content": "hello" },
    { "role": "assistant", "content": [
      { "type": "text", "text": "Hi there" },
      { "type": "tool_use", "id": "123", "name": "Read", "input": {} }
    ]},
    { "role": "user", "content": [
      { "type": "tool_result", "tool_use_id": "123", "content": "..." }
    ]}
  ],
  "fileChanges": [...],
  "status": "running",
  "timestamp": 1234567890
}
```

## Bandwidth Considerations

Each event sends the full conversation state. For typical conversations:
- 10 turns with average tool results: ~50-100KB per event
- Large file reads (e.g., 100KB file): payload grows accordingly

Mitigations if needed (implement later if problematic):
1. Truncate tool results in emitted state (full results in file)
2. Emit full state only on key events (turn complete), deltas for streaming text
3. Compress payload (gzip before stdout)

For now, start with full state each event. Tauri IPC handles this fine.

## Migration

1. Implement new output format in agents/
2. Update frontend to handle new format
3. Delete message-transform.ts
4. Old conversations won't be resumable (acceptable for now, or add migration script)

## Testing

1. Run agent, verify state.json contains valid MessageParam[] format
2. Resume conversation, verify prior messages are passed correctly to SDK
3. Verify frontend displays messages correctly
4. Check stdout payload sizes during typical conversation
