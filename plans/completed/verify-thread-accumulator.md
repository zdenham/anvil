# Verify Thread Accumulator: Agent vs UI State Equality

## Goal

Prove that the UI accumulator produces the same final thread state as the agent, using a live agent run. This verifies the fix from `fix-thread-accumulator-discrepancy.md` (wipMap + blockIdMap) end-to-end.

## Background

The agent and UI build thread state from different event streams:

| Side | Events consumed | How |
|------|----------------|-----|
| **Agent** (`output.ts`) | `thread_action` only | `dispatch()` → `threadReducer()` |
| **UI** (`listeners.ts`) | `thread_action` + `stream_delta` | Both mapped to `ThreadAction` and fed through same `threadReducer()` |

The `stream_delta` events create WIP messages with block IDs. When `APPEND_ASSISTANT_MESSAGE` arrives (via `thread_action`), the WIP is replaced and block IDs carry forward via `blockIdMap`. If this works correctly, the final state (after all messages are committed) should be identical on both sides — the WIP messages are transient and `wipMap`/`blockIdMap` should be empty.

## The Discrepancy Risk

The UI receives `STREAM_DELTA` actions that populate `wipMap` and `blockIdMap` before `APPEND_ASSISTANT_MESSAGE` commits. If the commit logic is buggy (the original bug), the UI ends up with fewer messages. After the fix, both sides should converge.

## Phases

- [x] Expose stream_delta messages from MockHubServer in the harness
- [x] Add integration test: record + replay + compare
- [x] Verify wipMap/blockIdMap are drained

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Expose stream_delta messages from MockHubServer

The `AgentTestHarness.collectMessages()` currently only processes `thread_action` and `event` messages. We need access to the raw `stream_delta` socket messages.

### Option A: Return raw socket messages alongside processed output (recommended)

Add a `socketMessages` field to `AgentRunOutput`:

```typescript
// agents/src/testing/types.ts
export interface AgentRunOutput {
  // ...existing fields...
  /** Raw socket messages for advanced assertions (stream_delta replay, etc.) */
  socketMessages: SocketMessage[];
}
```

In `AgentTestHarness.spawnAgent()`, after the process closes:

```typescript
const socketMessages = this.mockHub.getMessagesForThread(threadId);
this.collectMessages(socketMessages, states, events);

resolve({
  logs, events, states,
  socketMessages,  // <-- new
  exitCode: killed ? -1 : (code ?? 1),
  // ...
});
```

This is non-breaking — existing tests ignore the new field.

## Phase 2: Integration test — record, replay, compare

### Test file: `agents/src/testing/__tests__/accumulator-parity.test.ts`

```typescript
const describeWithApi = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

describeWithApi("Accumulator parity: agent vs UI", () => {
  // 1. Run a live agent with a prompt that triggers tool use + thinking
  // 2. Extract thread_action and stream_delta messages from socketMessages
  // 3. Build "agent state" by replaying only thread_action messages
  // 4. Build "UI state" by replaying thread_action + stream_delta (in original order)
  // 5. Compare final states
});
```

### Step-by-step:

**Step 1: Run agent**

```typescript
const output = await harness.run({
  prompt: "Read the file README.md and summarize it in 2 sentences",
  timeout: 60000,
});
```

Use a prompt that forces at least one tool call so we get:
- `thinking` blocks (if extended thinking enabled, else just text)
- `tool_use` blocks
- Multiple `APPEND_ASSISTANT_MESSAGE` actions
- `STREAM_DELTA` events for each streaming block

**Step 2: Separate messages by type**

```typescript
const threadActions = output.socketMessages
  .filter(m => m.type === "thread_action")
  .map(m => m.action as ThreadAction);

const streamDeltas = output.socketMessages
  .filter(m => m.type === "stream_delta")
  .map(m => ({
    anthropicMessageId: m.messageId as string,
    deltas: m.deltas as BlockDelta[],
  }));
```

**Step 3: Build agent-side state (thread_action only)**

```typescript
let agentState: ThreadState | undefined;
for (const action of threadActions) {
  agentState = agentState
    ? threadReducer(agentState, action)
    : threadReducer(undefined as unknown as ThreadState, action);
}
```

**Step 4: Build UI-side state (interleaved thread_action + stream_delta)**

The key challenge: we need to replay events in the order they were received by the mock hub. Socket messages have implicit ordering (they're stored in `receivedMessages[]` in arrival order).

```typescript
let uiState: ThreadState | undefined;
for (const msg of output.socketMessages) {
  let action: ThreadAction | undefined;

  if (msg.type === "thread_action") {
    action = msg.action as ThreadAction;
  } else if (msg.type === "stream_delta" && msg.messageId) {
    action = {
      type: "STREAM_DELTA",
      payload: {
        anthropicMessageId: msg.messageId as string,
        deltas: msg.deltas as BlockDelta[],
      },
    };
  }

  if (action) {
    uiState = uiState
      ? threadReducer(uiState, action)
      : threadReducer(undefined as unknown as ThreadState, action);
  }
}
```

**Step 5: Compare final states**

The states should be equal modulo transient/timing fields:

```typescript
function normalizeForComparison(state: ThreadState): Partial<ThreadState> {
  const { wipMap, blockIdMap, timestamp, ...rest } = state;
  return rest;
}

expect(normalizeForComparison(uiState!)).toEqual(normalizeForComparison(agentState!));
```

### Additional assertions:

```typescript
// wipMap and blockIdMap should be empty after all messages committed
expect(uiState!.wipMap).toEqual({});
expect(uiState!.blockIdMap).toEqual({});

// Both should have the same number of messages
expect(uiState!.messages.length).toBe(agentState!.messages.length);

// Both should have the same message content
for (let i = 0; i < agentState!.messages.length; i++) {
  const agentMsg = agentState!.messages[i];
  const uiMsg = uiState!.messages[i];
  expect(uiMsg.role).toBe(agentMsg.role);
  // Content comparison (UI messages may have block IDs that agent messages don't)
  // Block IDs are additive, not destructive — content should match
  if (Array.isArray(agentMsg.content)) {
    const agentBlocks = agentMsg.content as RenderContentBlock[];
    const uiBlocks = uiMsg.content as RenderContentBlock[];
    expect(uiBlocks.length).toBe(agentBlocks.length);
    for (let j = 0; j < agentBlocks.length; j++) {
      expect(uiBlocks[j].type).toBe(agentBlocks[j].type);
      expect(uiBlocks[j].text).toBe(agentBlocks[j].text);
      expect(uiBlocks[j].thinking).toBe(agentBlocks[j].thinking);
    }
  }
}
```

## Phase 3: Verify wipMap/blockIdMap are drained

After all events are replayed, both maps should be empty. This confirms:
- Every WIP message was replaced by a committed message
- Every block ID was consumed during commit
- No stale entries remain

```typescript
// After full replay
expect(Object.keys(uiState!.wipMap ?? {})).toHaveLength(0);
expect(Object.keys(uiState!.blockIdMap ?? {})).toHaveLength(0);
```

If these are non-empty, it means either:
1. A `stream_delta` arrived for a message that was never committed (SDK bug or test timeout)
2. The block correlation key computation differs between streaming and commit paths

## Edge Cases to Consider

1. **tool_use blocks**: These have API-provided stable IDs (`toolu_...`). They don't stream (no `STREAM_DELTA` for them), so they should only appear in `APPEND_ASSISTANT_MESSAGE`. The correlation key uses `block.id` directly.

2. **Split messages**: The SDK can emit multiple `APPEND_ASSISTANT_MESSAGE` with the same `anthropicId`. The first should replace the WIP, subsequent ones should append. This is the original bug scenario.

3. **No streaming**: If `stream_delta` events are absent (hub disconnected, etc.), the UI falls back to `thread_action` only, which is identical to the agent path. This should still work.

4. **Late deltas**: `stream_delta` arriving after `APPEND_ASSISTANT_MESSAGE` should be no-ops (the late delta guard). The final state should be unaffected.

## Running the Test

```bash
cd agents && ANTHROPIC_API_KEY=sk-... pnpm test -- --grep "Accumulator parity"
```

Or to run all integration tests:
```bash
cd agents && ANTHROPIC_API_KEY=sk-... pnpm test
```
