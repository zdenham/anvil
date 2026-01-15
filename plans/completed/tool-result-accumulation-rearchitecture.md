# Tool Result Accumulation Re-architecture Plan

## Executive Summary

This document analyzes two related bugs in the thread message handling system:
1. **Assistant messages disappearing between tool calls** - messages are being lost or overwritten during multi-tool executions
2. **Tools flashing with error state before success** - brief error state display before the correct completion state appears

**Root Cause**: The accumulation logic in `output.ts` is overly complex and doesn't align with how the SDK actually works. The fix is to simplify to match SDK-standard message formats.

## SDK Message Format (The Standard)

The Claude Agent SDK expects messages in this format when resuming:

```typescript
MessageParam[] = [
  { role: "user", content: "original prompt" },
  { role: "assistant", content: [TextBlock, ToolUseBlock, ToolUseBlock] },
  { role: "user", content: [ToolResultBlock, ToolResultBlock] },  // ALL results in ONE message
  { role: "assistant", content: [TextBlock] },
  // ...
]
```

**Key rules**:
1. Messages strictly alternate: user → assistant → user → assistant
2. All tool_results for a turn go in ONE user message
3. Assistant messages are complete (with `includePartialMessages: false`)

## Current Problems

### Problem 1: Unnecessary Replace Logic

```typescript
// output.ts - CURRENT (problematic)
export function appendAssistantMessage(message: MessageParam): void {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "assistant") {
    // Replace - this is a streaming update for the same turn
    state.messages[state.messages.length - 1] = message;  // ← WRONG
  } else {
    state.messages.push(message);
  }
  emitState();
}
```

**Why it's wrong**: With `includePartialMessages: false`, the SDK yields complete assistant messages. The replace logic was added defensively but causes message loss if:
- The SDK yields assistant before tools AND after (rare but possible)
- Any timing issue causes re-emission

**Fix**: Just push with defensive logging. The SDK guarantees ordering, but log a warning if consecutive assistant messages are detected (shouldn't happen, but worth catching).

### Problem 2: Tool State Derivation Timing

```typescript
// tool-state.ts
if (isStreamComplete) {
  // Mark orphaned tools as errors
  for (const [id, state] of states) {
    if (state.status === "running") {
      states.set(id, { status: "error", ... });
    }
  }
}
```

The flash happens when:
1. Tool is executing
2. A state update has `status !== "running"` but tool_result not yet in messages
3. `isStreamComplete = true` → tool marked as error
4. Next state has tool_result → corrected to success

**Fix**: Don't derive tool states from messages - track them explicitly.

---

## The Fix: Simplified SDK-Standard Accumulation

### New `output.ts` (Complete Replacement)

```typescript
import { writeFileSync } from "fs";
import { join } from "path";
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

export interface ToolExecutionState {
  status: "running" | "complete" | "error";
  result?: string;
  isError?: boolean;
}

export interface ThreadState {
  messages: MessageParam[];
  fileChanges: FileChange[];
  workingDirectory: string;
  metrics?: ResultMetrics;
  status: "running" | "complete" | "error";
  error?: string;
  timestamp: number;
  contentMdUpdatedAt?: number;
  // Explicit tool states - prevents flash from derivation timing
  toolStates: Record<string, ToolExecutionState>;
}

let statePath: string;
let state: ThreadState;

export function initState(
  threadPath: string,
  workingDirectory: string,
  priorMessages: MessageParam[] = []
): void {
  statePath = join(threadPath, "state.json");
  state = {
    messages: priorMessages,
    fileChanges: [],
    workingDirectory,
    status: "running",
    timestamp: Date.now(),
    toolStates: {},
  };
  emitState();
}

export function emitState(): void {
  state.timestamp = Date.now();
  const payload = { ...state };
  console.log(JSON.stringify(payload));
  writeFileSync(statePath, JSON.stringify(payload, null, 2));
}

/**
 * Append a user message (for initial prompt).
 */
export function appendUserMessage(content: string): void {
  state.messages.push({ role: "user", content });
  emitState();
}

/**
 * Append an assistant message. Just push - SDK guarantees ordering.
 * No replace logic needed with includePartialMessages: false.
 */
export function appendAssistantMessage(message: MessageParam): void {
  // Defensive: log warning if consecutive assistant messages (shouldn't happen with SDK)
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "assistant") {
    console.error(
      "[output] Warning: consecutive assistant messages detected - investigate SDK behavior"
    );
  }
  state.messages.push(message);
  emitState();
}

/**
 * Append a tool result as a user message (SDK format).
 * SDK expects ALL tool_results for a turn in ONE user message.
 * This is the only "special" accumulation logic needed.
 */
export function appendToolResult(
  toolUseId: string,
  content: string,
  isError?: boolean
): void {
  const toolResultBlock = {
    type: "tool_result" as const,
    tool_use_id: toolUseId,
    content,
    ...(isError && { is_error: isError }),
  };

  const lastMsg = state.messages[state.messages.length - 1];

  // Check if last message is a user message with only tool_results
  const isToolResultMessage =
    lastMsg?.role === "user" &&
    Array.isArray(lastMsg.content) &&
    lastMsg.content.length > 0 &&
    lastMsg.content.every(
      (b) => typeof b === "object" && b !== null && "type" in b && b.type === "tool_result"
    );

  if (isToolResultMessage) {
    // Accumulate into existing tool_result message
    (lastMsg.content as Array<typeof toolResultBlock>).push(toolResultBlock);
  } else {
    // Create new message
    state.messages.push({
      role: "user",
      content: [toolResultBlock],
    });
  }

  // Update explicit tool state
  state.toolStates[toolUseId] = {
    status: isError ? "error" : "complete",
    result: content,
    isError,
  };

  emitState();
}

/**
 * Mark a tool as running (called before tool execution).
 */
export function markToolRunning(toolUseId: string): void {
  state.toolStates[toolUseId] = { status: "running" };
  emitState();
}

/**
 * Mark that content.md was updated.
 */
export function markContentMdUpdated(): void {
  state.contentMdUpdatedAt = Date.now();
  emitState();
}

/**
 * Update or add a file change.
 */
export function updateFileChange(change: FileChange): void {
  const idx = state.fileChanges.findIndex((c) => c.path === change.path);
  if (idx >= 0) {
    state.fileChanges[idx] = change;
  } else {
    state.fileChanges.push(change);
  }
  emitState();
}

/**
 * Mark orphaned tools as errors.
 * Called before completing or erroring to clean up any tools that never finished.
 */
function markOrphanedToolsAsError(): void {
  for (const id of Object.keys(state.toolStates)) {
    if (state.toolStates[id].status === "running") {
      state.toolStates[id] = {
        status: "error",
        result: "Tool execution was interrupted",
        isError: true,
      };
    }
  }
}

/**
 * Mark the thread as complete with metrics.
 */
export function complete(metrics: ResultMetrics): void {
  markOrphanedToolsAsError();
  state.metrics = metrics;
  state.status = "complete";
  emitState();
}

/**
 * Mark the thread as errored.
 */
export function error(message: string): void {
  markOrphanedToolsAsError();
  state.error = message;
  state.status = "error";
  emitState();
}

/**
 * Get current messages (for passing to SDK).
 */
export function getMessages(): MessageParam[] {
  return state.messages;
}
```

### Changes Summary

| What | Before | After |
|------|--------|-------|
| `appendAssistantMessage` | Replace if last is assistant | Just push (with defensive warning) |
| Tool states | Derived at render time | Explicit in state |
| Tool result accumulation | Same | Same (needed for SDK format) |
| State shape | `messages[]` only | `messages[]` + `toolStates{}` |
| Orphan handling | In derivation logic | In `complete()` and `error()` |
| Backwards compat | N/A | Nullish coalescing for old state files |

### Runner Changes

```typescript
// runner.ts - in the SDK loop
for await (const message of result) {
  if (message.type === "assistant") {
    // Mark any tool_use blocks as running BEFORE they execute
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        markToolRunning(block.id);
      }
    }
    appendAssistantMessage({
      role: "assistant",
      content: message.message.content,
    });
  }
}

// In PostToolUse hook - tool states are updated in appendToolResult
```

---

## Why This Works

1. **No race conditions**: Tool states are set explicitly when tools start/complete, not derived from message ordering
2. **SDK-compatible**: Messages array is exactly what the SDK expects for resumption
3. **Redundancy preserved**: Full state emitted on every change
4. **Simple**: Only one piece of "special" logic (tool_result accumulation) which is required by the SDK format
5. **Orphan handling**: Tools that never complete are marked as errors when thread completes/errors

---

## Backwards Compatibility

### Loading Old State Files

Existing `state.json` files don't have `toolStates`. Handle this gracefully:

1. **In `initState`**: Always initialize `toolStates: {}` (already shown above)

2. **In frontend components**: Use nullish coalescing when accessing tool states:
```typescript
// Safe access - handles missing toolStates from old state files
const state = threadState.toolStates?.[block.id] ?? { status: "running" };
```

3. **Type definition**: Keep `toolStates` as required in the type, but code defensively:
```typescript
// In ThreadState type
toolStates: Record<string, ToolExecutionState>;  // Required in type

// In usage - always use nullish coalescing for safety
const toolState = toolStates?.[id] ?? { status: "running" };
```

### Migration

No migration needed. Old threads without `toolStates` will:
- Render all tools as "running" initially (safe default)
- Work correctly on next run (toolStates will be populated)

---

## Testing Checklist

### Core Functionality
- [ ] Single tool execution - no flash, correct status transitions
- [ ] Multiple sequential tools - no flash, all messages preserved
- [ ] Parallel tool execution - all results in one user message
- [ ] Resume agent - message history loads correctly

### Edge Cases
- [ ] Agent crash mid-tool - orphaned tools marked as error
- [ ] Thread error during execution - orphaned tools marked as error
- [ ] Load old state.json without toolStates - renders without crash
- [ ] Consecutive assistant messages - warning logged (if SDK behavior changes)

### Regression Tests
- [ ] No assistant messages lost between tool calls
- [ ] Tool results correctly associated with tool_use blocks
- [ ] Thread completion metrics captured correctly

---

## Files to Change

| File | Change |
|------|--------|
| `agents/src/output.ts` | Simplify to just push, add `toolStates`, add `markToolRunning` |
| `agents/src/runner.ts` | Call `markToolRunning` when assistant message has tool_use blocks |
| `src/lib/types/agent-messages.ts` | Add `ToolExecutionState` and `toolStates` to ThreadState |
| `src/components/thread/assistant-message.tsx` | Use `toolStates` directly |
| `src/lib/utils/tool-state.ts` | DELETE - no longer needed |

---

## Frontend Type Changes

### `src/lib/types/agent-messages.ts`

```typescript
// ADD: Tool execution state type
export interface ToolExecutionState {
  status: "running" | "complete" | "error";
  result?: string;
  isError?: boolean;
}

// UPDATE: ThreadState to include toolStates
export interface ThreadState {
  messages: MessageParam[];
  fileChanges: FileChange[];
  workingDirectory: string;
  metrics?: ResultMetrics;
  status: "running" | "complete" | "error";
  error?: string;
  timestamp: number;
  contentMdUpdatedAt?: number;
  toolStates: Record<string, ToolExecutionState>;  // Required, not optional
}
```

### `src/components/thread/assistant-message.tsx`

```typescript
interface AssistantMessageProps {
  messages: MessageParam[];
  messageIndex: number;
  isStreaming?: boolean;
  // Optional for backwards compatibility with old state files
  toolStates?: Record<string, ToolExecutionState>;
}

export function AssistantMessage({
  messages,
  messageIndex,
  isStreaming = false,
  toolStates,
}: AssistantMessageProps) {
  const message = messages[messageIndex];
  const content = (message.content as ContentBlock[]) ?? [];

  return (
    <article>
      {content.map((block, index) => {
        if (block.type === "tool_use") {
          // Defensive: handle missing toolStates (old state files) or missing entry
          const state = toolStates?.[block.id] ?? { status: "running" };
          return (
            <ToolUseBlock
              key={block.id}
              id={block.id}
              name={block.name}
              input={block.input}
              result={state.result}
              isError={state.isError}
              status={state.status}
            />
          );
        }
        // ... text, thinking blocks
      })}
    </article>
  );
}
```

### Prop Threading

Pass `toolStates` down from `TaskWorkspace` → `ChatPane` → `ThreadView` → `MessageList` → `TurnRenderer` → `AssistantMessage`.

Or pass the whole `threadState` and destructure where needed.

---

## Review Notes (2025-12-28)

Plan reviewed against Anthropic SDK documentation and current implementation. The following refinements were made:

### Added: Orphaned Tool Handling

Tools that are still "running" when the thread completes or errors need to be marked as errors. Added `markOrphanedToolsAsError()` helper called from both `complete()` and `error()`.

**Why**: Without this, tools that never receive results (due to crashes, errors, etc.) would stay in "running" state forever in the UI.

### Added: Defensive Logging

Added console warning in `appendAssistantMessage()` if consecutive assistant messages are detected. This shouldn't happen with `includePartialMessages: false`, but will help catch any SDK behavior changes.

**Why**: The "just push" approach is correct per SDK docs, but we want visibility if assumptions are violated.

### Added: Backwards Compatibility

Old `state.json` files don't have `toolStates`. The plan now includes:
- Always initialize `toolStates: {}`
- Use nullish coalescing (`toolStates?.[id] ?? { status: "running" }`) in frontend
- Make `toolStates` prop optional in components

**Why**: Prevents crashes when loading old thread state files.

### Fixed: TypeScript Syntax

Changed `typeof toolResultBlock[]` to `Array<typeof toolResultBlock>` for correct TypeScript syntax.

### Sources Referenced

- [How to implement tool use - Claude Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Anthropic SDK TypeScript](https://github.com/anthropics/anthropic-sdk-typescript)
