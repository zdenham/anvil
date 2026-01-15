# Phase 3b: Agent Acceptance Tests

## Overview

Create acceptance tests that validate real agent behavior using the harness framework. These tests exercise actual agent execution against the Anthropic API, verifying event emissions, state transitions, and tool usage patterns.

## Dependencies

- `03a-harness-self-test.md` - Framework must be verified first

## Parallel With

- Individual test files can be developed in parallel once started

## Prerequisites

- `ANTHROPIC_API_KEY` environment variable must be set for tests to run
- All tests are automatically skipped when no API key is present
- Expect ~$0.10-0.50 per test run due to API costs

## Files to Create

### `agents/src/testing/__tests__/events.test.ts`

Tests that verify correct event emission from agents.

```typescript
import { describe, it, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent Event Emissions", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("emits thread:created on startup", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("thread:created");
  });

  it("emits thread:status:changed on completion", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEventsInOrder(["thread:created", "thread:status:changed"]);
  });

  it("emits worktree:allocated for task-based agents", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Add a comment to README.md",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("worktree:allocated")
      .hasEvent("worktree:released");
  });
});
```

### `agents/src/testing/__tests__/state.test.ts`

Tests that verify correct state transitions during agent execution.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent State Transitions", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("transitions from running to complete", async () => {
    const output = await harness.run({
      prompt: "List files in the current directory",
    });

    expect(output.states.length).toBeGreaterThan(0);
    expect(output.states[0].state.status).toBe("running");

    assertAgent(output).finalState((s) => s.status === "complete");
  });

  it("includes messages array in state", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .finalState((s) => Array.isArray(s.messages) && s.messages.length > 0);
  });

  it("tracks file modifications in state", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Add a newline to the end of README.md",
    });

    assertAgent(output)
      .succeeded()
      .hasFileChanges((changes) =>
        changes.some(
          (c) => c.path.endsWith("README.md") && c.operation === "modify"
        )
      );
  });
});
```

### `agents/src/testing/__tests__/tools.test.ts`

Tests that verify agents use the correct tools for given tasks.

```typescript
import { describe, it, beforeEach, afterEach } from "vitest";
import { AgentTestHarness, assertAgent } from "../index";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Agent Tool Usage", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("uses Read tool to inspect files", async () => {
    const output = await harness.run({
      prompt: "What does the README say?",
    });

    assertAgent(output).succeeded().usedTools(["Read"]);
  });

  it("uses Bash tool for shell commands", async () => {
    const output = await harness.run({
      prompt: "Run 'ls -la' and tell me what you see",
    });

    assertAgent(output).succeeded().usedTools(["Bash"]);
  });

  it("uses Write tool to create files", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Create a new file called 'test.txt' with the content 'Hello World'",
    });

    assertAgent(output).succeeded().usedTools(["Write"]);
  });
});
```

## Test Organization

| File              | Purpose                      | Key Assertions                   |
| ----------------- | ---------------------------- | -------------------------------- |
| `events.test.ts`  | Event emission verification  | `hasEvent`, `hasEventsInOrder`   |
| `state.test.ts`   | State transition verification| `finalState`, `hasFileChanges`   |
| `tools.test.ts`   | Tool usage verification      | `usedTools`                      |

## Running Tests

```bash
# Run all agent acceptance tests
pnpm --filter agents test:harness

# Run specific test file
pnpm --filter agents test -- src/testing/__tests__/events.test.ts

# With debug output (shows agent stdout/stderr)
DEBUG=1 pnpm --filter agents test:harness

# Preserve temp directories on failure for debugging
KEEP_TEMP=1 pnpm --filter agents test:harness

# Combine flags for debugging failed tests
DEBUG=1 KEEP_TEMP=1 pnpm --filter agents test:harness
```

## Environment Variables

| Variable           | Required | Description                                      |
| ------------------ | -------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY`| Yes      | API key for live agent tests                     |
| `DEBUG`            | No       | Show agent stdout/stderr during test runs        |
| `KEEP_TEMP`        | No       | Preserve temp directories after test completion  |

## Notes on Test Reliability

These tests make real API calls and depend on LLM behavior, which introduces some inherent non-determinism:

- **Prompts are designed to be unambiguous** - Tasks are simple and direct to minimize variance
- **Tests verify behavior patterns, not exact output** - We check that the right tools were used, not the exact response
- **Flakiness should be investigated** - If a test fails intermittently, the prompt may need refinement or the assertion may be too strict

## Acceptance Criteria

- [ ] All three test files exist and are syntactically valid
- [ ] Event emission tests pass consistently
- [ ] State transition tests pass consistently
- [ ] Tool usage tests pass consistently
- [ ] Tests skip gracefully without `ANTHROPIC_API_KEY`
- [ ] Failed tests preserve temp directories when `KEEP_TEMP=1`
- [ ] Debug output works correctly when `DEBUG=1`

## Estimated Effort

Medium (~2-3 hours)

- Test implementation: ~1-2 hours
- Prompt tuning and reliability testing: ~1 hour
