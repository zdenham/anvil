import { describe, it, expect } from "vitest";
import {
  ThreadStateMachine,
  type TransportEvent,
  type ThreadRenderState,
} from "../thread-state-machine";
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type { ThreadState, StoredMessage, TokenUsage } from "@core/types/events.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function makeActionEvent(action: ThreadAction): TransportEvent {
  return { type: "THREAD_ACTION", action };
}

function makeDelta(messageId: string, deltas: Array<{ index: number; type: "text" | "thinking"; append: string }>): TransportEvent {
  return {
    type: "THREAD_ACTION",
    action: { type: "STREAM_DELTA", payload: { anthropicMessageId: messageId, deltas } },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ThreadStateMachine", () => {
  // ── Action application ──────────────────────────────────────────────
  describe("action application", () => {
    it("applies INIT action through shared reducer", () => {
      const machine = new ThreadStateMachine();
      const state = machine.apply(
        makeActionEvent({ type: "INIT", payload: { workingDirectory: "/project" } }),
      );
      expect(state.status).toBe("running");
      expect(state.messages).toEqual([]);
    });

    it("applies APPEND_USER_MESSAGE", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeActionEvent({ type: "INIT", payload: { workingDirectory: "/p" } }));
      const state = machine.apply(
        makeActionEvent({ type: "APPEND_USER_MESSAGE", payload: { content: "hello", id: "u1" } }),
      );
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual({ role: "user", content: "hello", id: "u1" });
    });

    it("applies APPEND_ASSISTANT_MESSAGE", () => {
      const msg: StoredMessage = { id: "a1", role: "assistant", content: [{ type: "text", text: "hi" }] };
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeActionEvent({ type: "APPEND_ASSISTANT_MESSAGE", payload: { message: msg } }),
      );
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toBe(msg);
    });

    it("applies MARK_TOOL_RUNNING and MARK_TOOL_COMPLETE", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeActionEvent({ type: "MARK_TOOL_RUNNING", payload: { toolUseId: "t1", toolName: "Bash" } }));
      let state = machine.getState();
      expect(state.toolStates["t1"].status).toBe("running");

      state = machine.apply(
        makeActionEvent({ type: "MARK_TOOL_COMPLETE", payload: { toolUseId: "t1", result: "ok", isError: false } }),
      );
      expect(state.toolStates["t1"].status).toBe("complete");
    });

    it("applies UPDATE_FILE_CHANGE", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeActionEvent({ type: "UPDATE_FILE_CHANGE", payload: { change: { path: "a.ts", operation: "create" } } }),
      );
      expect(state.fileChanges).toHaveLength(1);
      expect(state.fileChanges[0].path).toBe("a.ts");
    });

    it("applies UPDATE_USAGE", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeActionEvent({ type: "UPDATE_USAGE", payload: { usage: makeUsage() } }),
      );
      expect(state.status).toBe("running");
    });

    it("applies COMPLETE with metrics", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeActionEvent(
          { type: "COMPLETE", payload: { metrics: { durationApiMs: 100, totalCostUsd: 0.01, numTurns: 1 } } },
        ),
      );
      expect(state.status).toBe("complete");
      expect(state.metrics?.numTurns).toBe(1);
    });

    it("applies ERROR", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeActionEvent({ type: "ERROR", payload: { message: "broke" } }),
      );
      expect(state.status).toBe("error");
      expect(state.error).toBe("broke");
    });

    it("applies CANCELLED", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(makeActionEvent({ type: "CANCELLED" }));
      expect(state.status).toBe("cancelled");
    });
  });

  // ── Stream deltas ──────────────────────────────────────────────────
  describe("stream deltas", () => {
    it("creates streaming message on first delta", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeDelta("msg-1", [{ index: 0, type: "text", append: "Hello" }]),
      );
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("assistant");

      const blocks = state.messages[0].content as Array<{ type: string; text?: string; isStreaming: boolean }>;
      expect(blocks[0].type).toBe("text");
      expect(blocks[0].text).toBe("Hello");
      expect(blocks[0].isStreaming).toBe(true);
    });

    it("appends to existing block on subsequent deltas", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "Hello" }]));
      const state = machine.apply(
        makeDelta("msg-1", [{ index: 0, type: "text", append: " world" }]),
      );

      const blocks = state.messages[0].content as Array<{ text: string }>;
      expect(blocks[0].text).toBe("Hello world");
    });

    it("handles thinking blocks", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeDelta("msg-1", [{ index: 0, type: "thinking", append: "Let me think..." }]),
      );

      const blocks = state.messages[0].content as Array<{ type: string; thinking: string; isStreaming: boolean }>;
      expect(blocks[0].type).toBe("thinking");
      expect(blocks[0].thinking).toBe("Let me think...");
      expect(blocks[0].isStreaming).toBe(true);
    });

    it("handles multiple blocks in one delta", () => {
      const machine = new ThreadStateMachine(makeState());
      const state = machine.apply(
        makeDelta("msg-1", [
          { index: 0, type: "thinking", append: "hmm" },
          { index: 1, type: "text", append: "ok" },
        ]),
      );

      const blocks = state.messages[0].content as Array<{ type: string }>;
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("thinking");
      expect(blocks[1].type).toBe("text");
    });

    it("preserves existing messages when creating streaming message", () => {
      const initial = makeState({
        messages: [{ id: "u1", role: "user", content: "hello" }],
      });
      const machine = new ThreadStateMachine(initial);
      const state = machine.apply(
        makeDelta("msg-1", [{ index: 0, type: "text", append: "hi" }]),
      );
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe("u1");
    });
  });

  // ── APPEND_ASSISTANT_MESSAGE replaces streaming ─────────────────────
  describe("committed action replaces streaming", () => {
    it("APPEND_ASSISTANT_MESSAGE replaces streaming message with same anthropicId", () => {
      const machine = new ThreadStateMachine(makeState({ idMap: {} }));
      // Stream some content
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "streaming..." }]));
      expect(machine.getState().messages).toHaveLength(1);

      // Commit the message with matching anthropicId
      const committed: StoredMessage = {
        id: "final-uuid",
        anthropicId: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "final" }],
      };
      const state = machine.apply(
        makeActionEvent({ type: "APPEND_ASSISTANT_MESSAGE", payload: { message: committed } }),
      );

      // Should still have 1 message (replaced, not appended)
      expect(state.messages).toHaveLength(1);
      const blocks = state.messages[0].content as Array<{ type: string; text: string }>;
      expect(blocks[0].text).toBe("final");
    });

    it("COMPLETE after streaming preserves state", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "content" }]));
      machine.apply(
        makeActionEvent(
          { type: "COMPLETE", payload: { metrics: { durationApiMs: 100, totalCostUsd: 0.01, numTurns: 1 } } },
        ),
      );
      expect(machine.getState().status).toBe("complete");
    });

    it("ERROR after streaming preserves state", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "content" }]));
      machine.apply(makeActionEvent({ type: "ERROR", payload: { message: "fail" } }));
      expect(machine.getState().status).toBe("error");
    });

    it("CANCELLED after streaming preserves state", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "content" }]));
      machine.apply(makeActionEvent({ type: "CANCELLED" }));
      expect(machine.getState().status).toBe("cancelled");
    });
  });

  // ── HYDRATE ────────────────────────────────────────────────────────
  describe("HYDRATE", () => {
    it("replaces entire state", () => {
      const machine = new ThreadStateMachine(makeState({ status: "running" }));
      const newState = makeState({
        status: "complete",
        messages: [{ id: "1", role: "user", content: "done" }],
      });
      const state = machine.apply({ type: "HYDRATE", state: newState });
      expect(state.status).toBe("complete");
      expect(state.messages).toHaveLength(1);
    });

    it("clears streaming state", () => {
      const machine = new ThreadStateMachine(makeState());
      machine.apply(makeDelta("msg-1", [{ index: 0, type: "text", append: "partial" }]));

      machine.apply({ type: "HYDRATE", state: makeState() });

      expect(machine.getState().messages).toHaveLength(0);
    });
  });

  // ── Reducer consistency ────────────────────────────────────────────
  describe("reducer consistency", () => {
    it("machine state matches direct reducer output for same actions", () => {
      const actions: ThreadAction[] = [
        { type: "INIT", payload: { workingDirectory: "/project" } },
        { type: "APPEND_USER_MESSAGE", payload: { content: "hello", id: "u1" } },
        { type: "MARK_TOOL_RUNNING", payload: { toolUseId: "t1", toolName: "Bash" } },
        { type: "MARK_TOOL_COMPLETE", payload: { toolUseId: "t1", result: "done", isError: false } },
        { type: "APPEND_ASSISTANT_MESSAGE", payload: { message: { id: "a1", role: "assistant", content: "ok" } } },
        { type: "UPDATE_USAGE", payload: { usage: makeUsage() } },
        { type: "COMPLETE", payload: { metrics: { durationApiMs: 100, totalCostUsd: 0.01, numTurns: 1 } } },
      ];

      const machine = new ThreadStateMachine(makeState());
      let machineState: ThreadRenderState = machine.getState();
      actions.forEach((action) => {
        machineState = machine.apply(makeActionEvent(action));
      });

      let reducerState = makeState();
      for (const action of actions) {
        reducerState = threadReducer(reducerState, action);
      }

      expect(machineState.messages).toEqual(reducerState.messages);
      expect(machineState.toolStates).toEqual(reducerState.toolStates);
      expect(machineState.status).toEqual(reducerState.status);
      expect(machineState.fileChanges).toEqual(reducerState.fileChanges);
      expect(machineState.metrics).toEqual(reducerState.metrics);
      expect(machineState.error).toEqual(reducerState.error);
    });
  });

  // ── Sequence replay (determinism) ──────────────────────────────────
  describe("sequence replay", () => {
    it("replaying same events produces identical state", () => {
      const events: TransportEvent[] = [
        makeActionEvent({ type: "INIT", payload: { workingDirectory: "/project" } }),
        makeActionEvent({ type: "APPEND_USER_MESSAGE", payload: { content: "hello", id: "u1" } }),
        makeDelta("msg-1", [{ index: 0, type: "text", append: "thinking..." }]),
        makeDelta("msg-1", [{ index: 0, type: "text", append: " more" }]),
        makeActionEvent(
          { type: "APPEND_ASSISTANT_MESSAGE", payload: { message: { id: "msg-1", anthropicId: "msg-1", role: "assistant", content: "done" } } },
        ),
        makeActionEvent(
          { type: "COMPLETE", payload: { metrics: { durationApiMs: 100, totalCostUsd: 0.01, numTurns: 1 } } },
        ),
      ];

      function replay(evts: TransportEvent[]): ThreadRenderState {
        const m = new ThreadStateMachine(makeState());
        let state = m.getState();
        for (const evt of evts) {
          state = m.apply(evt);
        }
        return state;
      }

      const result1 = replay(events);
      const result2 = replay(events);
      expect(result1).toEqual(result2);
    });
  });

  // ── getState() shape ──────────────────────────────────────────────
  describe("getState shape", () => {
    it("returns full ThreadState (superset — preserves all fields)", () => {
      const machine = new ThreadStateMachine(makeState({ workingDirectory: "/project" }));
      const state = machine.getState();

      expect(state).toHaveProperty("messages");
      expect(state).toHaveProperty("toolStates");
      expect(state).toHaveProperty("status");
      expect(state).toHaveProperty("fileChanges");
      expect(state).toHaveProperty("workingDirectory");
      expect(state.workingDirectory).toBe("/project");
    });
  });
});
