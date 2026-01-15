# Stream 4: Integration

**Depends on:** Streams 3A (MessageHandler), 3B (mock emission), 2B (assertions)
**Blocks:** Nothing (final stream)
**Parallel with:** Nothing

## Goal

Wire MessageHandler into agent loop and remove hook-based state tracking.

## Files to Modify

1. `agents/src/runners/shared.ts`

## Implementation

### Update shared.ts

```typescript
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MessageHandler } from "./message-handler.js";
import { mockQuery } from "../testing/mock-query.js";
import { relayEventsFromToolOutput } from "../output.js";
import { logger } from "../lib/logger.js";

export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
  // ... init state, build system prompt ...

  // Hooks for SIDE EFFECTS ONLY (no state tracking)
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

          // NOTE: Tool state tracking moved to MessageHandler
          return { continue: true };
        }
      ]
    }],
    PostToolUseFailure: [{
      hooks: [
        async (hookInput: PostToolUseFailureHookInput) => {
          logger.debug(`[PostToolUseFailure] ${hookInput.tool_name}: ${hookInput.error}`);
          // NOTE: Error state tracking moved to MessageHandler
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

### Remove Dead Code

1. Remove `appendToolResult` calls from hooks
2. Remove any duplicate state update logic
3. If `appendToolResult` function is now unused, remove it from `output.ts`

## Integration Tests

Create `agents/src/runners/message-handler.integration.test.ts`:

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

    const states = result.output.states;
    const toolStates = states.flatMap((s) => Object.values(s.state.toolStates ?? {}));

    expect(toolStates.some((s) => s.status === "running")).toBe(true);
    expect(toolStates.some((s) => s.status === "complete")).toBe(true);
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

## Verification

```bash
pnpm typecheck
pnpm test:agents
pnpm test:integration
```

## Manual Testing

Run an agent manually and verify:
1. Tool states transition: running → complete/error
2. UI shows tool completion status
3. No duplicate state emissions
4. Side effects (event relay, file notifications) still work
