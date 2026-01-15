import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";
import { TestMortDirectory } from "../services/test-mort-directory.js";
import { TestRepository } from "../services/test-repository.js";
import type { AgentRunOutput, AgentEventMessage, AgentStateMessage } from "../types.js";

/**
 * Helper to create a mock event for testing.
 * Uses type assertion since we're testing the assertion logic, not type correctness.
 */
function mockEvent(name: string, payload: unknown = {}): AgentEventMessage {
  return { type: "event", name, payload } as AgentEventMessage;
}

/**
 * Helper to create a mock state for testing.
 * Uses type assertion since we're testing the assertion logic, not type correctness.
 */
function mockState(status: string, extra: Record<string, unknown> = {}): AgentStateMessage {
  return {
    type: "state",
    state: { status, ...extra },
  } as AgentStateMessage;
}

/**
 * Skip tests that require API access when no key is present.
 */
const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describe("AgentTestHarness Self-Verification", () => {
  describe("TestMortDirectory service", () => {
    let mortDir: TestMortDirectory;

    afterEach(() => {
      mortDir?.cleanup();
    });

    it("creates directory structure on init", () => {
      mortDir = new TestMortDirectory().init();

      expect(existsSync(mortDir.path)).toBe(true);
      expect(existsSync(`${mortDir.path}/repositories`)).toBe(true);
      expect(existsSync(`${mortDir.path}/tasks`)).toBe(true);
      expect(existsSync(`${mortDir.path}/config.json`)).toBe(true);
    });

    it("removes directory on cleanup", () => {
      mortDir = new TestMortDirectory().init();
      const savedPath = mortDir.path;

      mortDir.cleanup();
      expect(existsSync(savedPath)).toBe(false);
    });

    it("creates tasks with metadata", () => {
      mortDir = new TestMortDirectory().init();
      const task = mortDir.createTask({
        repositoryName: "test-repo",
        title: "Test Task",
      });

      expect(task.slug).toMatch(/^test-task-/);
      expect(task.repositoryName).toBe("test-repo");
      expect(
        existsSync(`${mortDir.path}/tasks/${task.slug}/metadata.json`)
      ).toBe(true);
    });

    it("registers repositories with settings", () => {
      mortDir = new TestMortDirectory().init();
      mortDir.registerRepository({ name: "my-repo", path: "/tmp/fake" });

      expect(
        existsSync(`${mortDir.path}/repositories/my-repo/settings.json`)
      ).toBe(true);
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
      expect(harness.tempDirPath).toMatch(/mort-test-/);
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
      const output: AgentRunOutput = {
        logs: [],
        events: [mockEvent("thread:created")],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };

      expect(() => assertAgent(output).hasEvent("thread:created")).not.toThrow();
      expect(() => assertAgent(output).hasEvent("nonexistent:event")).toThrow(
        /Expected event "nonexistent:event" not found/
      );
    });

    it("hasEventsInOrder validates event ordering", () => {
      // Use arbitrary event names to test the ordering logic
      // Type assertions via mockEvent() allow testing with simplified mock data
      const output: AgentRunOutput = {
        logs: [],
        events: [mockEvent("a"), mockEvent("b"), mockEvent("c")],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };

      // Correct order should pass
      expect(() =>
        assertAgent(output).hasEventsInOrder(["a", "b", "c"])
      ).not.toThrow();

      // Subset in order should pass
      expect(() => assertAgent(output).hasEventsInOrder(["a", "c"])).not.toThrow();

      // Wrong order should fail
      expect(() => assertAgent(output).hasEventsInOrder(["c", "a"])).toThrow(
        /Event "a" not found after position/
      );
    });

    it("finalState validates the last state", () => {
      // Use simplified state objects to test predicate logic
      // Type assertions via mockState() allow testing with minimal mock data
      const output: AgentRunOutput = {
        logs: [],
        events: [],
        states: [mockState("running"), mockState("complete")],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };

      expect(() =>
        assertAgent(output).finalState((s) => s.status === "complete")
      ).not.toThrow();
      expect(() =>
        assertAgent(output).finalState((s) => s.status === "error")
      ).toThrow(/Final state predicate failed/);
    });

    it("succeeded validates exit code", () => {
      const successOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
      };
      const failOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 1,
        stderr: "error",
        durationMs: 100,
      };

      expect(() => assertAgent(successOutput).succeeded()).not.toThrow();
      expect(() => assertAgent(failOutput).succeeded()).toThrow(
        /Expected exit code 0, got 1/
      );
    });

    it("timedOut validates timeout condition", () => {
      const timeoutOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: -1,
        stderr: "[Killed: timeout after 5000ms]",
        durationMs: 5000,
      };
      const normalOutput: AgentRunOutput = {
        logs: [],
        events: [],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 1000,
      };

      expect(() => assertAgent(timeoutOutput).timedOut()).not.toThrow();
      expect(() => assertAgent(normalOutput).timedOut()).toThrow(
        /Expected timeout/
      );
    });

    it("supports fluent chaining", () => {
      const output: AgentRunOutput = {
        logs: [],
        events: [mockEvent("thread:created")],
        states: [],
        exitCode: 0,
        stderr: "",
        durationMs: 100,
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

    it(
      "captures stdout JSON lines correctly",
      async () => {
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
          expect(state.state.status).toMatch(/idle|running|complete|error/);
        }
      },
      60000
    );

    it(
      "handles agent timeout gracefully",
      async () => {
        harness = new AgentTestHarness();

        const output = await harness.run({
          agent: "simple",
          prompt: "Write a 10000 word essay about quantum physics",
          timeout: 1000, // Very short timeout to force kill
        });

        assertAgent(output).timedOut();
      },
      10000
    );
  });
});
