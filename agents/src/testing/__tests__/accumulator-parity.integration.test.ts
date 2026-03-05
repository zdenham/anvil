import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentTestHarness } from "../index.js";
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type { ThreadState, BlockDelta, RenderContentBlock } from "@core/types/events.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Accumulator parity: agent vs UI", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({ timeout: 90000 });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("produces identical final state from thread_action-only vs interleaved replay", async () => {
    // Use a prompt that forces tool use for a realistic run
    const output = await harness.run({
      prompt: "Read the file README.md and tell me how many lines it has",
      timeout: 90000,
    });

    expect(output.exitCode).toBe(0);
    expect(output.socketMessages.length).toBeGreaterThan(0);

    // Separate messages by type
    const threadActionMsgs = output.socketMessages.filter(
      (m) => m.type === "thread_action" && m.action,
    );
    const streamDeltaMsgs = output.socketMessages.filter(
      (m) => m.type === "stream_delta",
    );

    // Sanity: we should have both thread_actions and stream_deltas
    expect(threadActionMsgs.length).toBeGreaterThan(0);
    // stream_deltas may or may not be present depending on hub timing,
    // but the test is valid either way

    // ── Agent-side state: replay thread_action only ──
    let agentState: ThreadState | undefined;
    for (const msg of threadActionMsgs) {
      const action = msg.action as ThreadAction;
      agentState = agentState
        ? threadReducer(agentState, action)
        : threadReducer(undefined as unknown as ThreadState, action);
    }
    expect(agentState).toBeDefined();

    // ── UI-side state: replay thread_action + stream_delta interleaved ──
    let uiState: ThreadState | undefined;
    for (const msg of output.socketMessages) {
      let action: ThreadAction | undefined;

      if (msg.type === "thread_action" && msg.action) {
        action = msg.action as ThreadAction;
      } else if (msg.type === "stream_delta" && msg.messageId) {
        action = {
          type: "STREAM_DELTA",
          payload: {
            anthropicMessageId: msg.messageId as string,
            deltas: msg.deltas as BlockDelta[],
          },
        };
      } else if (msg.type === "stream_delta" && !msg.messageId) {
        // stream_delta without messageId — skip (initial empty flush)
        continue;
      }

      if (action) {
        uiState = uiState
          ? threadReducer(uiState, action)
          : threadReducer(undefined as unknown as ThreadState, action);
      }
    }
    expect(uiState).toBeDefined();

    // ── Compare: same message count ──
    expect(uiState!.messages.length).toBe(agentState!.messages.length);

    // ── Compare: same status ──
    expect(uiState!.status).toBe(agentState!.status);

    // ── Compare: message content matches ──
    for (let i = 0; i < agentState!.messages.length; i++) {
      const agentMsg = agentState!.messages[i];
      const uiMsg = uiState!.messages[i];

      expect(uiMsg.role).toBe(agentMsg.role);

      if (Array.isArray(agentMsg.content)) {
        const agentBlocks = agentMsg.content as RenderContentBlock[];
        const uiBlocks = uiMsg.content as RenderContentBlock[];
        expect(uiBlocks.length).toBe(agentBlocks.length);

        for (let j = 0; j < agentBlocks.length; j++) {
          expect(uiBlocks[j].type).toBe(agentBlocks[j].type);
          // Text/thinking content should match
          if (agentBlocks[j].text !== undefined) {
            expect(uiBlocks[j].text).toBe(agentBlocks[j].text);
          }
          if (agentBlocks[j].thinking !== undefined) {
            expect(uiBlocks[j].thinking).toBe(agentBlocks[j].thinking);
          }
        }
      }
    }

    // ── Verify wipMap and blockIdMap are drained ──
    expect(Object.keys(uiState!.wipMap ?? {})).toHaveLength(0);
    expect(Object.keys(uiState!.blockIdMap ?? {})).toHaveLength(0);

    // ── Structural equality (modulo transient fields) ──
    const normalize = (s: ThreadState) => {
      const { wipMap, blockIdMap, timestamp, ...rest } = s;
      // Strip transient fields: message IDs (generated client-side),
      // isStreaming, and block IDs
      const messages = rest.messages.map((m) => {
        const { id: _msgId, ...msgRest } = m;
        if (!Array.isArray(msgRest.content)) return msgRest;
        return {
          ...msgRest,
          content: (msgRest.content as RenderContentBlock[]).map((block) => {
            const { isStreaming, id, ...blockRest } = block;
            return blockRest;
          }),
        };
      });
      return { ...rest, messages };
    };

    expect(normalize(uiState!)).toEqual(normalize(agentState!));
  });
});
