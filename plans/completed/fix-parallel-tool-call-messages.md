# Fix Parallel Tool Call Message Accumulation

**Status: Implemented**

## Problem Summary

When Claude makes parallel tool calls, the Claude Agent SDK emits events that the runner incorrectly stores as separate messages:
- Each `message.type === "assistant"` event → new assistant message (should update existing)
- Each `appendToolResult()` call → new user message (should accumulate into one)

This breaks `deriveToolStatesFromThread` which expects the standard SDK format where:
- One assistant message contains ALL tool_use blocks from a single turn
- One user message contains ALL tool_result blocks responding to those tools

### Symptom

Bash commands (and other tools) show as "failed" in the UI with a red X icon, even though they executed successfully. The tool results exist but can't be matched to their tool_use blocks.

## Root Cause

1. **`output.ts:appendAssistantMessage`** always `push()`es a new message
2. **`output.ts:appendToolResult`** always `push()`es a new user message
3. **`runner.ts:491-498`** calls `appendAssistantMessage` on every "assistant" event

When the SDK streams parallel tool execution, multiple events create multiple messages instead of accumulating into one.

### Current (broken) message structure:
```
assistant: { content: [tool_use A] }
assistant: { content: [tool_use B] }
assistant: { content: [tool_use C] }
user: { content: [tool_result A] }
user: { content: [tool_result B] }
user: { content: [tool_result C] }
```

### Expected SDK format:
```
assistant: { content: [tool_use A, tool_use B, tool_use C] }
user: { content: [tool_result A, tool_result B, tool_result C] }
```

## Fix Approach

Fix message accumulation in `output.ts`:

1. **`appendAssistantMessage`**: If the last message is an assistant message, **replace** it (streaming update). Otherwise push (new turn).

2. **`appendToolResult`**: If the last message is a user message containing only tool_results, **append** to its content array. Otherwise create new message.

No changes needed to `tool-state.ts` - it already looks at the next user message, which will now contain all accumulated tool_results.

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/output.ts` | Fix `appendAssistantMessage` and `appendToolResult` to accumulate |

## Implementation Details

### `agents/src/output.ts` changes

```typescript
/**
 * Append an assistant message to the thread.
 * If the last message is also an assistant message, replace it (streaming update).
 * Otherwise push as a new message (new turn).
 */
export function appendAssistantMessage(message: MessageParam): void {
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "assistant") {
    // Replace - this is a streaming update for the same turn
    state.messages[state.messages.length - 1] = message;
  } else {
    // New turn
    state.messages.push(message);
  }
  emitState();
}

/**
 * Append a tool result as a user message (SDK format).
 * Accumulates into the last user message if it only contains tool_results.
 */
export function appendToolResult(
  toolUseId: string,
  content: string,
  isError?: boolean
): void {
  // Log tool results for debugging skill failures
  if (isError) {
    console.error(`[output] Tool result ERROR for ${toolUseId}: ${content.slice(0, 500)}`);
  } else {
    console.error(`[output] Tool result OK for ${toolUseId} (${content.length} chars)`);
  }

  const toolResultBlock = {
    type: "tool_result" as const,
    tool_use_id: toolUseId,
    content,
    ...(isError && { is_error: isError }),
  };

  const lastMsg = state.messages[state.messages.length - 1];

  // Check if last message is a user message with only tool_results
  if (
    lastMsg?.role === "user" &&
    Array.isArray(lastMsg.content) &&
    lastMsg.content.length > 0 &&
    lastMsg.content.every((b: any) => b.type === "tool_result")
  ) {
    // Append to existing tool_result message
    (lastMsg.content as any[]).push(toolResultBlock);
  } else {
    // Create new message
    state.messages.push({
      role: "user",
      content: [toolResultBlock],
    });
  }
  emitState();
}
```

## Testing

1. Run an agent that makes parallel tool calls (e.g., multiple Glob/Grep searches)
2. Verify tools show as "complete" (green checkmark) not "failed" (red X)
3. Verify the state.json has properly accumulated messages
4. Test single tool calls still work correctly
5. Test error cases (tool that actually fails) still show as failed

---

## Implementation Notes

**Implemented on 2025-12-28**

### Refinements from plan review:

1. **SDK behavior verified**: The SDK sends complete accumulated messages on each "assistant" event, so replacing (not merging) is the correct approach for `appendAssistantMessage`.

2. **Type safety improved**: Used a boolean check pattern instead of type predicates to avoid TS2677 errors.

3. **Enhanced logging**: Added batch size to tool result logs for easier debugging.

### Files modified:
- `agents/src/output.ts` - Fixed `appendAssistantMessage` and `appendToolResult`
