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
        "--repo-id", "repo-123",
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
      ]);

      expect(config.repoId).toBe("repo-123");
      expect(config.worktreeId).toBe("worktree-789");
      expect(config.threadId).toBe("thread-456");
      expect(config.cwd).toBe(testDir);
      expect(config.anvilDir).toBe(testDir);
      expect(config.prompt).toBe("test prompt");
    });

    it("parses --history-file argument", () => {
      const config = strategy.parseArgs([
        "--repo-id", "repo-123",
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
        "--history-file", "/path/to/history.json",
      ]);

      expect(config.historyFile).toBe("/path/to/history.json");
    });

    it("ignores deprecated --agent and --agent-mode arguments", () => {
      const config = strategy.parseArgs([
        "--agent", "simple",
        "--repo-id", "repo-123",
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
        "--agent-mode", "auto-accept",
      ]);

      // Should parse successfully and ignore the deprecated args
      expect(config.repoId).toBe("repo-123");
      expect(config.worktreeId).toBe("worktree-789");
      expect(config.threadId).toBe("thread-456");
    });

    it("throws error for missing --repo-id", () => {
      expect(() => strategy.parseArgs([
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Missing required argument: --repo-id");
    });

    it("throws error for missing --worktree-id", () => {
      expect(() => strategy.parseArgs([
        "--repo-id", "repo-123",
        "--thread-id", "thread-456",
        "--cwd", testDir,
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Missing required argument: --worktree-id");
    });

    it("throws error for missing --cwd", () => {
      expect(() => strategy.parseArgs([
        "--repo-id", "repo-123",
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Missing required argument: --cwd");
    });

    it("throws error for non-existent cwd", () => {
      expect(() => strategy.parseArgs([
        "--repo-id", "repo-123",
        "--worktree-id", "worktree-789",
        "--thread-id", "thread-456",
        "--cwd", "/non/existent/path",
        "--anvil-dir", testDir,
        "--prompt", "test prompt",
      ])).toThrow("Working directory does not exist: /non/existent/path");
    });
  });
});
