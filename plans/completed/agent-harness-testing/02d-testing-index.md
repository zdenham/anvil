# Phase 2d: Testing Index Exports

## Overview

Create the main index file that serves as the public API for the testing framework. This provides a single import path for all testing utilities, ensuring consumers don't need to know the internal file structure.

## Dependencies

- `02a-runner-config.md` (runner configuration exports)
- `02b-agent-harness.md` (harness class and options)
- `02c-assertions.md` (assertion helpers)
- Phase 1 complete (services and types)

## Parallel With

- Nothing (final step for Phase 2)

## Files to Create

### `agents/src/testing/index.ts`

```typescript
// Core harness
export { AgentTestHarness } from "./agent-harness";
export type { AgentTestHarnessOptions } from "./agent-harness";

// Runner configuration
export { defaultRunnerConfig, createRunnerConfig } from "./runner-config";
export type { RunnerConfig } from "./runner-config";

// Assertions
export { AgentAssertions, assertAgent } from "./assertions";

// Types - re-exported from types.ts for convenience
export type {
  // Aggregated test output
  AgentRunOutput,
  // Individual message types (from @core/types/events)
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  StdoutMessage,
  // State types
  ThreadState,
  FileChange,
  // Test configuration
  AgentTestOptions,
} from "./types";

// Re-export services for convenience (from services/index.ts)
export { TestAnvilDirectory, TestRepository } from "./services";
export type {
  TestAnvilDirectoryOptions,
  TestRepositoryOptions,
  FileFixture,
} from "./services";
```

## Design Notes

1. **Single import path**: All testing utilities available from `@/testing` without needing to know internal structure.

2. **Type re-exports**: Types are re-exported here even though they originate from `./types.ts` (which itself re-exports from `@core/types`). This provides a clean API.

3. **Service re-exports**: Services are re-exported from `./services/index.ts` for consumers who want lower-level control without using the full harness.

## Usage After Phase 2

```typescript
import {
  AgentTestHarness,
  assertAgent,
  TestAnvilDirectory,
  TestRepository,
  type AgentRunOutput,
} from "@/testing";

describe("My Agent Tests", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    // Preserve temp directories on failure for debugging
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("should complete successfully", async () => {
    const output: AgentRunOutput = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("thread:created");
  });

  it("should handle errors gracefully", async () => {
    const output = await harness.run({
      prompt: "Trigger an error",
    });

    assertAgent(output)
      .errored((err) => err?.includes("expected error"));
  });
});
```

## Import Paths Summary

After Phase 2, consumers have these import options:

| Import Path | Use Case |
|-------------|----------|
| `@/testing` | Full testing API (recommended) |
| `@/testing/services` | Just test services (for custom setups) |
| `@/testing/types` | Just type definitions |

## Acceptance Criteria

- [ ] All exports compile without errors
- [ ] Single import path (`@/testing`) provides all testing utilities
- [ ] Types are properly exported and usable by consumers
- [ ] No circular dependency issues between modules
- [ ] IDE autocomplete works for all exports

## Estimated Effort

Small (~15 mins)
