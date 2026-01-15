import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SimpleRunnerStrategy } from "./simple-runner-strategy.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock shared.js to prevent event emissions during tests
vi.mock("./shared.js", () => ({
  emitEvent: vi.fn(),
  emitLog: vi.fn(),
}));

describe("SimpleRunnerStrategy", () => {
  let strategy: SimpleRunnerStrategy;
  let testDir: string;

  beforeEach(() => {
    strategy = new SimpleRunnerStrategy();
    // Create a unique test directory for each test
    testDir = join(tmpdir(), `simple-runner-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("parseArgs", () => {
    it("parses all required arguments correctly", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ]);

      expect(config.agent).toBe("simple");
      expect(config.taskId).toBe("task-123");
      expect(config.threadId).toBe("thread-456");
      expect(config.cwd).toBe(testDir);
      expect(config.mortDir).toBe(testDir);
      expect(config.prompt).toBe("test prompt");
    });

    it("parses --agent-mode argument with auto-accept", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
        "--agent-mode", "auto-accept",
      ]);

      expect(config.agentMode).toBe("auto-accept");
    });

    it("parses --agent-mode argument with plan", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
        "--agent-mode", "plan",
      ]);

      expect(config.agentMode).toBe("plan");
    });

    it("parses --agent-mode argument with normal", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
        "--agent-mode", "normal",
      ]);

      expect(config.agentMode).toBe("normal");
    });

    it("defaults agentMode to undefined when not provided", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ]);

      expect(config.agentMode).toBeUndefined();
    });

    it("parses --history-file argument", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
        "--history-file", "/path/to/history.json",
      ]);

      expect(config.historyFile).toBe("/path/to/history.json");
    });

    it("throws error for missing --task-id", () => {
      expect(() => strategy.parseArgs([
        "--agent", "simple",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Missing required argument: --task-id");
    });

    it("throws error for missing --cwd", () => {
      expect(() => strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Missing required argument: --cwd");
    });

    it("throws error for non-existent cwd", () => {
      expect(() => strategy.parseArgs([
        "--agent", "simple",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", "/non/existent/path",
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Working directory does not exist: /non/existent/path");
    });

    it("throws error for wrong agent type", () => {
      expect(() => strategy.parseArgs([
        "--agent", "research",
        "--task-id", "task-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--mort-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("SimpleRunnerStrategy only handles simple agent type, got: research");
    });
  });
});
