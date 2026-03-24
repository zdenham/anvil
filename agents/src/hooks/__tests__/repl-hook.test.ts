import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplContext, ReplResult } from "../../lib/anvil-repl/types.js";

// ── Mocks ────────────────────────────────────────────────────

const mockExtractCode = vi.fn();
const mockExecute = vi.fn();
const mockFormatResult = vi.fn();

vi.mock("../../lib/anvil-repl/repl-runner.js", () => {
  const MockRunner = vi.fn(function (this: Record<string, unknown>) {
    this.extractCode = mockExtractCode;
    this.execute = mockExecute;
    this.formatResult = mockFormatResult;
  });
  return { AnvilReplRunner: MockRunner };
});

const mockKillAll = vi.fn();
const mockCancelAll = vi.fn();
const mockSpawnerInstances: Array<{ killAll: ReturnType<typeof vi.fn>; cancelAll: ReturnType<typeof vi.fn> }> = [];

vi.mock("../../lib/anvil-repl/child-spawner.js", () => {
  const MockSpawner = vi.fn(function (this: Record<string, unknown>) {
    this.killAll = mockKillAll;
    this.cancelAll = mockCancelAll;
    this.spawn = vi.fn();
    mockSpawnerInstances.push(this as { killAll: ReturnType<typeof vi.fn>; cancelAll: ReturnType<typeof vi.fn> });
  });
  return { ChildSpawner: MockSpawner };
});

vi.mock("../../lib/anvil-repl/anvil-sdk.js", () => {
  const MockSdk = vi.fn(function (this: Record<string, unknown>) {
    this.spawn = vi.fn();
    this.log = vi.fn();
    this.context = {};
    this.logs = [];
  });
  return { AnvilReplSdk: MockSdk };
});

import { createReplHook } from "../repl-hook.js";
import { ChildSpawner } from "../../lib/anvil-repl/child-spawner.js";

const mockContext: ReplContext = {
  threadId: "test-thread-id",
  repoId: "test-repo-id",
  worktreeId: "test-worktree-id",
  workingDir: "/test/dir",
  permissionModeId: "implement",
  anvilDir: "/test/.anvil",
};

function makeHookInput(
  command: string,
  toolUseId = "tool-use-abc",
  extra: Record<string, unknown> = {},
) {
  return {
    tool_name: "Bash",
    tool_use_id: toolUseId,
    tool_input: { command, ...extra },
  };
}

describe("createReplHook", () => {
  let mockEmitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitEvent = vi.fn();
  });

  // ── Pass-through ───────────────────────────────────────────

  describe("non-anvil-repl commands", () => {
    it("returns continue for non-anvil-repl commands", async () => {
      mockExtractCode.mockReturnValue(null);

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput("ls -la"));
      expect(result).toEqual({ continue: true });
    });

    it("does not call execute for non-matching commands", async () => {
      mockExtractCode.mockReturnValue(null);

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput("git status"));
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── Interception ───────────────────────────────────────────

  describe("anvil-repl command interception", () => {
    it("intercepts anvil-repl commands and returns deny with formatted result", async () => {
      mockExtractCode.mockReturnValue("return 42");
      const replResult: ReplResult = {
        success: true,
        value: 42,
        logs: [],
        durationMs: 5,
      };
      mockExecute.mockResolvedValue(replResult);
      mockFormatResult.mockReturnValue("anvil-repl result:\n42");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput('anvil-repl "return 42"'));

      expect(result).toEqual({
        reason: expect.stringContaining("anvil-repl result:\n42"),
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "anvil-repl result:\n42",
        },
      });
    });

    it("includes system instruction prefix for successful results", async () => {
      mockExtractCode.mockReturnValue("return 42");
      mockExecute.mockResolvedValue({
        success: true,
        value: 42,
        logs: [],
        durationMs: 5,
      });
      mockFormatResult.mockReturnValue("anvil-repl result:\n42");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(makeHookInput('anvil-repl "return 42"'))) as {
        reason: string;
      };

      expect(result.reason).toMatch(
        /\[System:.*successful.*\]\n\nanvil-repl result:\n42/,
      );
    });

    it("includes system instruction prefix for error results", async () => {
      mockExtractCode.mockReturnValue("throw new Error('oops')");
      mockExecute.mockResolvedValue({
        success: false,
        value: undefined,
        logs: [],
        error: "oops",
        durationMs: 2,
      });
      mockFormatResult.mockReturnValue("anvil-repl error:\noops");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(
        makeHookInput('anvil-repl "throw new Error(\'oops\')"'),
      )) as { reason: string };

      expect(result.reason).toMatch(
        /\[System:.*error.*not as a permission denial.*\]\n\nanvil-repl error:\noops/,
      );
    });

    it("deny response has correct hookEventName and permissionDecision", async () => {
      mockExtractCode.mockReturnValue("return 1");
      mockExecute.mockResolvedValue({
        success: true,
        value: 1,
        logs: [],
        durationMs: 1,
      });
      mockFormatResult.mockReturnValue("anvil-repl result:\n1");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(makeHookInput('anvil-repl "return 1"'))) as {
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
      mockFormatResult.mockReturnValue("anvil-repl result:\nundefined");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('anvil-repl "const x = 1;"'));

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
      mockFormatResult.mockReturnValue("anvil-repl result:\n1");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('anvil-repl "return 1"', "specific-tool-use-id"));

      expect(ChildSpawner).toHaveBeenCalledWith({
        context: mockContext,
        emitEvent: mockEmitEvent,
        parentToolUseId: "specific-tool-use-id",
      });
    });
  });

  // ── run_in_background guard ──────────────────────────────

  describe("run_in_background guard", () => {
    it("denies anvil-repl with run_in_background: true", async () => {
      mockExtractCode.mockReturnValue("return 42");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(
        makeHookInput('anvil-repl "return 42"', "tool-use-abc", {
          run_in_background: true,
        }),
      )) as { reason: string; hookSpecificOutput: Record<string, unknown> };

      expect(result.reason).toContain("MUST run in the foreground");
      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("passes through non-anvil-repl commands even with run_in_background", async () => {
      mockExtractCode.mockReturnValue(null);

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput("ls -la", "tool-use-abc", {
          run_in_background: true,
        }),
      );

      expect(result).toEqual({ continue: true });
    });
  });

  // ── AbortSignal handling ────────────────────────────────────

  describe("AbortSignal handling", () => {
    it("denies immediately if signal is already aborted", async () => {
      mockExtractCode.mockReturnValue("return 42");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const controller = new AbortController();
      controller.abort();

      const result = (await hook(
        makeHookInput('anvil-repl "return 42"'),
        "tool-use-abc",
        { signal: controller.signal },
      )) as { reason: string; hookSpecificOutput: Record<string, unknown> };

      expect(result.reason).toContain("aborted before execution");
      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("executes normally when signal is not aborted", async () => {
      mockExtractCode.mockReturnValue("return 42");
      mockExecute.mockResolvedValue({
        success: true,
        value: 42,
        logs: [],
        durationMs: 5,
      });
      mockFormatResult.mockReturnValue("anvil-repl result:\n42");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const controller = new AbortController();

      const result = (await hook(
        makeHookInput('anvil-repl "return 42"'),
        "tool-use-abc",
        { signal: controller.signal },
      )) as { reason: string };

      expect(result.reason).toContain("anvil-repl result:");
      expect(mockExecute).toHaveBeenCalled();
    });

    it("executes normally when no signal is provided", async () => {
      mockExtractCode.mockReturnValue("return 1");
      mockExecute.mockResolvedValue({
        success: true,
        value: 1,
        logs: [],
        durationMs: 0,
      });
      mockFormatResult.mockReturnValue("anvil-repl result:\n1");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      const result = (await hook(
        makeHookInput('anvil-repl "return 1"'),
      )) as { reason: string };

      expect(result.reason).toContain("anvil-repl result:");
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe("error handling", () => {
    it("calls spawner.killAll() when execute throws", async () => {
      mockExtractCode.mockReturnValue("bad code");
      mockExecute.mockRejectedValue(new Error("execution failed"));

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await expect(
        hook(makeHookInput('anvil-repl "bad code"')),
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
      mockFormatResult.mockReturnValue("anvil-repl result:\n1");

      const { hook } = createReplHook({
        context: mockContext,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('anvil-repl "return 1"'));
      expect(mockKillAll).not.toHaveBeenCalled();
    });
  });
});
