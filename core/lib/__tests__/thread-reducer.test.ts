import { describe, it, expect } from "vitest";
import { threadReducer, type ThreadAction } from "../thread-reducer.js";
import type {
  ThreadState,
  StoredMessage,
  TokenUsage,
} from "../../types/events.js";

function makeState(overrides: Partial<ThreadState> = {}): ThreadState {
  return {
    messages: [],
    fileChanges: [],
    workingDirectory: "/test",
    status: "running",
    timestamp: 0,
    toolStates: {},
    ...overrides,
  };
}

function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 10,
    cacheReadTokens: 20,
    ...overrides,
  };
}

describe("threadReducer", () => {
  // ── INIT ──────────────────────────────────────────────────────────────
  describe("INIT", () => {
    it("creates running state with defaults", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "INIT",
        payload: { workingDirectory: "/project" },
      });
      expect(result.status).toBe("running");
      expect(result.workingDirectory).toBe("/project");
      expect(result.messages).toEqual([]);
      expect(result.fileChanges).toEqual([]);
      expect(result.toolStates).toEqual({});
    });

    it("preserves prior messages, toolStates, and usage", () => {
      const msgs: StoredMessage[] = [{ id: "1", role: "user", content: "hi" }];
      const toolStates = { t1: { status: "complete" as const, result: "ok" } };
      const usage = makeUsage();

      const state = makeState();
      const result = threadReducer(state, {
        type: "INIT",
        payload: {
          workingDirectory: "/project",
          messages: msgs,
          toolStates,
          lastCallUsage: usage,
          cumulativeUsage: usage,
          sessionId: "sess-1",
          fileChanges: [{ path: "a.ts", operation: "create" }],
        },
      });

      expect(result.messages).toEqual(msgs);
      expect(result.toolStates).toEqual(toolStates);
      expect(result.lastCallUsage).toEqual(usage);
      expect(result.cumulativeUsage).toEqual(usage);
      expect(result.sessionId).toBe("sess-1");
      expect(result.fileChanges).toEqual([{ path: "a.ts", operation: "create" }]);
    });
  });

  // ── APPEND_USER_MESSAGE ───────────────────────────────────────────────
  describe("APPEND_USER_MESSAGE", () => {
    it("appends user message with id", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "APPEND_USER_MESSAGE",
        payload: { content: "hello", id: "msg-1" },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({ role: "user", content: "hello", id: "msg-1" });
    });

    it("deduplicates by id (no-op if message with same id exists)", () => {
      const state = makeState({
        messages: [{ id: "msg-1", role: "user", content: "hello" }],
      });
      const result = threadReducer(state, {
        type: "APPEND_USER_MESSAGE",
        payload: { content: "hello again", id: "msg-1" },
      });
      // Same reference means no mutation occurred
      expect(result).toBe(state);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("hello");
    });

    it("returns new array reference (immutable)", () => {
      const state = makeState({ messages: [{ id: "0", role: "user", content: "old" }] });
      const result = threadReducer(state, {
        type: "APPEND_USER_MESSAGE",
        payload: { content: "new", id: "msg-2" },
      });
      expect(result.messages).not.toBe(state.messages);
      expect(state.messages).toHaveLength(1); // original unchanged
      expect(result.messages).toHaveLength(2);
    });
  });

  // ── APPEND_ASSISTANT_MESSAGE ──────────────────────────────────────────
  describe("APPEND_ASSISTANT_MESSAGE", () => {
    it("appends StoredMessage", () => {
      const msg: StoredMessage = {
        id: "msg_01ABC",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      };
      const state = makeState();
      const result = threadReducer(state, {
        type: "APPEND_ASSISTANT_MESSAGE",
        payload: { message: msg },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toBe(msg);
    });

    it("preserves other fields", () => {
      const state = makeState({ sessionId: "s1", status: "running" });
      const result = threadReducer(state, {
        type: "APPEND_ASSISTANT_MESSAGE",
        payload: { message: { id: "m1", role: "assistant", content: "hi" } },
      });
      expect(result.sessionId).toBe("s1");
      expect(result.status).toBe("running");
    });
  });

  // ── MARK_TOOL_RUNNING ────────────────────────────────────────────────
  describe("MARK_TOOL_RUNNING", () => {
    it("adds to toolStates", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "MARK_TOOL_RUNNING",
        payload: { toolUseId: "tool-1", toolName: "Bash" },
      });
      expect(result.toolStates["tool-1"]).toEqual({
        status: "running",
        toolName: "Bash",
      });
    });
  });

  // ── MARK_TOOL_COMPLETE ───────────────────────────────────────────────
  describe("MARK_TOOL_COMPLETE", () => {
    it("preserves toolName from running state", () => {
      const state = makeState({
        toolStates: { "tool-1": { status: "running", toolName: "Bash" } },
      });
      const result = threadReducer(state, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "tool-1", result: "output", isError: false },
      });
      expect(result.toolStates["tool-1"]).toEqual({
        status: "complete",
        result: "output",
        isError: false,
        toolName: "Bash",
      });
    });

    it("sets error status when isError is true", () => {
      const state = makeState({
        toolStates: { "tool-1": { status: "running", toolName: "Read" } },
      });
      const result = threadReducer(state, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "tool-1", result: "failed", isError: true },
      });
      expect(result.toolStates["tool-1"].status).toBe("error");
      expect(result.toolStates["tool-1"].isError).toBe(true);
    });

    it("handles missing running state (toolName undefined)", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "tool-x", result: "ok", isError: false },
      });
      expect(result.toolStates["tool-x"].toolName).toBeUndefined();
    });
  });

  // ── UPDATE_FILE_CHANGE ───────────────────────────────────────────────
  describe("UPDATE_FILE_CHANGE", () => {
    it("inserts new file change", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "UPDATE_FILE_CHANGE",
        payload: { change: { path: "src/a.ts", operation: "create" } },
      });
      expect(result.fileChanges).toHaveLength(1);
      expect(result.fileChanges[0]).toEqual({ path: "src/a.ts", operation: "create" });
    });

    it("upserts existing by path", () => {
      const state = makeState({
        fileChanges: [{ path: "src/a.ts", operation: "create" }],
      });
      const result = threadReducer(state, {
        type: "UPDATE_FILE_CHANGE",
        payload: { change: { path: "src/a.ts", operation: "modify" } },
      });
      expect(result.fileChanges).toHaveLength(1);
      expect(result.fileChanges[0].operation).toBe("modify");
    });
  });

  // ── SET_SESSION_ID ───────────────────────────────────────────────────
  describe("SET_SESSION_ID", () => {
    it("sets sessionId", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "SET_SESSION_ID",
        payload: { sessionId: "sess-42" },
      });
      expect(result.sessionId).toBe("sess-42");
    });
  });

  // ── UPDATE_USAGE ─────────────────────────────────────────────────────
  describe("UPDATE_USAGE", () => {
    it("sets lastCallUsage and accumulates cumulativeUsage", () => {
      const state = makeState();
      const usage = makeUsage();
      const result = threadReducer(state, {
        type: "UPDATE_USAGE",
        payload: { usage },
      });
      expect(result.lastCallUsage).toEqual(usage);
      expect(result.cumulativeUsage).toEqual(usage);
    });

    it("accumulates across multiple calls", () => {
      const usage1 = makeUsage({ inputTokens: 100, outputTokens: 50 });
      const usage2 = makeUsage({ inputTokens: 200, outputTokens: 75 });
      let state = makeState();
      state = threadReducer(state, { type: "UPDATE_USAGE", payload: { usage: usage1 } });
      state = threadReducer(state, { type: "UPDATE_USAGE", payload: { usage: usage2 } });
      expect(state.lastCallUsage).toEqual(usage2);
      expect(state.cumulativeUsage!.inputTokens).toBe(300);
      expect(state.cumulativeUsage!.outputTokens).toBe(125);
    });
  });

  // ── COMPLETE ─────────────────────────────────────────────────────────
  describe("COMPLETE", () => {
    it("marks orphaned tools, sets metrics and status", () => {
      const state = makeState({
        toolStates: {
          "t1": { status: "running", toolName: "Bash" },
          "t2": { status: "complete", result: "ok" },
        },
      });
      const result = threadReducer(state, {
        type: "COMPLETE",
        payload: { metrics: { durationApiMs: 1000, totalCostUsd: 0.01, numTurns: 3 } },
      });
      expect(result.status).toBe("complete");
      expect(result.toolStates["t1"].status).toBe("error");
      expect(result.toolStates["t1"].isError).toBe(true);
      expect(result.toolStates["t2"].status).toBe("complete");
      expect(result.metrics?.numTurns).toBe(3);
    });

    it("merges lastCallUsage into metrics if not set", () => {
      const usage = makeUsage();
      const state = makeState({ lastCallUsage: usage });
      const result = threadReducer(state, {
        type: "COMPLETE",
        payload: { metrics: { durationApiMs: 500, totalCostUsd: 0.005, numTurns: 1 } },
      });
      expect(result.metrics?.lastCallUsage).toEqual(usage);
    });

    it("does not overwrite metrics.lastCallUsage if already set", () => {
      const existingUsage = makeUsage({ inputTokens: 999 });
      const state = makeState({ lastCallUsage: makeUsage() });
      const result = threadReducer(state, {
        type: "COMPLETE",
        payload: {
          metrics: {
            durationApiMs: 500,
            totalCostUsd: 0.005,
            numTurns: 1,
            lastCallUsage: existingUsage,
          },
        },
      });
      expect(result.metrics?.lastCallUsage).toEqual(existingUsage);
    });
  });

  // ── ERROR ────────────────────────────────────────────────────────────
  describe("ERROR", () => {
    it("marks orphaned tools, sets error and status", () => {
      const state = makeState({
        toolStates: { "t1": { status: "running", toolName: "Read" } },
      });
      const result = threadReducer(state, {
        type: "ERROR",
        payload: { message: "something broke" },
      });
      expect(result.status).toBe("error");
      expect(result.error).toBe("something broke");
      expect(result.toolStates["t1"].status).toBe("error");
    });
  });

  // ── CANCELLED ────────────────────────────────────────────────────────
  describe("CANCELLED", () => {
    it("marks orphaned tools and sets status", () => {
      const state = makeState({
        toolStates: { "t1": { status: "running", toolName: "Write" } },
      });
      const result = threadReducer(state, { type: "CANCELLED" });
      expect(result.status).toBe("cancelled");
      expect(result.toolStates["t1"].status).toBe("error");
      expect(result.toolStates["t1"].result).toBe("Tool execution was interrupted");
    });
  });

  // ── HYDRATE ──────────────────────────────────────────────────────────
  describe("HYDRATE", () => {
    it("replaces entire state", () => {
      const state = makeState({ status: "running" });
      const newState = makeState({
        status: "complete",
        messages: [{ id: "1", role: "user", content: "done" }],
      });
      const result = threadReducer(state, {
        type: "HYDRATE",
        payload: { state: newState },
      });
      expect(result.status).toBe("complete");
      expect(result.messages).toHaveLength(1);
    });
  });

  // ── Immutability ─────────────────────────────────────────────────────
  describe("immutability", () => {
    it("every action returns a new object reference", () => {
      const actions: ThreadAction[] = [
        { type: "INIT", payload: { workingDirectory: "/x" } },
        { type: "APPEND_USER_MESSAGE", payload: { content: "hi", id: "1" } },
        { type: "APPEND_ASSISTANT_MESSAGE", payload: { message: { id: "2", role: "assistant", content: "hey" } } },
        { type: "MARK_TOOL_RUNNING", payload: { toolUseId: "t1", toolName: "Bash" } },
        { type: "MARK_TOOL_COMPLETE", payload: { toolUseId: "t1", result: "ok", isError: false } },
        { type: "UPDATE_FILE_CHANGE", payload: { change: { path: "a.ts", operation: "create" } } },
        { type: "SET_SESSION_ID", payload: { sessionId: "s1" } },
        { type: "UPDATE_USAGE", payload: { usage: makeUsage() } },
        { type: "COMPLETE", payload: { metrics: { durationApiMs: 0, totalCostUsd: 0, numTurns: 0 } } },
      ];

      let state = makeState();
      for (const action of actions) {
        const prev = state;
        state = threadReducer(state, action);
        expect(state).not.toBe(prev);
      }
    });
  });

  // ── Sequence replay (determinism) ────────────────────────────────────
  describe("sequence replay", () => {
    it("replaying same actions produces identical output", () => {
      const actions: ThreadAction[] = [
        { type: "INIT", payload: { workingDirectory: "/project" } },
        { type: "APPEND_USER_MESSAGE", payload: { content: "hello", id: "u1" } },
        { type: "MARK_TOOL_RUNNING", payload: { toolUseId: "t1", toolName: "Bash" } },
        { type: "MARK_TOOL_COMPLETE", payload: { toolUseId: "t1", result: "done", isError: false } },
        { type: "APPEND_ASSISTANT_MESSAGE", payload: { message: { id: "a1", role: "assistant", content: "ok" } } },
        { type: "UPDATE_USAGE", payload: { usage: makeUsage() } },
        { type: "COMPLETE", payload: { metrics: { durationApiMs: 100, totalCostUsd: 0.01, numTurns: 1 } } },
      ];

      function replay(acts: ThreadAction[]): ThreadState {
        let state = makeState();
        for (const action of acts) {
          state = threadReducer(state, action);
        }
        return state;
      }

      const result1 = replay(actions);
      const result2 = replay(actions);
      expect(result1).toEqual(result2);
    });
  });

  // ── CHILD THREAD: actions on empty state (no INIT) ─────────────────
  describe("child thread actions on empty state", () => {
    // Child threads receive actions before INIT because the parent emits
    // MARK_TOOL_RUNNING, APPEND_ASSISTANT_MESSAGE etc. via sendActionForThread.
    // The frontend lazily creates a ThreadStateMachine with empty state.

    it("MARK_TOOL_RUNNING on empty state", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "MARK_TOOL_RUNNING",
        payload: { toolUseId: "tool_1", toolName: "Read" },
      });
      expect(result.toolStates["tool_1"]).toEqual({
        status: "running",
        toolName: "Read",
      });
      expect(result.messages).toEqual([]);
    });

    it("APPEND_ASSISTANT_MESSAGE on empty state", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "APPEND_ASSISTANT_MESSAGE",
        payload: {
          message: { role: "assistant", content: [{ type: "text", text: "hello from sub-agent" }] },
        },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("assistant");
    });

    it("MARK_TOOL_COMPLETE on empty state (unknown tool)", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "tool_1", result: "done", isError: false },
      });
      expect(result.toolStates["tool_1"].status).toBe("complete");
      expect(result.toolStates["tool_1"].toolName).toBeUndefined();
    });

    it("UPDATE_USAGE on empty state", () => {
      const state = makeState();
      const result = threadReducer(state, {
        type: "UPDATE_USAGE",
        payload: { usage: makeUsage({ inputTokens: 500, outputTokens: 200 }) },
      });
      expect(result.lastCallUsage).toEqual(
        expect.objectContaining({ inputTokens: 500, outputTokens: 200 }),
      );
      expect(result.cumulativeUsage).toEqual(
        expect.objectContaining({ inputTokens: 500, outputTokens: 200 }),
      );
    });

    it("sequential child thread actions accumulate correctly", () => {
      let state = makeState();

      // Tool running
      state = threadReducer(state, {
        type: "MARK_TOOL_RUNNING",
        payload: { toolUseId: "t1", toolName: "Bash" },
      });

      // Assistant message
      state = threadReducer(state, {
        type: "APPEND_ASSISTANT_MESSAGE",
        payload: {
          message: { role: "assistant", content: [{ type: "text", text: "running ls" }] },
        },
      });

      // Tool complete
      state = threadReducer(state, {
        type: "MARK_TOOL_COMPLETE",
        payload: { toolUseId: "t1", result: "file1.ts", isError: false },
      });

      expect(state.messages).toHaveLength(1);
      expect(state.toolStates["t1"]).toEqual({
        status: "complete",
        result: "file1.ts",
        isError: false,
        toolName: "Bash",
      });
    });
  });
});
