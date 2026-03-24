# Phase 3a: Harness Self-Verification Tests

## Overview

Create tests that validate the testing framework itself before running actual agent tests. These "meta-tests" ensure the harness infrastructure works correctly, providing confidence that failures in agent tests reflect actual agent issues rather than harness bugs.

## Dependencies

- Phase 2 complete (core harness: `02a-runner-config.md`, `02b-agent-harness.md`, `02c-assertions.md`)

## Parallel With

- Nothing (must pass before Phase 3b agent acceptance tests)

## Rationale

Self-verification tests serve as a critical foundation layer:

1. **Trust the test infrastructure** - If harness tests fail, we know to fix the framework before debugging agents
2. **Fast feedback** - Most tests run without API calls, enabling quick iteration
3. **Documentation by example** - Tests demonstrate correct usage of harness APIs

## Files to Create

### `agents/src/testing/__tests__/harness-self-test.ts`

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import { AgentTestHarness } from "../agent-harness";
import { assertAgent } from "../assertions";
import { TestAnvilDirectory } from "../services/test-anvil-directory";
import { TestRepository } from "../services/test-repository";
import type { AgentOutput } from "../types";

/**
 * Skip tests that require API access when no key is present.
 */
const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describe("AgentTestHarness Self-Verification", () => {
  describe("TestAnvilDirectory service", () => {
    let anvilDir: TestAnvilDirectory;

    afterEach(() => {
      anvilDir?.cleanup();
    });

    it("creates directory structure on init", () => {
      anvilDir = new TestAnvilDirectory().init();

      expect(existsSync(anvilDir.path)).toBe(true);
      expect(existsSync(`${anvilDir.path}/repositories`)).toBe(true);
      expect(existsSync(`${anvilDir.path}/tasks`)).toBe(true);
      expect(existsSync(`${anvilDir.path}/config.json`)).toBe(true);
    });

    it("removes directory on cleanup", () => {
      anvilDir = new TestAnvilDirectory().init();
      const savedPath = anvilDir.path;

      anvilDir.cleanup();
      expect(existsSync(savedPath)).toBe(false);
    });

    it("creates tasks with metadata", () => {
      anvilDir = new TestAnvilDirectory().init();
      const task = anvilDir.createTask({
        repositoryName: "test-repo",
        title: "Test Task",
      });

      expect(task.slug).toMatch(/^test-task-/);
      expect(task.repositoryName).toBe("test-repo");
      expect(existsSync(`${anvilDir.path}/tasks/${task.slug}/metadata.json`)).toBe(true);
    });

    it("registers repositories with settings", () => {
      anvilDir = new TestAnvilDirectory().init();
      anvilDir.registerRepository({ name: "my-repo", path: "/tmp/fake" });

      expect(existsSync(`${anvilDir.path}/repositories/my-repo/settings.json`)).toBe(true);
    });
  });

  describe("TestRepository service", () => {
    let repo: TestRepository;

    afterEach(() => {
      repo?.cleanup();
    });

    it("initializes git repository with fixtures", () => {
      repo = new TestRepository({ fixture: "minimal" }).init();

      expect(existsSync(repo.path)).toBe(true);
      expect(existsSync(`${repo.path}/.git`)).toBe(true);
      expect(existsSync(`${repo.path}/README.md`)).toBe(true);

      const log = repo.git("log --oneline");
      expect(log).toContain("Initial commit");
    });

    it("removes directory on cleanup", () => {
      repo = new TestRepository({ fixture: "minimal" }).init();
      const savedPath = repo.path;

      repo.cleanup();
      expect(existsSync(savedPath)).toBe(false);
    });

    it("supports typescript fixture template", () => {
      repo = new TestRepository({ fixture: "typescript" }).init();

      expect(existsSync(`${repo.path}/package.json`)).toBe(true);
      expect(existsSync(`${repo.path}/tsconfig.json`)).toBe(true);
      expect(existsSync(`${repo.path}/src/index.ts`)).toBe(true);
    });

    it("supports adding and committing files", () => {
      repo = new TestRepository({ fixture: "minimal" }).init();

      repo.addFile("new-file.txt", "Hello");
      repo.commit("Add new file");

      const log = repo.git("log --oneline");
      expect(log).toContain("Add new file");
    });
  });

  describe("Harness lifecycle", () => {
    let harness: AgentTestHarness;

    afterEach(() => {
      harness?.cleanup();
    });

    it("exposes tempDirPath after run starts", async () => {
      harness = new AgentTestHarness({
        agent: "simple",
        timeout: 5000,
      });

      expect(harness.tempDirPath).toBeNull();

      // Start run but don't await - we want to inspect tempDirPath immediately
      const runPromise = harness.run({ prompt: "test" });

      // After run() is called, tempDirPath should be set
      expect(harness.tempDirPath).not.toBeNull();
      expect(harness.tempDirPath).toMatch(/anvil-test-/);
      expect(existsSync(harness.tempDirPath!)).toBe(true);

      // Allow run to complete or timeout
      await runPromise.catch(() => {});
    });

    it("removes temp directory on cleanup", async () => {
      harness = new AgentTestHarness({
        agent: "simple",
        timeout: 5000,
      });

      const runPromise = harness.run({ prompt: "test" });
      await runPromise.catch(() => {});

      const tempPath = harness.tempDirPath!;
      harness.cleanup();

      expect(existsSync(tempPath)).toBe(false);
    });
  });

  describe("Assertion helpers", () => {
    it("hasEvent throws on missing events", () => {
      const output: AgentOutput = {
        logs: [],
        events: [{ type: "event", name: "thread:created", payload: {} }],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      expect(() => assertAgent(output).hasEvent("thread:created")).not.toThrow();
      expect(() => assertAgent(output).hasEvent("nonexistent:event")).toThrow(
        /Expected event "nonexistent:event" not found/
      );
    });

    it("hasEventsInOrder validates event ordering", () => {
      const output: AgentOutput = {
        logs: [],
        events: [
          { type: "event", name: "a", payload: {} },
          { type: "event", name: "b", payload: {} },
          { type: "event", name: "c", payload: {} },
        ],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      // Correct order should pass
      expect(() => assertAgent(output).hasEventsInOrder(["a", "b", "c"])).not.toThrow();

      // Subset in order should pass
      expect(() => assertAgent(output).hasEventsInOrder(["a", "c"])).not.toThrow();

      // Wrong order should fail
      expect(() => assertAgent(output).hasEventsInOrder(["c", "a"])).toThrow(
        /Event "a" not found after position/
      );
    });

    it("finalState validates the last state", () => {
      const output: AgentOutput = {
        logs: [],
        events: [],
        states: [
          { type: "state", state: { status: "running", messages: [], fileChanges: [], timestamp: 1 } as any },
          { type: "state", state: { status: "complete", messages: [], fileChanges: [], timestamp: 2 } as any },
        ],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      expect(() => assertAgent(output).finalState(s => s.status === "complete")).not.toThrow();
      expect(() => assertAgent(output).finalState(s => s.status === "error")).toThrow(
        /Final state predicate failed/
      );
    });

    it("succeeded validates exit code", () => {
      const successOutput: AgentOutput = { logs: [], events: [], states: [], exitCode: 0, stderr: "", duration: 100 };
      const failOutput: AgentOutput = { logs: [], events: [], states: [], exitCode: 1, stderr: "error", duration: 100 };

      expect(() => assertAgent(successOutput).succeeded()).not.toThrow();
      expect(() => assertAgent(failOutput).succeeded()).toThrow(
        /Agent exited with code 1/
      );
    });

    it("timedOut validates timeout condition", () => {
      const timeoutOutput: AgentOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: -1,
        stderr: "[Killed: timeout after 5000ms]",
        duration: 5000,
      };
      const normalOutput: AgentOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 1000,
      };

      expect(() => assertAgent(timeoutOutput).timedOut()).not.toThrow();
      expect(() => assertAgent(normalOutput).timedOut()).toThrow(
        /Expected timeout/
      );
    });

    it("supports fluent chaining", () => {
      const output: AgentOutput = {
        logs: [],
        events: [{ type: "event", name: "thread:created", payload: {} }],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      // Chained assertions should all pass
      expect(() =>
        assertAgent(output)
          .succeeded()
          .hasEvent("thread:created")
          .completedWithin(1000)
      ).not.toThrow();
    });
  });

  /**
   * Live agent tests - require API key and make real LLM calls.
   * These validate end-to-end harness behavior with actual agents.
   */
  describeWithApi("Live agent tests (requires ANTHROPIC_API_KEY)", () => {
    let harness: AgentTestHarness;

    afterEach(() => {
      harness?.cleanup();
    });

    it("captures stdout JSON lines correctly", async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        agent: "simple",
        prompt: "Say exactly: Hello",
        timeout: 30000,
      });

      // Should have received at least one state update
      expect(output.states.length).toBeGreaterThan(0);

      // Validate state message structure
      for (const state of output.states) {
        expect(state.type).toBe("state");
        expect(state.state).toBeDefined();
        expect(state.state.status).toMatch(/running|complete|error/);
        expect(Array.isArray(state.state.messages)).toBe(true);
      }
    }, 60000);

    it("handles agent timeout gracefully", async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        agent: "simple",
        prompt: "Write a 10000 word essay about quantum physics",
        timeout: 1000, // Very short timeout to force kill
      });

      assertAgent(output).timedOut();
    }, 10000);
  });
});
```

## Test Categories

### No API Key Required (Fast, Deterministic)

| Category | Tests |
|----------|-------|
| TestAnvilDirectory | Directory creation, task creation, repository registration, cleanup |
| TestRepository | Git init, fixture templates, file operations, commit, cleanup |
| Harness lifecycle | Temp directory creation, cleanup behavior |
| Assertion helpers | All assertion methods with mock AgentOutput data |

### API Key Required (Slow, Integration)

| Category | Tests |
|----------|-------|
| Live stdout capture | Validates JSON line parsing from real agent output |
| Timeout handling | Verifies graceful process termination |

## Running the Tests

```bash
# Run self-verification tests (no API key needed for most tests)
pnpm --filter agents test:harness-verify

# With debug output to see agent stdout/stderr
DEBUG=1 pnpm --filter agents test:harness-verify

# Keep temp directories on failure for debugging
KEEP_TEMP=1 pnpm --filter agents test:harness-verify

# Run only the live tests (requires ANTHROPIC_API_KEY)
pnpm --filter agents test:harness-verify -- --grep "Live agent"
```

## Package.json Script

Add to `agents/package.json`:

```json
{
  "scripts": {
    "test:harness-verify": "vitest run src/testing/__tests__/harness-self-test.ts"
  }
}
```

## Acceptance Criteria

- [ ] All TestAnvilDirectory tests pass without API key
- [ ] All TestRepository tests pass without API key
- [ ] All assertion helper tests pass without API key
- [ ] Live tests are skipped when ANTHROPIC_API_KEY is not set
- [ ] Live tests pass when ANTHROPIC_API_KEY is present
- [ ] Tests use proper cleanup with `afterEach` hooks
- [ ] Error messages are descriptive and help diagnose failures
- [ ] Test output clearly indicates which tests were skipped

## Estimated Effort

Medium (2-3 hours)

## Notes

- All tests use `afterEach` cleanup hooks to ensure resources are freed even on test failure
- The live tests have extended timeouts (60s) to accommodate LLM response latency
- Assertion tests verify both positive cases (should not throw) and negative cases (should throw with specific message)
