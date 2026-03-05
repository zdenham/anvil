import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplContext, ReplResult } from "../../lib/mort-repl/types.js";

// ── Mocks ────────────────────────────────────────────────────

const mockExtractCode = vi.fn();
const mockExecute = vi.fn();
const mockFormatResult = vi.fn();

vi.mock("../../lib/mort-repl/repl-runner.js", () => {
  const MockRunner = vi.fn(function (this: Record<string, unknown>) {
    this.extractCode = mockExtractCode;
    this.execute = mockExecute;
    this.formatResult = mockFormatResult;
  });
  return { MortReplRunner: MockRunner };
});

const mockKillAll = vi.fn();
const mockSpawnerInstances: Array<{ killAll: ReturnType<typeof vi.fn> }> = [];

vi.mock("../../lib/mort-repl/child-spawner.js", () => {
  const MockSpawner = vi.fn(function (this: Record<string, unknown>) {
    this.killAll = mockKillAll;
    this.spawn = vi.fn();
    mockSpawnerInstances.push(this as { killAll: ReturnType<typeof vi.fn> });
  });
  return { ChildSpawner: MockSpawner };
});

vi.mock("../../lib/mort-repl/mort-sdk.js", () => {
  const MockSdk = vi.fn(function (this: Record<string, unknown>) {
    this.spawn = vi.fn();
    this.log = vi.fn();
    this.context = {};
    this.logs = [];
  });
  return { MortReplSdk: MockSdk };
});

import { createReplHook } from "../repl-hook.js";
import { ChildSpawner } from "../../lib/mort-repl/child-spawner.js";

const mockContext: ReplContext = {
  threadId: "test-thread-id",
  repoId: "test-repo-id",
  worktreeId: "test-worktree-id",
  workingDir: "/test/dir",
  permissionModeId: "implement",
  mortDir: "/test/.mort",
};

function makeHookInput(command: string, toolUseId = "tool-use-abc") {
  return {
    tool_name: "Bash",
    tool_use_id: toolUseId,
    tool_input: { command },
  };
}

describe("createReplHook", () => {
  let mockEmitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitEvent = vi.fn();
  });

  // ── Pass-through ───────────────────────────────────────────

  describe("non-mort-repl commands", () => {
    it("returns continue for non-mort-repl commands", async () => {
      mockExtractCode.mockReturnValue(null);

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput("ls -la"));
      expect(result).toEqual({ continue: true });
    });

    it("does not call execute for non-matching commands", async () => {
      mockExtractCode.mockReturnValue(null);

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput("git status"));
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── Interception ───────────────────────────────────────────

  describe("mort-repl command interception", () => {
    it("intercepts mort-repl commands and returns deny with formatted result", async () => {
      mockExtractCode.mockReturnValue("return 42");
      const replResult: ReplResult = {
        success: true,
        value: 42,
        logs: [],
        durationMs: 5,
      };
      mockExecute.mockResolvedValue(replResult);
      mockFormatResult.mockReturnValue("mort-repl result:\n42");

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput('mort-repl "return 42"'));

      expect(result).toEqual({
        reason: "mort-repl result:\n42",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "mort-repl result:\n42",
        },
      });
    });

    it("deny response has correct hookEventName and permissionDecision", async () => {
      mockExtractCode.mockReturnValue("return 1");
      mockExecute.mockResolvedValue({
        success: true,
        value: 1,
        logs: [],
        durationMs: 1,
      });
      mockFormatResult.mockReturnValue("mort-repl result:\n1");

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(makeHookInput('mort-repl "return 1"'))) as {
        hookSpecificOutput: { hookEventName: string; permissionDecision: string };
      };

      expect(result.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    });

    it("passes extracted code and context to execute", async () => {
      mockExtractCode.mockReturnValue("const x = 1;");
      mockExecute.mockResolvedValue({
        success: true,
        value: undefined,
        logs: [],
        durationMs: 0,
      });
      mockFormatResult.mockReturnValue("mort-repl result:\nundefined");

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('mort-repl "const x = 1;"'));

      expect(mockExecute).toHaveBeenCalledWith(
        "const x = 1;",
        mockContext,
        expect.anything(),
      );
    });
  });

  // ── ChildSpawner creation ──────────────────────────────────

  describe("ChildSpawner creation", () => {
    it("creates ChildSpawner with correct parentToolUseId", async () => {
      mockExtractCode.mockReturnValue("return 1");
      mockExecute.mockResolvedValue({
        success: true,
        value: 1,
        logs: [],
        durationMs: 0,
      });
      mockFormatResult.mockReturnValue("mort-repl result:\n1");

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('mort-repl "return 1"', "specific-tool-use-id"));

      expect(ChildSpawner).toHaveBeenCalledWith({
        context: mockContext,
        emitEvent: mockEmitEvent,
        parentToolUseId: "specific-tool-use-id",
      });
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe("error handling", () => {
    it("calls spawner.killAll() when execute throws", async () => {
      mockExtractCode.mockReturnValue("bad code");
      mockExecute.mockRejectedValue(new Error("execution failed"));

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await expect(
        hook(makeHookInput('mort-repl "bad code"')),
      ).rejects.toThrow("execution failed");

      expect(mockKillAll).toHaveBeenCalled();
    });

    it("does not call killAll when execution succeeds", async () => {
      mockExtractCode.mockReturnValue("return 1");
      mockExecute.mockResolvedValue({
        success: true,
        value: 1,
        logs: [],
        durationMs: 0,
      });
      mockFormatResult.mockReturnValue("mort-repl result:\n1");

      const hook = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('mort-repl "return 1"'));
      expect(mockKillAll).not.toHaveBeenCalled();
    });
  });
});
