import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { ReplContext } from "../types.js";

// ── Mocks ────────────────────────────────────────────────────

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../../../runner.js", () => ({
  runnerPath: "/fake/runner.js",
}));

vi.mock("../../../services/thread-naming-service.js", () => ({
  generateThreadName: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Stable UUID for deterministic assertions
vi.mock("crypto", () => ({
  default: { randomUUID: () => "child-uuid-1234" },
}));

import { spawn as mockSpawnFn } from "child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { generateThreadName } from "../../../services/thread-naming-service.js";
import { ChildSpawner } from "../child-spawner.js";

const mockSpawn = mockSpawnFn as unknown as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockGenerateThreadName = generateThreadName as unknown as ReturnType<typeof vi.fn>;

const mockContext: ReplContext = {
  threadId: "parent-thread-id",
  repoId: "test-repo-id",
  worktreeId: "test-worktree-id",
  workingDir: "/test/dir",
  permissionModeId: "implement",
  mortDir: "/test/.mort",
};

function createMockChild(): EventEmitter & { pid: number } {
  const child = new EventEmitter() as EventEmitter & { pid: number };
  child.pid = 12345;
  return child;
}

describe("ChildSpawner", () => {
  let emitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    emitEvent = vi.fn();
    // Default: no API key, so naming is skipped
    delete process.env.ANTHROPIC_API_KEY;
  });

  // ── Disk creation ──────────────────────────────────────────

  describe("createThreadOnDisk", () => {
    it("creates the thread directory and writes metadata + state", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-abc",
      });

      const promise = spawner.spawn({ prompt: "do something" });
      // Let the child "exit"
      child.emit("exit", 0);
      await promise;

      // Verify mkdirSync was called with the correct thread path
      expect(mockMkdirSync).toHaveBeenCalledWith(
        "/test/.mort/threads/child-uuid-1234",
        { recursive: true },
      );

      // Verify writeFileSync was called twice: metadata.json and state.json
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);

      const [metadataPath, metadataContent] = mockWriteFileSync.mock.calls[0];
      expect(metadataPath).toBe(
        "/test/.mort/threads/child-uuid-1234/metadata.json",
      );
      const metadata = JSON.parse(metadataContent);
      expect(metadata.id).toBe("child-uuid-1234");
      expect(metadata.parentThreadId).toBe("parent-thread-id");
      expect(metadata.parentToolUseId).toBe("tool-use-abc");
      expect(metadata.agentType).toBe("general-purpose");
      expect(metadata.repoId).toBe("test-repo-id");
      expect(metadata.worktreeId).toBe("test-worktree-id");

      const [statePath, stateContent] = mockWriteFileSync.mock.calls[1];
      expect(statePath).toBe(
        "/test/.mort/threads/child-uuid-1234/state.json",
      );
      const state = JSON.parse(stateContent);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[0].content[0].text).toBe("do something");
    });

    it("sets visualSettings.parentId to parent thread ID", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-abc",
      });

      const promise = spawner.spawn({ prompt: "nested child" });
      child.emit("exit", 0);
      await promise;

      const metadataContent = mockWriteFileSync.mock.calls[0][1];
      const metadata = JSON.parse(metadataContent);
      expect(metadata.visualSettings).toEqual({
        parentId: "parent-thread-id",
      });
    });

  });

  // ── Event emission ─────────────────────────────────────────

  describe("emitThreadCreated", () => {
    it("emits thread:created event with correct payload", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-xyz",
      });

      const promise = spawner.spawn({ prompt: "hello" });
      child.emit("exit", 0);
      await promise;

      expect(emitEvent).toHaveBeenCalledWith(
        "thread:created",
        {
          threadId: "child-uuid-1234",
          repoId: "test-repo-id",
          worktreeId: "test-worktree-id",
          source: "mort-repl:child-spawn",
        },
        "mort-repl:child-spawn",
      );
    });
  });

  // ── Process spawning ───────────────────────────────────────

  describe("spawnProcess", () => {
    it("spawns node with correct CLI args", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-111",
      });

      const promise = spawner.spawn({ prompt: "run tests" });
      child.emit("exit", 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "node",
        [
          "/fake/runner.js",
          "--thread-id", "child-uuid-1234",
          "--parent-id", "parent-thread-id",
          "--repo-id", "test-repo-id",
          "--worktree-id", "test-worktree-id",
          "--cwd", "/test/dir",
          "--prompt", "run tests",
          "--mort-dir", "/test/.mort",
          "--parent-thread-id", "parent-thread-id",
          "--permission-mode", "implement",
          "--skip-naming",
        ],
        expect.objectContaining({
          stdio: "pipe",
          detached: false,
        }),
      );
    });

    it("uses parent context for cwd and permissionMode", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-222",
      });

      const promise = spawner.spawn({ prompt: "test" });
      child.emit("exit", 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      const cwdIndex = args.indexOf("--cwd");
      expect(args[cwdIndex + 1]).toBe("/test/dir");

      const modeIndex = args.indexOf("--permission-mode");
      expect(args[modeIndex + 1]).toBe("implement");
    });
  });

  // ── Context short-circuit CLI arg ──────────────────────────

  describe("contextShortCircuit CLI arg", () => {
    it("passes --context-short-circuit when option is provided", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-csc",
      });

      const shortCircuit = { limitPercent: 80, message: "Save your progress" };
      const promise = spawner.spawn({
        prompt: "long task",
        contextShortCircuit: shortCircuit,
      });
      child.emit("exit", 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      const cscIndex = args.indexOf("--context-short-circuit");
      expect(cscIndex).toBeGreaterThan(-1);
      expect(JSON.parse(args[cscIndex + 1])).toEqual(shortCircuit);
    });

    it("omits --context-short-circuit when option is not provided", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-no-csc",
      });

      const promise = spawner.spawn({ prompt: "short task" });
      child.emit("exit", 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain("--context-short-circuit");
    });
  });

  // ── Result reading ─────────────────────────────────────────

  describe("readChildResult", () => {
    it("reads last assistant message from state.json after exit", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          messages: [
            { role: "user", content: [{ type: "text", text: "prompt" }] },
            {
              role: "assistant",
              content: [{ type: "text", text: "first response" }],
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "final response" }],
            },
          ],
        }),
      );

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-333",
      });

      const promise = spawner.spawn({ prompt: "read test" });
      child.emit("exit", 0);
      const result = await promise;

      expect(result).toBe("final response");
    });

    it("returns empty string when no assistant messages exist", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          messages: [
            { role: "user", content: [{ type: "text", text: "prompt" }] },
          ],
        }),
      );

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-444",
      });

      const promise = spawner.spawn({ prompt: "no response" });
      child.emit("exit", 0);
      const result = await promise;

      expect(result).toBe("");
    });

    it("returns empty string when state.json does not exist", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-555",
      });

      const promise = spawner.spawn({ prompt: "missing state" });
      child.emit("exit", 0);
      const result = await promise;

      expect(result).toBe("");
    });

    it("handles malformed state.json gracefully", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not valid json {{{");

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-666",
      });

      const promise = spawner.spawn({ prompt: "bad json" });
      child.emit("exit", 0);
      const result = await promise;

      expect(result).toBe("");
    });

    it("truncates results over 50KB", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(true);

      const bigText = "a".repeat(60 * 1024);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: bigText }],
            },
          ],
        }),
      );

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-777",
      });

      const promise = spawner.spawn({ prompt: "big result" });
      child.emit("exit", 0);
      const result = await promise;

      expect(result.length).toBeLessThan(bigText.length);
      expect(result).toContain("... [truncated");
    });
  });

  // ── Completion events ────────────────────────────────────────

  describe("completion events", () => {
    it("emits THREAD_STATUS_CHANGED and AGENT_COMPLETED after child exits", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-evt",
      });

      const promise = spawner.spawn({ prompt: "completion test" });
      child.emit("exit", 0);
      await promise;

      expect(emitEvent).toHaveBeenCalledWith(
        "thread:status-changed",
        { threadId: "child-uuid-1234", status: "completed" },
        "mort-repl:child-complete",
      );
      expect(emitEvent).toHaveBeenCalledWith(
        "agent:completed",
        { threadId: "child-uuid-1234", exitCode: 0 },
        "mort-repl:child-complete",
      );
    });

    it("emits error status when child exits with non-zero code", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-err",
      });

      const promise = spawner.spawn({ prompt: "failing child" });
      child.emit("exit", 1);
      await promise;

      expect(emitEvent).toHaveBeenCalledWith(
        "thread:status-changed",
        { threadId: "child-uuid-1234", status: "error" },
        "mort-repl:child-complete",
      );
      expect(emitEvent).toHaveBeenCalledWith(
        "agent:completed",
        { threadId: "child-uuid-1234", exitCode: 1 },
        "mort-repl:child-complete",
      );
    });

    it("emits cancelled status when child exits with code 130", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-cancel",
      });

      const promise = spawner.spawn({ prompt: "cancelled child" });
      child.emit("exit", 130);
      await promise;

      expect(emitEvent).toHaveBeenCalledWith(
        "thread:status-changed",
        { threadId: "child-uuid-1234", status: "cancelled" },
        "mort-repl:child-complete",
      );
    });
  });

  // ── killAll() ──────────────────────────────────────────────

  describe("killAll", () => {
    it("kills active child processes", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-888",
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      // Start spawn but don't resolve yet — child is "active"
      const promise = spawner.spawn({ prompt: "kill test" });

      // Kill while the child is still running
      spawner.killAll();

      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");

      // Now let the child exit to clean up the promise
      child.emit("exit", 0);
      await promise;

      killSpy.mockRestore();
    });
  });

  // ── cancelAll() ─────────────────────────────────────────────

  describe("cancelAll", () => {
    it("writes cancelled status to metadata.json and emits events for active children", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ id: "child-uuid-1234", status: "running", updatedAt: 1000 }),
      );

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-cancel-all",
      });

      // Start spawn but don't resolve — child is "active"
      const promise = spawner.spawn({ prompt: "cancel test" });

      // Cancel while child is still running
      spawner.cancelAll();

      // Verify metadata.json was written with cancelled status
      const metadataWriteCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => (call[0] as string).endsWith("metadata.json") && (call[1] as string).includes('"cancelled"'),
      );
      expect(metadataWriteCall).toBeDefined();
      const writtenMetadata = JSON.parse(metadataWriteCall![1] as string);
      expect(writtenMetadata.status).toBe("cancelled");

      // Verify events emitted
      expect(emitEvent).toHaveBeenCalledWith(
        "thread:status-changed",
        { threadId: "child-uuid-1234", status: "cancelled" },
        "mort-repl:child-cancel",
      );
      expect(emitEvent).toHaveBeenCalledWith(
        "agent:completed",
        { threadId: "child-uuid-1234", exitCode: 130 },
        "mort-repl:child-cancel",
      );

      // Clean up the pending promise
      child.emit("exit", 130);
      await promise;
    });

    it("clears activeChildren map after cancelAll", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-clear",
      });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      const promise = spawner.spawn({ prompt: "clear test" });

      spawner.cancelAll();

      // Calling killAll after cancelAll should not try to kill anything
      // (activeChildren was cleared)
      spawner.killAll();
      // killSpy should not have been called by killAll (cancelAll already cleared the map)
      expect(killSpy).not.toHaveBeenCalled();

      child.emit("exit", 130);
      await promise;
      killSpy.mockRestore();
    });

    it("does not throw when metadata.json does not exist", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-no-meta",
      });

      const promise = spawner.spawn({ prompt: "no metadata test" });

      // Should not throw even though metadata.json doesn't exist
      expect(() => spawner.cancelAll()).not.toThrow();

      // Events should still be emitted (frontend update is independent of disk)
      expect(emitEvent).toHaveBeenCalledWith(
        "thread:status-changed",
        { threadId: "child-uuid-1234", status: "cancelled" },
        "mort-repl:child-cancel",
      );

      child.emit("exit", 130);
      await promise;
    });
  });

  // ── error handling ─────────────────────────────────────────

  describe("child process error handling", () => {
    it("resolves with empty string when child emits error event", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-999",
      });

      const promise = spawner.spawn({ prompt: "error test" });
      child.emit("error", new Error("spawn failed"));
      const result = await promise;

      expect(result).toBe("");
    });
  });
});
