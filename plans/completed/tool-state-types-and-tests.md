# Message Handler Service: Clean SDK Message Processing

## Problem Statement

The current architecture in `shared.ts` misuses hooks for data extraction:

```typescript
// Current: Using hooks to capture tool results
PostToolUse: [{
  hooks: [async (hookInput: unknown, toolUseID?: string) => {
    const input = hookInput as PostToolUseHookInput;
    appendToolResult(toolUseID, input.tool_response);  // ← Should be in message processing
    return { continue: true };
  }]
}]
```

**Issues:**
1. **Hooks used for reads**: Hooks are designed for behavior modification (writes), not data extraction (reads)
2. **Type safety**: `hookInput: unknown` with manual casts vs SDK's proper types
3. **Missing message types**: Only `assistant` and `result` messages processed; `user` messages (tool results) ignored
4. **Duplicate state tracking**: Tool results tracked in hooks AND would be in user messages
5. **Test bug**: `usedTools()` assertion checks `toolStates` keys expecting tool names, but they're `toolUseId` UUIDs

## Key Insight

**IMPORTANT: Use SDK types directly.** All message types (`SDKAssistantMessage`, `SDKUserMessage`, `SDKResultMessage`, `SDKToolProgressMessage`, `SDKMessage`) should be imported from `@anthropic-ai/claude-agent-sdk`. Do NOT redeclare these types locally—this ensures type safety and prevents drift from the SDK's actual implementation.

The SDK message stream contains ALL the information we need:

```typescript
// SDK emits these message types in order (import from @anthropic-ai/claude-agent-sdk):
SDKAssistantMessage  // Claude's response with tool_use blocks
SDKUserMessage       // Tool results (parent_tool_use_id links to tool_use)
SDKResultMessage     // Final completion with metrics
```

**Hooks should only be used for:**
- Side effects (relay events, notify file changes)
- Behavior modification (stopHook for approval flow)

## Architecture: MessageHandler Service

Create a dedicated service for parsing SDK messages and routing to appropriate handlers.

```
┌─────────────────────────────────────────────────────────────────┐
│                        runAgentLoop()                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │   SDK query()     │───▶│      MessageHandler             │  │
│  │                   │    │                                  │  │
│  │  Emits:           │    │  Routes to:                      │  │
│  │  - assistant      │    │  - handleAssistant()             │  │
│  │  - user           │    │  - handleUser() ← tool results   │  │
│  │  - result         │    │  - handleResult()                │  │
│  │  - system         │    │  - handleSystem() (optional)     │  │
│  │  - tool_progress  │    │  - handleToolProgress()          │  │
│  └──────────────────┘    └──────────────────────────────────┘  │
│                                      │                          │
│                                      ▼                          │
│                          ┌──────────────────┐                   │
│                          │    output.ts     │                   │
│                          │                  │                   │
│                          │  State updates:  │                   │
│                          │  - messages      │                   │
│                          │  - toolStates    │                   │
│                          │  - fileChanges   │                   │
│                          │  - metrics       │                   │
│                          └──────────────────┘                   │
├─────────────────────────────────────────────────────────────────┤
│  Hooks (side effects only):                                     │
│  - PostToolUse: relayEventsFromToolOutput(), onFileChange()     │
│  - PostToolUseFailure: logging only                             │
│  - Stop: stopHook() for approval (behavior modification)        │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Create MessageHandler Service

**File: `agents/src/runners/message-handler.ts`**

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
// Import SDK message types directly - do NOT redeclare these locally
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
  SDKMessage,  // Union type of all message types
} from "@anthropic-ai/claude-agent-sdk";
import {
  appendAssistantMessage,
  appendUserToolResults,
  markToolRunning,
  markToolComplete,
  complete,
} from "../output.js";
import { logger } from "../lib/logger.js";

/**
 * MessageHandler processes SDK messages and updates thread state.
 *
 * Single responsibility: Route SDK messages to appropriate state updates.
 * Does NOT handle side effects (hooks handle those).
 *
 * Message history is NOT built here - the SDK messages are the source of truth.
 * This handler only:
 * 1. Updates toolStates (running -> complete/error)
 * 2. Calls complete() on result messages
 *
 * Message history (for display) can be built by iterating over collected SDK messages.
 */
export class MessageHandler {
  /**
   * Process a single SDK message.
   * Returns true if processing should continue.
   */
  handle(message: SDKMessage): boolean {
    switch (message.type) {
      case "assistant":
        return this.handleAssistant(message);
      case "user":
        return this.handleUser(message);
      case "result":
        return this.handleResult(message);
      case "tool_progress":
        return this.handleToolProgress(message);
      default:
        logger.debug(`[MessageHandler] Ignoring message type: ${(message as { type: string }).type}`);
        return true;
    }
  }

  private handleAssistant(msg: SDKAssistantMessage): boolean {
    // Mark all tool_use blocks as running
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        markToolRunning(block.id, block.name);
      }
    }

    // Append full message to thread
    // NOTE: msg.message is APIAssistantMessage (from SDK), but appendAssistantMessage
    // expects MessageParam. These types are structurally compatible (both have
    // role: "assistant" and content array), so we can pass the SDK message directly.
    // If TypeScript complains, use explicit assertion: msg.message as MessageParam
    appendAssistantMessage({
      role: "assistant",
      content: msg.message.content,
    });

    return true;
  }

  private handleUser(msg: SDKUserMessage): boolean {
    // Only process synthetic user messages (tool results)
    // Real user messages come from the prompt, not the stream
    if (!msg.parent_tool_use_id) {
      logger.debug("[MessageHandler] Ignoring non-tool user message");
      return true;
    }

    // This is a tool result - extract and track completion
    const toolUseId = msg.parent_tool_use_id;
    const result = this.extractToolResult(msg);
    const isError = this.detectToolError(msg);

    markToolComplete(toolUseId, result, isError);

    return true;
  }

  private handleResult(msg: SDKResultMessage): boolean {
    // Handle all result subtypes explicitly
    // NOTE: We use `duration_api_ms` (API round-trip time) rather than `duration_ms` (total wall clock).
    // Rationale: duration_api_ms better reflects actual API costs and is more useful for
    // performance analysis since it excludes local processing time.
    switch (msg.subtype) {
      case "success":
        complete({
          durationApiMs: msg.duration_api_ms,
          totalCostUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        });
        break;
      case "error_during_execution":
        // Tool execution error - runner should call error() with details
        logger.warn(`[MessageHandler] Execution error: ${msg.error_message ?? "unknown"}`);
        break;
      case "error_max_turns":
        logger.warn(`[MessageHandler] Max turns reached: ${msg.num_turns}`);
        break;
      case "error_max_budget_usd":
        logger.warn(`[MessageHandler] Budget limit exceeded`);
        break;
      case "error_max_structured_output_retries":
        logger.warn(`[MessageHandler] Max structured output retries reached`);
        break;
      default:
        // Fallback for unknown subtypes (future SDK versions may add more)
        if (!msg.is_error) {
          complete({
            durationApiMs: msg.duration_api_ms,
            totalCostUsd: msg.total_cost_usd,
            numTurns: msg.num_turns,
          });
        } else {
          logger.warn(`[MessageHandler] Unknown error subtype: ${msg.subtype}`);
        }
    }
    return false;  // Stop processing
  }

  private handleToolProgress(msg: SDKToolProgressMessage): boolean {
    // Could emit progress events here if needed
    logger.debug(
      `[MessageHandler] Tool ${msg.tool_name} running for ${msg.elapsed_time_seconds}s`
    );
    return true;
  }

  /**
   * Extract tool result from SDKUserMessage.
   *
   * The SDK provides `tool_use_result` as the primary source.
   * The `message` field is a `MessageParam` which may contain tool_result blocks
   * as a fallback (useful for manual message construction or tests).
   */
  private extractToolResult(msg: SDKUserMessage): string {
    // Primary: tool_use_result is pre-parsed by SDK
    if (msg.tool_use_result !== undefined) {
      return typeof msg.tool_use_result === "string"
        ? msg.tool_use_result
        : JSON.stringify(msg.tool_use_result);
    }

    // Fallback: extract from message.content (MessageParam structure)
    // msg.message is MessageParam, which has content as string | ContentBlockParam[]
    const messageParam = msg.message;
    if (!messageParam) return "";

    const content = messageParam.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      // Look for tool_result block in the content array
      for (const block of content) {
        if (typeof block === "object" && block !== null && "type" in block) {
          if (block.type === "tool_result" && "content" in block) {
            const resultContent = block.content;
            return typeof resultContent === "string"
              ? resultContent
              : JSON.stringify(resultContent);
          }
        }
      }
    }
    return "";
  }

  private detectToolError(msg: SDKUserMessage): boolean {
    // Check tool_use_result for error indicators
    const result = msg.tool_use_result;
    if (typeof result === "object" && result !== null && "is_error" in result) {
      return Boolean(result.is_error);
    }

    // Fallback: check message.content for tool_result with is_error
    const messageParam = msg.message;
    if (!messageParam) return false;

    const content = messageParam.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result" &&
          "is_error" in block
        ) {
          return Boolean(block.is_error);
        }
      }
    }

    return false;
  }
}
```

### Phase 2: Update output.ts

Add `markToolComplete` and update `markToolRunning` to track tool names:

```typescript
// In output.ts

/**
 * Mark a tool as running (called when assistant message has tool_use).
 */
export function markToolRunning(toolUseId: string, toolName: string): void {
  state.toolStates[toolUseId] = { status: "running", toolName };
  emitState();
}

/**
 * Mark a tool as complete (called when user message has tool result).
 * Replaces the hook-based appendToolResult for completion tracking.
 *
 * NOTE: This updates tool STATE only. It does NOT add messages to history.
 * Message history is built directly from SDK messages (SDKAssistantMessage,
 * SDKUserMessage) which are collected during the agent loop.
 */
export function markToolComplete(
  toolUseId: string,
  result: string,
  isError: boolean
): void {
  const existingState = state.toolStates[toolUseId];
  const toolName = existingState?.toolName;

  // Defensive validation: toolName should exist from markToolRunning
  // If missing, it indicates handleUser was called before handleAssistant (shouldn't happen)
  if (!toolName) {
    logger.warn(
      `[markToolComplete] toolName missing for ${toolUseId}. ` +
      `This may indicate messages arrived out of order.`
    );
  }

  state.toolStates[toolUseId] = {
    status: isError ? "error" : "complete",
    result,
    isError,
    toolName,  // Preserve from running state
  };
  emitState();
}

// NOTE: `appendToolResultMessage` has been removed from this plan.
// Tool result messages arrive as SDKUserMessage from the SDK stream and are
// processed by MessageHandler.handleUser(), which calls markToolComplete().
// Message history is built directly from collected SDK messages, not via
// separate accumulation functions.
```

### Phase 3: Update Schema

**File: `core/types/events.ts`**

Add `toolName` to `ToolExecutionStateSchema`:

```typescript
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error"]),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(),  // NEW: Track which tool was used
});
```

### Phase 4: Refactor shared.ts

Simplify the main loop to use MessageHandler:

```typescript
// In shared.ts

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MessageHandler } from "./message-handler.js";
import { mockQuery } from "../testing/mock-query.js";
import { relayEventsFromToolOutput } from "../output.js";
import { logger } from "../lib/logger.js";
import type {
  RunnerConfig,
  OrchestrationContext,
  AgentConfig,
  AgentLoopOptions,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
} from "../types.js";

export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
  // ... init state, build system prompt ...

  // Hooks for SIDE EFFECTS ONLY
  const hooks = {
    PostToolUse: [{
      hooks: [
        async (hookInput: PostToolUseHookInput) => {
          // Side effect: relay embedded events to stdout
          const toolResponse = typeof hookInput.tool_response === "string"
            ? hookInput.tool_response
            : JSON.stringify(hookInput.tool_response);
          relayEventsFromToolOutput(toolResponse);

          // Side effect: notify strategy of file changes
          if (options.onFileChange) {
            options.onFileChange(hookInput.tool_name);
          }

          // NOTE: Tool state tracking moved to message processing
          return { continue: true };
        }
      ]
    }],
    PostToolUseFailure: [{
      hooks: [
        async (hookInput: PostToolUseFailureHookInput) => {
          logger.debug(`[PostToolUseFailure] ${hookInput.tool_name}: ${hookInput.error}`);
          // NOTE: Error state tracking moved to message processing
          return { continue: true };
        }
      ]
    }],
    ...(options.stopHook && { Stop: [{ hooks: [options.stopHook] }] }),
  };

  // Run the agent
  const result = useMockMode
    ? mockQuery({ /* ... */ })
    : query({ /* ... */ });

  // Process messages with dedicated handler
  const handler = new MessageHandler();

  for await (const message of result) {
    const shouldContinue = handler.handle(message);
    if (!shouldContinue) break;
  }
}
```

### Phase 5: Fix Test Assertions

**File: `agents/src/testing/assertions.ts`**

Fix `usedTools()` to read `toolName` from state values:

```typescript
/**
 * Assert agent used all of the specified tools.
 * Checks toolName field in tool states (not the keys, which are UUIDs).
 */
usedTools(toolNames: string[]): this {
  const usedToolNames = new Set<string>();

  for (const state of this.output.states) {
    for (const toolState of Object.values(state.state.toolStates ?? {})) {
      if (toolState.toolName) {
        usedToolNames.add(toolState.toolName);
      }
    }
  }

  const missing = toolNames.filter((name) => !usedToolNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Tools not used: [${missing.join(", ")}]. ` +
      `Used tools: [${Array.from(usedToolNames).join(", ")}]`
    );
  }
  return this;
}

/**
 * Assert agent did not use any of the specified tools.
 */
didNotUseTools(toolNames: string[]): this {
  const usedToolNames = new Set<string>();

  for (const state of this.output.states) {
    for (const toolState of Object.values(state.state.toolStates ?? {})) {
      if (toolState.toolName) {
        usedToolNames.add(toolState.toolName);
      }
    }
  }

  const found = toolNames.filter((name) => usedToolNames.has(name));
  if (found.length > 0) {
    throw new Error(`Expected tools not to be used but found: [${found.join(", ")}]`);
  }
  return this;
}
```

### Phase 6: Update Mock Query

Update `agents/src/testing/mock-query.ts` to emit `SDKUserMessage` after tool execution. This is significant restructuring since the current mock only yields assistant and result messages.

**Current Structure (simplified):**
```typescript
// Current mock-query.ts - only yields assistant and result
async function* mockQuery(options) {
  // Yields SDKAssistantMessage
  yield assistantMessage;
  // Executes tools internally, calls hooks
  // Yields SDKResultMessage
  yield resultMessage;
}
```

**Required Changes:**

```typescript
// In agents/src/testing/mock-query.ts
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

/**
 * Mock query that emits the same message sequence as the real SDK.
 *
 * Message sequence for each turn:
 * 1. SDKAssistantMessage - Claude's response with tool_use blocks
 * 2. SDKUserMessage (per tool) - Tool result for each tool_use
 * 3. SDKResultMessage - Final completion (after all turns)
 */
export async function* mockQuery(
  options: MockQueryOptions
): AsyncGenerator<SDKMessage> {
  // ... setup ...

  const sessionId = options.sessionId ?? `mock-session-${Date.now()}`;
  let turnIndex = 0;

  for (const turn of conversation) {
    // 1. Yield assistant message
    const assistantMsg: SDKAssistantMessage = {
      type: "assistant",
      message: {
        role: "assistant",
        content: turn.content,
      },
      parent_tool_use_id: null,
      uuid: `mock-uuid-assistant-${turnIndex}`,
      session_id: sessionId,
    };
    yield assistantMsg;

    // 2. Process each tool and yield user message with result
    for (const block of turn.content) {
      if (block.type === "tool_use") {
        // Execute the tool
        const toolResult = await executeToolMock(block.name, block.input);
        const isError = toolResult.isError ?? false;

        // Build MessageParam structure for the user message
        const toolResultBlock: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult.content,
          is_error: isError,
        };

        const userMessageParam: MessageParam = {
          role: "user",
          content: [toolResultBlock],
        };

        // Yield SDKUserMessage with all required fields
        const userMsg: SDKUserMessage = {
          type: "user",
          message: userMessageParam,
          parent_tool_use_id: block.id,
          tool_use_result: toolResult.content,
          session_id: sessionId,
        };
        yield userMsg;

        // Still call hooks for side effects (event relay, file changes)
        if (options.hooks?.PostToolUse) {
          for (const hookGroup of options.hooks.PostToolUse) {
            for (const hook of hookGroup.hooks) {
              await hook({
                tool_name: block.name,
                tool_response: toolResult.content,
              });
            }
          }
        }
      }
    }
    turnIndex++;
  }

  // 3. Yield result message (success or error based on tool execution)
  // Check if any tools failed during execution
  const hasToolErrors = toolErrors.length > 0;

  if (hasToolErrors) {
    // Yield error result message when tools fail
    const errorResultMsg: SDKResultMessage = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      error_message: toolErrors.join("; "),
      uuid: `mock-uuid-result-${Date.now()}`,
      session_id: sessionId,
    };
    yield errorResultMsg;
  } else {
    // Yield success result message
    const resultMsg: SDKResultMessage = {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_api_ms: options.mockDuration ?? 100,
      total_cost_usd: options.mockCost ?? 0.001,
      num_turns: conversation.length,
      result: "Mock query completed",
      uuid: `mock-uuid-result-${Date.now()}`,
      session_id: sessionId,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
    };
    yield resultMsg;
  }
}
```

**Key Changes from Current Implementation:**
1. Import SDK types with `SDK` prefix
2. Yield `SDKUserMessage` after each tool execution (not just assistant + result)
3. Build proper `MessageParam` structure for user messages
4. Include `parent_tool_use_id` and `tool_use_result` fields
5. Maintain hook calls for side effects

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/runners/message-handler.ts` | **NEW** - MessageHandler service (~150 lines) |
| `agents/src/runners/shared.ts` | Use MessageHandler, simplify hooks to side effects only |
| `agents/src/output.ts` | Add `markToolComplete`, update `markToolRunning` signature |
| `core/types/events.ts` | Add `toolName` to `ToolExecutionStateSchema` |
| `agents/src/testing/assertions.ts` | Fix `usedTools()` and `didNotUseTools()` |
| `agents/src/testing/mock-query.ts` | Emit `SDKUserMessage` for tool results, restructure to match SDK message sequence |
| `agents/src/testing/mock-claude-client.ts` | Replace any local message type declarations with SDK imports (`SDKMessage`, etc.) |

**Note:** Per agents.md guidelines, files should remain below 250 lines. The MessageHandler service is estimated at ~150 lines, well within limits.

### Subsection: Migrating mock-claude-client.ts Types

The current `mock-claude-client.ts` uses locally-defined simplified message types that diverge from the actual SDK types. This creates maintenance burden and type safety gaps.

**Current state (problematic):**
```typescript
// mock-claude-client.ts - local type definitions
type MockSDKMessage = {
  type: "assistant" | "user" | "result";
  // ... simplified fields
};
```

**Target state:**
```typescript
// mock-claude-client.ts - use SDK types directly
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

// No local type definitions - use SDK types everywhere
```

**Migration steps:**
1. Add SDK type imports at top of file
2. Replace all local `Mock*` type references with SDK types
3. Update mock message construction to include all required SDK fields
4. Remove local type definitions
5. Run `pnpm typecheck` to catch any missing fields

## Verification

1. `pnpm typecheck` - No type errors
2. `pnpm test:agents` - All existing tests pass
3. Manual test: Run agent, verify tool states transition correctly (running → complete/error)
4. Verify UI shows tool completion status

## Migration Notes

- **Backwards compatible**: `toolName` is optional in schema
- **Message processing order**: SDK guarantees assistant → user (tool result) → assistant ordering
- **Hooks still work**: Side effects (event relay, file change notification) still happen in hooks
- **No duplicate writes**: Tool state only updated once (in message processing), not twice (hooks + messages)
- **Breaking Change - Duration Field**: We deliberately use `duration_api_ms` instead of `duration_ms`. The SDK provides both fields:
  - `duration_ms`: Total wall clock time including local processing
  - `duration_api_ms`: API round-trip time only

  We chose `duration_api_ms` because it better reflects actual API costs and is more useful for performance analysis since it excludes local processing time. Any existing code using `duration_ms` should migrate to `duration_api_ms`.
- **Test examples are minimal**: Code examples in this plan show minimal message structures for readability. Production mocks and tests should include all required SDK fields (e.g., `uuid`, `session_id`, `usage`, etc.).

## Migration Strategy (Multi-PR)

To avoid duplicate state updates during migration, implement changes across separate PRs:

### PR 1: Schema and State Functions
**Goal:** Add new infrastructure without changing behavior.

1. Add `toolName` to `ToolExecutionStateSchema` in `core/types/events.ts`
2. Add `markToolComplete` function to `agents/src/output.ts`
3. Update `markToolRunning` to accept and store `toolName`
4. No changes to shared.ts or hooks yet

**Verification:** `pnpm typecheck && pnpm test:agents` - all existing tests pass, no behavior change.

### PR 2: MessageHandler Service
**Goal:** Add message processing infrastructure, run in parallel with hooks.

1. Create `agents/src/runners/message-handler.ts`
2. Integrate MessageHandler into `shared.ts` agent loop
3. **Keep existing hooks** - both hooks AND message processing update state temporarily
4. Add logging to detect any discrepancies between hook and message-based updates

**Verification:** Run agents manually, verify tool states are updated (may have duplicate updates, that's OK).

### PR 3: Mock Query Updates
**Goal:** Update test infrastructure to emit proper message sequence.

1. Restructure `mock-query.ts` to yield `SDKUserMessage` after tool execution
2. Update `mock-claude-client.ts` to use SDK types
3. Update test assertions in `assertions.ts` to read `toolName` from state values

**Warning: `usedTools()` Breaking Change**

The fix to `usedTools()` will cause existing tests to fail if they previously passed due to the bug where tool use IDs happened to match tool names (unlikely but possible). More likely, tests using `usedTools()` may have been incorrectly passing or were not actually validating tool usage properly. Review and update all tests using `usedTools()` after this change:

```typescript
// Before (broken): Looking at keys which are UUIDs like "toolu_01234..."
// After (fixed): Looking at toolName field which contains actual tool names like "Read", "Write"

result.assert.usedTools(["Read", "Write"]);  // Now works correctly
```

**Migration Note: Callback vs Generator Approach**

The current `mock-query.ts` uses a callback-based approach (`onToolResult`, `onToolFailure`). The new implementation uses an async generator that yields `SDKMessage` objects. During the transition:

1. **PR 2 Phase (Parallel Mode):** Keep callback hooks active while adding generator message yields. Both will fire:
   - Hooks: `PostToolUse` callback fires for side effects
   - Generator: Yields `SDKUserMessage` for state updates via `MessageHandler`
   - This duplication is intentional and temporary

2. **PR 3 Phase (Generator Only):** Once `MessageHandler` is proven stable:
   - Remove callback-based state updates from hooks
   - Hooks remain only for side effects (event relay, file notifications)
   - Generator yields are now the single source of truth for tool state

3. **Testing Considerations:**
   - Existing tests using `mockQuery` callbacks will continue to work during PR 2
   - PR 3 adds generator-based assertions; tests can use either approach
   - PR 4/5 migrates remaining tests to generator approach and removes callback support

**Verification:** `pnpm test:agents` - all tests pass with new message sequence.

### PR 4: Remove Hook-Based State Updates
**Goal:** Single source of truth for tool state.

1. Remove `appendToolResult` calls from hooks in `shared.ts`
2. Remove any duplicate state update logic
3. Hooks now only handle side effects (event relay, file change notification)

**Verification:** `pnpm test:agents && pnpm test:integration` - all tests pass, no duplicate state updates.

### PR 5: Cleanup
**Goal:** Remove dead code and finalize.

1. Remove unused `appendToolResult` function if no longer needed
2. Remove migration logging added in PR 2
3. Update documentation if needed

## Phase 7: Testing

### MessageHandler Unit Tests

**File: `agents/src/runners/message-handler.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageHandler } from "./message-handler.js";
import * as output from "../output.js";
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

describe("MessageHandler", () => {
  let handler: MessageHandler;

  beforeEach(() => {
    handler = new MessageHandler();
    vi.spyOn(output, "markToolRunning");
    vi.spyOn(output, "markToolComplete");
    vi.spyOn(output, "complete");
    vi.spyOn(output, "appendAssistantMessage");
  });

  describe("handleAssistant", () => {
    it("marks tool_use blocks as running", () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tool-123", name: "Read", input: {} },
          ],
        },
        parent_tool_use_id: null,
        uuid: "uuid-assistant-1",
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.markToolRunning).toHaveBeenCalledWith("tool-123", "Read");
    });

    it("appends assistant message to thread", () => {
      const msg: SDKAssistantMessage = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
        parent_tool_use_id: null,
        uuid: "uuid-assistant-2",
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.appendAssistantMessage).toHaveBeenCalled();
    });
  });

  describe("handleUser", () => {
    it("marks tool as complete with result", () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: { role: "user", content: [] },
        parent_tool_use_id: "tool-123",
        tool_use_result: "file contents here",
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.markToolComplete).toHaveBeenCalledWith(
        "tool-123",
        "file contents here",
        false
      );
    });

    it("detects error from tool_use_result", () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: { role: "user", content: [] },
        parent_tool_use_id: "tool-123",
        tool_use_result: { is_error: true, message: "File not found" },
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.markToolComplete).toHaveBeenCalledWith(
        "tool-123",
        expect.any(String),
        true
      );
    });

    it("ignores non-tool user messages", () => {
      const msg: SDKUserMessage = {
        type: "user",
        message: { role: "user", content: "Hello" },
        parent_tool_use_id: null,  // Explicit null for non-tool user messages
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.markToolComplete).not.toHaveBeenCalled();
    });
  });

  describe("handleResult", () => {
    it("calls complete on success", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_api_ms: 1500,
        total_cost_usd: 0.05,
        num_turns: 3,
        result: "Task completed successfully",
        uuid: "uuid-result-1",
        session_id: "session-test-1",
        usage: { input_tokens: 100, output_tokens: 50 },
        modelUsage: {},
        permission_denials: [],
      };

      const shouldContinue = handler.handle(msg);

      expect(output.complete).toHaveBeenCalledWith({
        durationApiMs: 1500,
        totalCostUsd: 0.05,
        numTurns: 3,
      });
      expect(shouldContinue).toBe(false);
    });

    it("does not call complete on error", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        error_message: "Tool failed",
        uuid: "uuid-result-2",
        session_id: "session-test-1",
      };

      handler.handle(msg);

      expect(output.complete).not.toHaveBeenCalled();
    });
  });
});
```

### Integration Tests

**File: `agents/src/runners/message-handler.integration.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { runTestAgent } from "../testing/test-harness.js";

describe("MessageHandler Integration", () => {
  it("tracks tool state through full agent loop", async () => {
    const result = await runTestAgent({
      prompt: "Read the file /tmp/test.txt",
      mockResponses: [
        {
          content: [
            { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/test.txt" } },
          ],
        },
      ],
    });

    // Verify tool states transitioned correctly
    const states = result.output.states;
    const toolStates = states.flatMap((s) => Object.values(s.state.toolStates ?? {}));

    // Should have at least one running and one complete state
    expect(toolStates.some((s) => s.status === "running")).toBe(true);
    expect(toolStates.some((s) => s.status === "complete")).toBe(true);

    // Verify toolName is populated
    expect(toolStates.every((s) => s.toolName === "Read")).toBe(true);
  });

  it("handles multiple tools in sequence", async () => {
    const result = await runTestAgent({
      prompt: "Read then write",
      mockResponses: [
        {
          content: [
            { type: "tool_use", id: "t1", name: "Read", input: {} },
            { type: "tool_use", id: "t2", name: "Write", input: {} },
          ],
        },
      ],
    });

    result.assert
      .usedTools(["Read", "Write"])
      .succeeded();
  });

  it("marks tool as error on failure", async () => {
    const result = await runTestAgent({
      prompt: "Read nonexistent file",
      mockResponses: [
        {
          content: [
            { type: "tool_use", id: "t1", name: "Read", input: { path: "/nonexistent" } },
          ],
        },
      ],
      mockToolErrors: {
        t1: "File not found",
      },
    });

    const finalState = result.output.states.at(-1)?.state.toolStates?.["t1"];
    expect(finalState?.status).toBe("error");
    expect(finalState?.isError).toBe(true);
  });
});
```

### Edge Case Tests

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageHandler } from "./message-handler.js";
import * as output from "../output.js";
import { logger } from "../lib/logger.js";
import type { SDKUserMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

describe("MessageHandler Edge Cases", () => {
  beforeEach(() => {
    vi.spyOn(output, "markToolComplete");
  });

  it("handles user message arriving before assistant message (logs warning)", () => {
    // This shouldn't happen with real SDK, but test defensive behavior
    const handler = new MessageHandler();
    const warnSpy = vi.spyOn(logger, "warn");

    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: [] },
      parent_tool_use_id: "orphan-tool",
      tool_use_result: "result",
      session_id: "session-edge-1",
    };
    handler.handle(msg);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("toolName missing")
    );
  });

  it("handles empty tool result", () => {
    const handler = new MessageHandler();

    const msg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: [] },
      parent_tool_use_id: "t1",
      tool_use_result: "",
      session_id: "session-edge-2",
    };
    handler.handle(msg);

    expect(output.markToolComplete).toHaveBeenCalledWith("t1", "", false);
  });

  it("handles result message with unknown subtype", () => {
    const handler = new MessageHandler();

    const msg: SDKResultMessage = {
      type: "result",
      subtype: "unknown_future_subtype" as any,
      is_error: false,
      uuid: "uuid-edge-result",
      session_id: "session-edge-3",
    };

    // Should not throw, should handle gracefully
    expect(() => handler.handle(msg)).not.toThrow();
  });
});
```

## Open Questions (Resolved)

1. ~~Does `SDKUserMessage` always fire after `PostToolUse` hook?~~
   **Yes** - SDK processes hooks during tool execution, then emits user message with result.

2. ~~Should we keep `appendToolResult` in hooks as fallback?~~
   **No** - Single source of truth is cleaner. Message processing is guaranteed.

3. ~~How to detect errors from `SDKUserMessage`?~~
   **Use `tool_use_result.is_error` or check `tool_result` block in message content.**