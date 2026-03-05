import { describe, it, expect } from "vitest";
import { threadReducer, type ThreadAction } from "./thread-reducer.js";
import type { ThreadState, RenderContentBlock, StoredMessage } from "../types/events.js";

function makeState(overrides: Partial<ThreadState> = {}): ThreadState {
  return {
    messages: [],
    fileChanges: [],
    workingDirectory: "/tmp",
    status: "running",
    timestamp: 0,
    toolStates: {},
    idMap: {},
    ...overrides,
  };
}

function dispatch(state: ThreadState, action: ThreadAction): ThreadState {
  return threadReducer(state, action);
}

describe("threadReducer — streaming and block IDs", () => {
  it("STREAM_DELTA with messageId creates WIP that can be replaced by APPEND_ASSISTANT_MESSAGE", () => {
    let state = makeState();

    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_abc",
        deltas: [{ index: 0, type: "text", append: "hello", blockId: "block-1" }],
      },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("assistant");
    expect(state.messages[0].anthropicId).toBe("msg_abc");

    const wipId = state.messages[0].id;
    // Should NOT use stream-${...} pattern
    expect(wipId).not.toContain("stream-");

    // Committed message replaces WIP
    const committed: StoredMessage = {
      id: "committed-id",
      anthropicId: "msg_abc",
      role: "assistant",
      content: [{ type: "text", text: "hello world" }],
    };

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: { message: committed },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe(wipId); // Keeps streaming UUID
  });

  it("block IDs from deltas are preserved through accumulation", () => {
    let state = makeState();

    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_001",
        deltas: [{ index: 0, type: "thinking", append: "hmm", blockId: "blk-think" }],
      },
    });

    const blocks = state.messages[0].content as RenderContentBlock[];
    expect(blocks[0].id).toBe("blk-think");

    // Append more to the same block
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_001",
        deltas: [{ index: 0, type: "thinking", append: " more" }],
      },
    });

    const updatedBlocks = state.messages[0].content as RenderContentBlock[];
    expect(updatedBlocks[0].id).toBe("blk-think");
    expect(updatedBlocks[0].thinking).toBe("hmm more");
  });

  it("block IDs carry forward from WIP to committed message", () => {
    let state = makeState();

    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_002",
        deltas: [
          { index: 0, type: "thinking", append: "thought", blockId: "blk-t" },
          { index: 1, type: "text", append: "response", blockId: "blk-x" },
        ],
      },
    });

    const wipBlocks = state.messages[0].content as RenderContentBlock[];
    expect(wipBlocks[0].id).toBe("blk-t");
    expect(wipBlocks[1].id).toBe("blk-x");

    // Committed message arrives (SDK blocks have no id)
    const committed: StoredMessage = {
      id: "sdk-id",
      anthropicId: "msg_002",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "thought complete" },
        { type: "text", text: "response complete" },
      ],
    };

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: { message: committed },
    });

    const finalBlocks = state.messages[0].content as RenderContentBlock[];
    expect(finalBlocks[0].id).toBe("blk-t");
    expect(finalBlocks[1].id).toBe("blk-x");
    // Content is from committed message
    expect(finalBlocks[0].thinking).toBe("thought complete");
    expect(finalBlocks[1].text).toBe("response complete");
  });

  it("non-streamed messages work correctly with no block IDs", () => {
    let state = makeState();

    const message: StoredMessage = {
      id: "non-stream-1",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "cached thought" },
        { type: "text", text: "cached response" },
      ],
    };

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: { message },
    });

    expect(state.messages).toHaveLength(1);
    const blocks = state.messages[0].content as RenderContentBlock[];
    expect(blocks[0].id).toBeUndefined();
    expect(blocks[1].id).toBeUndefined();
  });

  it("STREAM_START uses real UUID, not stream-${id} pattern", () => {
    let state = makeState();

    state = dispatch(state, {
      type: "STREAM_START",
      payload: { anthropicMessageId: "msg_test" },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).not.toContain("stream-");
    expect(state.messages[0].id).not.toContain("wip-");
    expect(state.idMap?.["msg_test"]).toBe(state.messages[0].id);
  });
});
