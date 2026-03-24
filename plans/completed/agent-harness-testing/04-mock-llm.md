# Phase 4: Mock LLM Support (Optional)

## Overview

Add mock LLM support to enable deterministic agent tests without API calls. This allows testing agent logic, tool orchestration, and state management independently of actual LLM behavior.

## Dependencies

- Phase 2b complete (AgentTestHarness)
- Phase 3 complete (tests working)

## Status

**Optional** - Not required for v1. Implement when deterministic testing is needed for:
- CI pipelines where API calls are impractical
- Testing specific tool call sequences
- Validating error handling paths
- Performance benchmarking without network latency

## Architecture

The mock system intercepts the Claude SDK at the client level, replacing API calls with scripted responses while preserving the rest of the agent runner logic (hooks, validators, state management).

```
┌──────────────────────────────────────────────────────────┐
│                      Agent Runner                         │
├──────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │  Mock Detection │───▶│ ANVIL_MOCK_LLM_PATH set?     │  │
│  └─────────────────┘    └─────────────────────────────┘  │
│           │                        │                      │
│           ▼                        ▼                      │
│  ┌─────────────────┐    ┌─────────────────────────────┐  │
│  │ MockClaudeClient│    │    Real Anthropic SDK       │  │
│  │ (scripted)      │    │    (actual API calls)       │  │
│  └─────────────────┘    └─────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Files to Create

### `agents/src/testing/mock-llm.ts`

```typescript
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

/**
 * Environment variable to enable mock LLM mode.
 * When set to a file path, agent uses scripted responses instead of Claude API.
 */
export const MOCK_LLM_VAR = "ANVIL_MOCK_LLM_PATH";

/**
 * Mock response script format.
 * Responses are consumed in order; exhausting the script throws an error.
 */
export interface MockScript {
  responses: MockResponse[];
}

export interface MockResponse {
  /** Text content to return */
  content?: string;
  /** Tool calls to make (executed before content response) */
  toolCalls?: MockToolCall[];
  /** Simulate an error response */
  error?: string;
}

export interface MockToolCall {
  /** Tool name (must match SDK tool names: Read, Write, Edit, Bash, etc.) */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Optional: specific tool_use ID (auto-generated if omitted) */
  id?: string;
}

/**
 * Create a mock script file for testing.
 * Returns the file path to pass via ANVIL_MOCK_LLM_PATH.
 */
export function createMockScript(script: MockScript): string {
  const path = join(tmpdir(), `mock-llm-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(script, null, 2));
  logger.debug(`[mock-llm] Created mock script at ${path}`);
  return path;
}

/**
 * Clean up a mock script file after test completion.
 */
export function cleanupMockScript(path: string): void {
  try {
    unlinkSync(path);
    logger.debug(`[mock-llm] Cleaned up mock script at ${path}`);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Helper functions to build common mock scenarios.
 */
export const MockScripts = {
  /** Simple completion with text response */
  simpleResponse(text: string): MockScript {
    return {
      responses: [{ content: text }],
    };
  },

  /** Read a file then respond with analysis */
  readAndRespond(filePath: string, response: string): MockScript {
    return {
      responses: [
        { toolCalls: [{ name: "Read", input: { file_path: filePath } }] },
        { content: response },
      ],
    };
  },

  /** Write a file and complete */
  writeFile(filePath: string, content: string): MockScript {
    return {
      responses: [
        {
          toolCalls: [
            { name: "Write", input: { file_path: filePath, content } },
          ],
        },
        { content: "File written successfully." },
      ],
    };
  },

  /** Multi-step workflow: read, edit, respond */
  readEditRespond(
    readPath: string,
    editPath: string,
    oldString: string,
    newString: string,
    response: string
  ): MockScript {
    return {
      responses: [
        { toolCalls: [{ name: "Read", input: { file_path: readPath } }] },
        {
          toolCalls: [
            {
              name: "Edit",
              input: { file_path: editPath, old_string: oldString, new_string: newString },
            },
          ],
        },
        { content: response },
      ],
    };
  },

  /** Simulate an error from the LLM */
  errorResponse(errorMessage: string): MockScript {
    return {
      responses: [{ error: errorMessage }],
    };
  },
};
```

### `agents/src/testing/mock-claude-client.ts`

```typescript
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import type { MockScript, MockResponse } from "./mock-llm";
import { logger } from "../lib/logger";

/**
 * Mock Claude client that returns scripted responses.
 * Implements the subset of the Anthropic SDK interface used by the runner.
 */
export class MockClaudeClient {
  private responses: MockResponse[];
  private index = 0;
  private scriptPath: string;

  constructor(scriptPath: string) {
    this.scriptPath = scriptPath;
    const script: MockScript = JSON.parse(readFileSync(scriptPath, "utf-8"));
    this.responses = script.responses;
    logger.info(
      `[MockClaudeClient] Loaded ${this.responses.length} scripted responses from ${scriptPath}`
    );
  }

  /**
   * Simulate the messages.create() method.
   * Consumes the next response from the script.
   */
  async createMessage(params: unknown): Promise<MockSDKResponse> {
    if (this.index >= this.responses.length) {
      throw new Error(
        `Mock script exhausted after ${this.index} responses. ` +
          `Script: ${this.scriptPath}`
      );
    }

    const response = this.responses[this.index++];
    logger.debug(
      `[MockClaudeClient] Returning response ${this.index}/${this.responses.length}`
    );

    // Simulate error if specified
    if (response.error) {
      throw new Error(response.error);
    }

    // Build content blocks matching SDK format
    const content: SDKContentBlock[] = [];

    // Add tool_use blocks first (agent executes tools before continuing)
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id ?? `toolu_${randomUUID().slice(0, 8)}`,
          name: tc.name,
          input: tc.input,
        });
      }
    }

    // Add text block if content provided
    if (response.content) {
      content.push({
        type: "text",
        text: response.content,
      });
    }

    return {
      id: `msg_${randomUUID().slice(0, 8)}`,
      type: "message",
      role: "assistant",
      content,
      model: "mock-model",
      stop_reason: response.toolCalls?.length ? "tool_use" : "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  /**
   * Check if all scripted responses have been consumed.
   * Useful for test assertions.
   */
  isExhausted(): boolean {
    return this.index >= this.responses.length;
  }

  /**
   * Get count of remaining responses.
   */
  remainingResponses(): number {
    return this.responses.length - this.index;
  }
}

// SDK response type definitions (subset of actual SDK types)
interface SDKContentBlock {
  type: "text" | "tool_use";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

interface MockSDKResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: SDKContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}
```

### Runner Modifications

Modify `agents/src/runner.ts` to detect and use mock mode.

**Note**: This requires modifying how the runner interfaces with the Claude SDK. The actual implementation depends on the claude-agent-sdk API. Below is the conceptual approach:

```typescript
// At the top of runner.ts, add import:
import { MOCK_LLM_VAR } from "./testing/mock-llm.js";
import { MockClaudeClient } from "./testing/mock-claude-client.js";

// Before calling query(), check for mock mode:
const mockScriptPath = process.env[MOCK_LLM_VAR];
if (mockScriptPath) {
  logger.info(`[runner] Mock LLM mode enabled: ${mockScriptPath}`);
  // Implementation depends on SDK architecture:
  // Option 1: Pass mock client to SDK options
  // Option 2: Inject mock at SDK level
  // Option 3: Use SDK's built-in test mode if available
}

// The mock client would be used instead of real API calls
```

**Implementation considerations**:
1. The claude-agent-sdk may need to expose a way to inject a custom client
2. Alternatively, mock at the HTTP layer using tools like `nock`
3. If SDK doesn't support injection, consider wrapping the `query()` function

## Usage Example

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { AgentTestHarness } from "../agent-harness";
import {
  createMockScript,
  cleanupMockScript,
  MockScripts,
  MOCK_LLM_VAR,
} from "../mock-llm";
import { assertAgent } from "../assertions";

describe("Agent with Mock LLM", () => {
  let scriptPath: string;

  afterEach(() => {
    if (scriptPath) {
      cleanupMockScript(scriptPath);
    }
  });

  it("returns deterministic response", async () => {
    scriptPath = createMockScript(MockScripts.simpleResponse("Hello, world!"));

    const harness = new AgentTestHarness({
      agent: "simple",
      env: { [MOCK_LLM_VAR]: scriptPath },
    });

    const output = await harness.run({
      prompt: "Say hello",
    });

    // Response is deterministic - same script always produces same output
    assertAgent(output)
      .succeeded()
      .finalState((s) =>
        s.messages.some((m) => m.content?.includes("Hello, world!"))
      );

    harness.cleanup();
  });

  it("executes scripted tool calls", async () => {
    scriptPath = createMockScript(
      MockScripts.readAndRespond("/tmp/test.txt", "File contains test data.")
    );

    const harness = new AgentTestHarness({
      agent: "simple",
      env: { [MOCK_LLM_VAR]: scriptPath },
    });

    const output = await harness.run({
      prompt: "Read the test file",
    });

    // Verify the Read tool was invoked
    assertAgent(output)
      .succeeded()
      .toolWasUsed("Read", { file_path: "/tmp/test.txt" });

    harness.cleanup();
  });

  it("handles LLM errors gracefully", async () => {
    scriptPath = createMockScript(
      MockScripts.errorResponse("Rate limit exceeded")
    );

    const harness = new AgentTestHarness({
      agent: "simple",
      env: { [MOCK_LLM_VAR]: scriptPath },
    });

    const output = await harness.run({
      prompt: "This will fail",
    });

    expect(output.exitCode).not.toBe(0);
    expect(output.stderr).toContain("Rate limit exceeded");

    harness.cleanup();
  });
});
```

## Benefits

1. **Deterministic** - Same script always produces identical output
2. **Fast** - No network latency or API round-trips
3. **Free** - No API costs during test runs
4. **Isolated** - Tests don't depend on API availability or rate limits
5. **Debuggable** - Script responses can be inspected and modified easily
6. **CI-friendly** - No API keys required in CI environment

## Limitations

1. **Not testing real LLM behavior** - Mocks don't validate actual model responses
2. **Script maintenance** - Scripts must be updated when expected behavior changes
3. **Partial coverage** - Complex multi-turn conversations are tedious to script
4. **SDK coupling** - Implementation depends on SDK's client injection support

## When to Use Real vs Mock LLM

| Scenario | Use Mock | Use Real |
|----------|----------|----------|
| Testing tool orchestration | Yes | No |
| Validating agent state management | Yes | No |
| Testing error handling paths | Yes | No |
| Verifying prompt effectiveness | No | Yes |
| Testing LLM response quality | No | Yes |
| CI pipeline smoke tests | Yes | No |
| End-to-end acceptance tests | No | Yes |

## Acceptance Criteria

- [ ] `MockScript` interface supports text, tool calls, and errors
- [ ] `MockClaudeClient` implements required SDK interface subset
- [ ] `createMockScript()` creates valid script files
- [ ] `cleanupMockScript()` removes script files
- [ ] `MockScripts` helpers cover common scenarios
- [ ] Runner detects `ANVIL_MOCK_LLM_PATH` and switches to mock mode
- [ ] Tests can run with mock scripts without API calls
- [ ] Mock client tracks consumption state (exhausted, remaining)

## Estimated Effort

Medium (~3-4 hours)
- Mock script types and helpers: 1 hour
- MockClaudeClient implementation: 1-2 hours
- Runner integration (depends on SDK): 1-2 hours

## Open Questions

1. Does the claude-agent-sdk support client injection or test modes?
2. Should mocks support streaming responses for parity with real SDK?
3. Should there be a recording mode to capture real responses for replay?
