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
    wipMap: {},
    blockIdMap: {},
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
    expect(state.wipMap?.["msg_test"]).toBe(state.messages[0].id);
  });
});

describe("threadReducer — SDK split messages (same anthropicId)", () => {
  it("multiple APPEND_ASSISTANT_MESSAGE with same anthropicId all survive", () => {
    let state = makeState();

    // Stream some content for msg_abc
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_abc",
        deltas: [{ index: 0, type: "thinking", append: "thinking...", blockId: "blk-1" }],
      },
    });
    expect(state.messages).toHaveLength(1);

    // First committed message: thinking
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: {
          id: "sdk-1",
          anthropicId: "msg_abc",
          role: "assistant",
          content: [{ type: "thinking", thinking: "full thought" }],
        },
      },
    });
    // Replaces WIP — still 1 message
    expect(state.messages).toHaveLength(1);
    expect((state.messages[0].content as RenderContentBlock[])[0].thinking).toBe("full thought");
    // wipMap entry consumed
    expect(state.wipMap?.["msg_abc"]).toBeUndefined();

    // Second committed message: tool_use (same anthropicId)
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: {
          id: "sdk-2",
          anthropicId: "msg_abc",
          role: "assistant",
          content: [{ type: "text", text: "using tool" }],
        },
      },
    });
    // Should APPEND, not replace — now 2 messages
    expect(state.messages).toHaveLength(2);
    expect((state.messages[0].content as RenderContentBlock[])[0].thinking).toBe("full thought");
    expect((state.messages[1].content as RenderContentBlock[])[0].text).toBe("using tool");
  });

  it("reproduces the full SDK split pattern: 3 API calls with split messages", () => {
    let state = makeState();

    // API call 1: msg_A → thinking + tool_use (2 committed messages)
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_A",
        deltas: [{ index: 0, type: "thinking", append: "t1", blockId: "b1" }],
      },
    });

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s1", anthropicId: "msg_A", role: "assistant", content: [{ type: "thinking", thinking: "thought 1" }] },
      },
    });
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s2", anthropicId: "msg_A", role: "assistant", content: [{ type: "text", text: "tool_use 1" }] },
      },
    });

    // API call 2: msg_B → thinking + text + tool_use + tool_use (4 committed messages)
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_B",
        deltas: [{ index: 0, type: "thinking", append: "t2", blockId: "b2" }],
      },
    });

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s3", anthropicId: "msg_B", role: "assistant", content: [{ type: "thinking", thinking: "thought 2" }] },
      },
    });
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s4", anthropicId: "msg_B", role: "assistant", content: [{ type: "text", text: "text 1" }] },
      },
    });
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s5", anthropicId: "msg_B", role: "assistant", content: [{ type: "text", text: "tool_use 2" }] },
      },
    });
    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { id: "s6", anthropicId: "msg_B", role: "assistant", content: [{ type: "text", text: "tool_use 3" }] },
      },
    });

    // All 6 messages should survive
    expect(state.messages).toHaveLength(6);
    expect((state.messages[0].content as RenderContentBlock[])[0].thinking).toBe("thought 1");
    expect((state.messages[1].content as RenderContentBlock[])[0].text).toBe("tool_use 1");
    expect((state.messages[2].content as RenderContentBlock[])[0].thinking).toBe("thought 2");
    expect((state.messages[3].content as RenderContentBlock[])[0].text).toBe("text 1");
    expect((state.messages[4].content as RenderContentBlock[])[0].text).toBe("tool_use 2");
    expect((state.messages[5].content as RenderContentBlock[])[0].text).toBe("tool_use 3");

    // Block ID from streaming carried forward to first committed message per anthropicId
    expect((state.messages[0].content as RenderContentBlock[])[0].id).toBe("b1");
    expect((state.messages[2].content as RenderContentBlock[])[0].id).toBe("b2");
  });
});

describe("threadReducer — late stream deltas", () => {
  it("ignores stream deltas that arrive after message is committed", () => {
    let state = makeState();

    // Stream then commit
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_late",
        deltas: [{ index: 0, type: "thinking", append: "thinking", blockId: "blk-late" }],
      },
    });

    state = dispatch(state, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: {
          id: "committed",
          anthropicId: "msg_late",
          role: "assistant",
          content: [{ type: "thinking", thinking: "final thought" }],
        },
      },
    });

    const messageCountBefore = state.messages.length;
    const contentBefore = (state.messages[0].content as RenderContentBlock[])[0].thinking;

    // Late delta arrives — should be ignored
    state = dispatch(state, {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: "msg_late",
        deltas: [
          { index: 0, type: "thinking", append: " EXTRA JUNK" },
          { index: 1, type: "text", append: "orphan block" },
        ],
      },
    });

    expect(state.messages).toHaveLength(messageCountBefore);
    expect((state.messages[0].content as RenderContentBlock[])[0].thinking).toBe(contentBefore);
  });
});
