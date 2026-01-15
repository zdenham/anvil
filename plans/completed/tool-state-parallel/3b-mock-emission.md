# Stream 3B: Mock Message Emission

**Depends on:** Stream 2C (mock types)
**Blocks:** Stream 4 (integration)
**Parallel with:** Stream 3A

## Goal

Update mock query to emit `SDKUserMessage` after tool execution, matching real SDK message sequence.

## File to Modify

`agents/src/testing/mock-query.ts`

## Current vs Target

### Current (broken)
```
assistant message → (tools execute internally) → result message
```

### Target (matches SDK)
```
assistant message → user message (per tool) → result message
```

## Implementation

```typescript
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

export async function* mockQuery(
  options: MockQueryOptions
): AsyncGenerator<SDKMessage> {
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
        const toolResult = await executeToolMock(block.name, block.input);
        const isError = toolResult.isError ?? false;

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

        const userMsg: SDKUserMessage = {
          type: "user",
          message: userMessageParam,
          parent_tool_use_id: block.id,
          tool_use_result: toolResult.content,
          session_id: sessionId,
        };
        yield userMsg;

        // Still call hooks for side effects
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

  // 3. Yield result message
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
```

## Key Changes

1. Yield `SDKUserMessage` after each tool execution
2. Include `parent_tool_use_id` linking to the tool_use block
3. Include `tool_use_result` with the tool output
4. Build proper `MessageParam` structure with `ToolResultBlockParam`
5. Maintain hook calls for side effects (event relay, file changes)

## Error Handling

When tools fail, yield error result:

```typescript
if (hasToolErrors) {
  const errorResultMsg: SDKResultMessage = {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    error_message: toolErrors.join("; "),
    uuid: `mock-uuid-result-${Date.now()}`,
    session_id: sessionId,
  };
  yield errorResultMsg;
}
```

## Verification

```bash
pnpm typecheck
pnpm test:agents
```

Tests should now receive proper message sequence through the mock.
