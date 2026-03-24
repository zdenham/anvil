import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCommentResolutionHook } from "../comment-resolution-hook.js";
import { EventName } from "@core/types/events.js";

function makeHookInput(command: string) {
  return {
    tool_name: "Bash",
    tool_input: { command },
  };
}

describe("createCommentResolutionHook", () => {
  let mockEmitEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEmitEvent = vi.fn();
  });

  // ── Pass-through for non-matching commands ─────────────────────

  describe("non-matching commands", () => {
    it("returns continue for non-matching Bash commands", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "test-worktree-id",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput("ls -la"));
      expect(result).toEqual({ continue: true });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it("returns continue for commands that contain but do not start with anvil-resolve-comment", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "test-worktree-id",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput("echo anvil-resolve-comment abc"));
      expect(result).toEqual({ continue: true });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  // ── ID parsing ────────────────────────────────────────────────

  describe("ID parsing", () => {
    it("extracts a single ID from double-quoted args", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput('anvil-resolve-comment "abc-123"'));

      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "abc-123",
      });
      expect(result).toMatchObject({
        reason: expect.stringContaining("Resolved 1 comment(s)"),
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("Successfully resolved 1 comment(s)"),
        },
      });
    });

    it("extracts multiple IDs from comma-separated list", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput('anvil-resolve-comment "abc-123,def-456,ghi-789"'),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(3);
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "abc-123",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "def-456",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "ghi-789",
      });
      expect(result).toMatchObject({
        reason: expect.stringContaining("Resolved 3 comment(s)"),
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("Successfully resolved 3 comment(s)"),
        },
      });
    });

    it("handles no quotes around IDs", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput("anvil-resolve-comment abc-123,def-456"),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(2);
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "abc-123",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "def-456",
      });
      expect(result).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: "deny",
        },
      });
    });

    it("handles single-quoted IDs", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput("anvil-resolve-comment 'abc-123,def-456'"),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: "deny",
        },
      });
    });

    it("handles whitespace in comma-separated list", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      await hook(
        makeHookInput('anvil-resolve-comment "abc-123 , def-456 , ghi-789"'),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(3);
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "abc-123",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "def-456",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "ghi-789",
      });
    });

    it("filters empty strings from splitting", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      await hook(
        makeHookInput('anvil-resolve-comment "abc-123,,def-456,"'),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(2);
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "abc-123",
      });
      expect(mockEmitEvent).toHaveBeenCalledWith(EventName.COMMENT_RESOLVED, {
        worktreeId: "wt-1",
        commentId: "def-456",
      });
    });

    it("handles leading whitespace in command", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput('  anvil-resolve-comment "abc-123"'),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: "deny",
        },
      });
    });
  });

  // ── Deny cases ────────────────────────────────────────────────

  describe("deny cases", () => {
    it("denies bare anvil-resolve-comment with no args", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(makeHookInput("anvil-resolve-comment"));

      expect(result).toMatchObject({
        reason: expect.stringContaining("Usage"),
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("no IDs"),
        },
      });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it("denies when worktreeId is undefined", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: undefined,
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput('anvil-resolve-comment "abc-123"'),
      );

      expect(result).toMatchObject({
        reason: expect.stringContaining("no worktreeId"),
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("No worktreeId"),
        },
      });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  // ── Event emission ────────────────────────────────────────────

  describe("event emission", () => {
    it("emits one COMMENT_RESOLVED event per ID", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      await hook(
        makeHookInput('anvil-resolve-comment "id-1,id-2,id-3"'),
      );

      expect(mockEmitEvent).toHaveBeenCalledTimes(3);
      for (const [i, id] of ["id-1", "id-2", "id-3"].entries()) {
        expect(mockEmitEvent).toHaveBeenNthCalledWith(
          i + 1,
          EventName.COMMENT_RESOLVED,
          { worktreeId: "wt-1", commentId: id },
        );
      }
    });

    it("includes correct worktreeId and commentId in each event", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "specific-worktree-uuid",
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('anvil-resolve-comment "comment-abc"'));

      expect(mockEmitEvent).toHaveBeenCalledWith(
        EventName.COMMENT_RESOLVED,
        {
          worktreeId: "specific-worktree-uuid",
          commentId: "comment-abc",
        },
      );
    });

    it("emits no events when parsing fails (no args)", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput("anvil-resolve-comment"));
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it("emits no events when worktreeId is undefined", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: undefined,
        emitEvent: mockEmitEvent,
      });

      await hook(makeHookInput('anvil-resolve-comment "abc-123"'));
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  // ── deny reason format ──────────────────────────────────────

  describe("deny reason format", () => {
    it("includes resolved count and IDs in reason", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput('anvil-resolve-comment "abc,def"'),
      );

      expect(result).toMatchObject({
        reason: expect.stringContaining("Resolved 2 comment(s): abc, def"),
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("Successfully resolved 2 comment(s)"),
        },
      });
    });

    it("does not include updatedInput on successful resolve", async () => {
      const hook = createCommentResolutionHook({
        worktreeId: "wt-1",
        emitEvent: mockEmitEvent,
      });

      const result = await hook(
        makeHookInput('anvil-resolve-comment "abc-123"'),
      );

      const output = (result as Record<string, unknown>)
        .hookSpecificOutput as Record<string, unknown>;

      expect(output.updatedInput).toBeUndefined();
    });
  });
});
