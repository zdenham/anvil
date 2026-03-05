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

    it("uses custom agentType when provided", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-abc",
      });

      const promise = spawner.spawn({
        prompt: "test",
        agentType: "researcher",
      });
      child.emit("exit", 0);
      await promise;

      const metadata = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
      expect(metadata.agentType).toBe("researcher");
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
          "--repo-id", "test-repo-id",
          "--worktree-id", "test-worktree-id",
          "--cwd", "/test/dir",
          "--prompt", "run tests",
          "--mort-dir", "/test/.mort",
          "--parent-id", "parent-thread-id",
          "--permission-mode", "implement",
          "--skip-naming",
        ],
        expect.objectContaining({
          stdio: "pipe",
          detached: false,
        }),
      );
    });

    it("uses custom cwd and permissionMode when provided", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child);
      mockExistsSync.mockReturnValue(false);

      const spawner = new ChildSpawner({
        context: mockContext,
        emitEvent,
        parentToolUseId: "tool-use-222",
      });

      const promise = spawner.spawn({
        prompt: "custom",
        cwd: "/custom/dir",
        permissionMode: "plan",
      });
      child.emit("exit", 0);
      await promise;

      const args = mockSpawn.mock.calls[0][1] as string[];
      const cwdIndex = args.indexOf("--cwd");
      expect(args[cwdIndex + 1]).toBe("/custom/dir");

      const modeIndex = args.indexOf("--permission-mode");
      expect(args[modeIndex + 1]).toBe("plan");
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
