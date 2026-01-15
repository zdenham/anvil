# Phase 2c: Assertion Helpers

## Overview

Create fluent assertion helpers for validating agent test output. These assertions provide a chainable API for verifying events, state, file changes, tool usage, and timing.

## Dependencies

- `01a-test-types.md` (defines `AgentRunOutput` and related types)

## Parallel With

- `02a-runner-config.md` (no shared dependencies)
- `02b-agent-harness.md` (no shared dependencies)

## Files to Create

### `agents/src/testing/assertions.ts`

```typescript
import type {
  AgentRunOutput,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  ThreadState,
  FileChange,
} from "./types";

export class AgentAssertions {
  constructor(private output: AgentRunOutput) {}

  /**
   * Assert that a specific event was emitted.
   * Optionally validate the event payload with a predicate.
   */
  hasEvent(name: string, predicate?: (payload: unknown) => boolean): this {
    const event = this.output.events.find((e) => e.name === name);
    if (!event) {
      throw new Error(
        `Expected event "${name}" not found. Emitted events: [${this.output.events.map((e) => e.name).join(", ")}]`
      );
    }
    if (predicate && !predicate(event.payload)) {
      throw new Error(
        `Event "${name}" found but payload predicate failed. Payload: ${JSON.stringify(event.payload)}`
      );
    }
    return this;
  }

  /**
   * Assert that no event with the given name was emitted.
   */
  hasNoEvent(name: string): this {
    const event = this.output.events.find((e) => e.name === name);
    if (event) {
      throw new Error(
        `Expected no event "${name}" but it was emitted with payload: ${JSON.stringify(event.payload)}`
      );
    }
    return this;
  }

  /**
   * Assert events were emitted in the specified order.
   * Events may have other events between them; this checks relative ordering.
   */
  hasEventsInOrder(names: string[]): this {
    const eventNames = this.output.events.map((e) => e.name);
    let lastIndex = -1;
    for (const name of names) {
      const index = eventNames.indexOf(name, lastIndex + 1);
      if (index === -1) {
        throw new Error(
          `Event "${name}" not found after position ${lastIndex}. ` +
            `Event sequence: [${eventNames.join(", ")}]`
        );
      }
      lastIndex = index;
    }
    return this;
  }

  /**
   * Assert final state matches the provided predicate.
   */
  finalState(predicate: (state: ThreadState) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState) {
      throw new Error("No state messages received during agent run");
    }
    if (!predicate(lastState.state)) {
      throw new Error(
        `Final state predicate failed. State: ${JSON.stringify(lastState.state)}`
      );
    }
    return this;
  }

  /**
   * Assert agent exited with code 0 (success).
   */
  succeeded(): this {
    if (this.output.exitCode !== 0) {
      throw new Error(
        `Expected exit code 0, got ${this.output.exitCode}. Stderr: ${this.output.stderr || "(empty)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent failed with a non-zero exit code.
   */
  failed(): this {
    if (this.output.exitCode === 0) {
      throw new Error("Expected non-zero exit code, but agent succeeded");
    }
    return this;
  }

  /**
   * Assert final state has error status.
   * Optionally validate the error message with a predicate.
   */
  errored(errorPredicate?: (error: string | undefined) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState || lastState.state.status !== "error") {
      throw new Error(
        `Expected error status, got: ${lastState?.state.status ?? "no state received"}`
      );
    }
    if (errorPredicate && !errorPredicate(lastState.state.error)) {
      throw new Error(
        `Error predicate failed. Error message: ${lastState.state.error ?? "(undefined)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent was killed due to timeout.
   * Expects exit code -1 and timeout message in stderr.
   */
  timedOut(): this {
    if (this.output.exitCode !== -1) {
      throw new Error(
        `Expected timeout (exit code -1), got: ${this.output.exitCode}`
      );
    }
    if (!this.output.stderr.includes("[Killed: timeout")) {
      throw new Error(
        `Expected timeout message in stderr. Stderr: ${this.output.stderr || "(empty)"}`
      );
    }
    return this;
  }

  /**
   * Assert agent made file changes in its final state.
   * Optionally validate the changes with a predicate.
   */
  hasFileChanges(predicate?: (changes: FileChange[]) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    const changes = lastState?.state.fileChanges ?? [];
    if (changes.length === 0) {
      throw new Error("Expected file changes but none were found in final state");
    }
    if (predicate && !predicate(changes)) {
      throw new Error(
        `File changes predicate failed. Changes: ${JSON.stringify(changes)}`
      );
    }
    return this;
  }

  /**
   * Assert agent made no file changes.
   */
  hasNoFileChanges(): this {
    const lastState = this.output.states[this.output.states.length - 1];
    const changes = lastState?.state.fileChanges ?? [];
    if (changes.length > 0) {
      throw new Error(
        `Expected no file changes but found: ${JSON.stringify(changes)}`
      );
    }
    return this;
  }

  /**
   * Assert agent used all of the specified tools.
   * Checks tool names across all state snapshots.
   */
  usedTools(toolNames: string[]): this {
    const usedToolNames = new Set<string>();
    for (const state of this.output.states) {
      for (const toolName of Object.keys(state.state.toolStates ?? {})) {
        usedToolNames.add(toolName);
      }
    }
    const missing = toolNames.filter((name) => !usedToolNames.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Tools not used: [${missing.join(", ")}]. Used tools: [${[...usedToolNames].join(", ")}]`
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
      for (const toolName of Object.keys(state.state.toolStates ?? {})) {
        usedToolNames.add(toolName);
      }
    }
    const found = toolNames.filter((name) => usedToolNames.has(name));
    if (found.length > 0) {
      throw new Error(`Expected tools not to be used but found: [${found.join(", ")}]`);
    }
    return this;
  }

  /**
   * Assert a log message exists at the specified level.
   * Optionally match the message content with a regex pattern.
   */
  hasLog(
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    messagePattern?: RegExp
  ): this {
    const log = this.output.logs.find((l) => {
      if (l.level !== level) return false;
      if (messagePattern && !messagePattern.test(l.message)) return false;
      return true;
    });
    if (!log) {
      const patternDesc = messagePattern ? ` matching ${messagePattern}` : "";
      throw new Error(
        `Expected ${level} log${patternDesc} not found. ` +
          `Log count by level: DEBUG=${this.countLogs("DEBUG")}, ` +
          `INFO=${this.countLogs("INFO")}, WARN=${this.countLogs("WARN")}, ` +
          `ERROR=${this.countLogs("ERROR")}`
      );
    }
    return this;
  }

  /**
   * Assert no error-level logs were emitted.
   */
  hasNoErrorLogs(): this {
    const errorLogs = this.output.logs.filter((l) => l.level === "ERROR");
    if (errorLogs.length > 0) {
      throw new Error(
        `Expected no error logs but found ${errorLogs.length}: ` +
          errorLogs.map((l) => l.message).join("; ")
      );
    }
    return this;
  }

  /**
   * Assert agent completed within the specified duration.
   */
  completedWithin(maxMs: number): this {
    if (this.output.durationMs > maxMs) {
      throw new Error(
        `Expected completion within ${maxMs}ms, took ${this.output.durationMs}ms`
      );
    }
    return this;
  }

  /**
   * Get the raw output for custom assertions.
   */
  getOutput(): AgentRunOutput {
    return this.output;
  }

  private countLogs(level: string): number {
    return this.output.logs.filter((l) => l.level === level).length;
  }
}

/**
 * Create fluent assertions for agent test output.
 *
 * @example
 * assertAgent(output)
 *   .succeeded()
 *   .hasEvent("thread:created")
 *   .completedWithin(30000);
 */
export function assertAgent(output: AgentRunOutput): AgentAssertions {
  return new AgentAssertions(output);
}
```

## Assertion Methods

| Method                         | Description                                          |
| ------------------------------ | ---------------------------------------------------- |
| `hasEvent(name, predicate?)`   | Event was emitted, optionally matching predicate     |
| `hasNoEvent(name)`             | Event was not emitted                                |
| `hasEventsInOrder(names)`      | Events appeared in specified order                   |
| `finalState(predicate)`        | Final state matches predicate                        |
| `succeeded()`                  | Exit code was 0                                      |
| `failed()`                     | Exit code was non-zero                               |
| `errored(predicate?)`          | Final state has error status                         |
| `timedOut()`                   | Agent was killed by timeout                          |
| `hasFileChanges(predicate?)`   | File changes exist in final state                    |
| `hasNoFileChanges()`           | No file changes in final state                       |
| `usedTools(names)`             | All specified tools were used                        |
| `didNotUseTools(names)`        | None of the specified tools were used                |
| `hasLog(level, pattern?)`      | Log exists at level, optionally matching pattern     |
| `hasNoErrorLogs()`             | No error-level logs emitted                          |
| `completedWithin(ms)`          | Duration under threshold                             |
| `getOutput()`                  | Access raw output for custom assertions              |

## Usage Examples

```typescript
// Basic success assertion
assertAgent(output).succeeded();

// Event verification
assertAgent(output)
  .hasEvent("thread:created")
  .hasNoEvent("thread:error")
  .hasEventsInOrder(["thread:created", "thread:status:changed"]);

// State verification
assertAgent(output)
  .finalState((s) => s.status === "complete")
  .hasFileChanges((changes) => changes.some((c) => c.path === "README.md"));

// Error handling
assertAgent(output).errored((err) => err?.includes("rate limit"));

// Negative assertions
assertAgent(output)
  .hasNoErrorLogs()
  .hasNoFileChanges()
  .didNotUseTools(["Write", "Edit"]);

// Full chain for comprehensive verification
assertAgent(output)
  .succeeded()
  .hasEvent("thread:created")
  .hasEventsInOrder(["thread:created", "thread:status:changed"])
  .finalState((s) => s.status === "complete")
  .usedTools(["Read", "Write"])
  .hasNoErrorLogs()
  .completedWithin(30000);

// Access raw output for custom assertions
const rawOutput = assertAgent(output).succeeded().getOutput();
expect(rawOutput.events.length).toBeGreaterThan(5);
```

## Design Decisions

1. **Fluent chaining**: All assertions return `this` to enable method chaining for readable test code.

2. **Descriptive error messages**: Each assertion includes context about what was expected vs. what was found to aid debugging.

3. **Negative assertions**: Methods like `hasNoEvent()`, `hasNoFileChanges()`, and `didNotUseTools()` enable testing that certain behaviors did NOT occur.

4. **Raw output access**: The `getOutput()` method allows escaping to custom assertions when the fluent API is insufficient.

5. **Log level counting**: The `hasLog()` error message includes log counts by level to help diagnose missing logs.

## Acceptance Criteria

- [ ] All assertion methods throw descriptive errors on failure
- [ ] Fluent chaining works correctly (each method returns `this`)
- [ ] Error messages include relevant context (expected vs. actual values)
- [ ] Predicates receive correct values and their failures are clearly reported
- [ ] Negative assertions (`hasNo*`, `didNotUse*`) work correctly
- [ ] `getOutput()` returns the original output object

## Estimated Effort

Medium (~1-2 hours)
