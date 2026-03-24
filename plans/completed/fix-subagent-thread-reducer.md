# Fix Sub-Agent Thread State: Stuck Running + Live UI Updates

## Problem

Two related issues with sub-agent thread state:

### Issue 1: Sub-agents stuck in "running" state (green indicator)

The PostToolUse completion handler for Task/Agent tools (`shared.ts:1043-1171`) has multiple paths where child thread metadata **never gets updated to "completed"**:

**Bug A — JSON.parse throws on non-JSON tool_response** (`shared.ts:1053-1055`):
When `tool_response` is a plain string (e.g., error message, cancelled text), `JSON.parse(input.tool_response)` throws. The catch at line 1169 silently swallows it. Metadata stays `"running"` forever.

**Bug B — PostToolUseFailure never updates child threads** (`shared.ts:1179-1206`):
When a sub-agent fails, the SDK fires `PostToolUseFailure` instead of `PostToolUse`. The failure handler marks the tool error on the **parent** thread but never touches the child thread's metadata. Child stays `"running"`.

### Issue 2: Sub-agent tool calls invisible during streaming

The parent thread uses the reducer-based data flow:
```
output.ts dispatch() → threadReducer() → hubClient.send({ type: "thread_action", action })
  → Rust hub → Tauri event → agent-service routeAgentMessage() → eventBus THREAD_ACTION
  → listeners.ts → store.dispatch() → ThreadStateMachine.apply() → UI re-renders
```

But `MessageHandler.handleForChildThread()` (`message-handler.ts:565`) bypasses this entirely — directly manipulates in-memory state and writes to disk. The frontend's `threadStates[childThreadId]` is never populated during streaming.

### Prior Work (Completed)

Phases 1-3 of the original plan were completed:
- `sendForThread()` method added to HubClient for child-scoped messages
- `handleForChildThread()` refactored to emit ThreadActions via socket
- Frontend verified to handle child thread THREAD_ACTIONs (no changes needed)

## Phases

- [x] Add `sendForThread()` method to HubClient for child-scoped messages
- [x] Refactor `handleForChildThread()` to emit ThreadActions via socket
- [x] Verify frontend handles child thread THREAD_ACTIONs
- [x] Fix "stuck in running" bugs in PostToolUse/PostToolUseFailure
- [x] Add agent harness replay verification test for child thread actions
- [x] Add unit tests for child thread reducer actions on empty state

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 4: Fix "stuck in running" bugs

**File**: `agents/src/runners/shared.ts`

### Bug A fix: Defensive JSON.parse in PostToolUse (~line 1053)

Wrap the `JSON.parse` so that if parsing fails, we still mark the child thread as completed:

```typescript
// Current (throws on plain strings):
const taskResponse = typeof input.tool_response === "string"
  ? JSON.parse(input.tool_response)
  : input.tool_response;

// Fixed:
let taskResponse: Record<string, unknown>;
try {
  taskResponse = typeof input.tool_response === "string"
    ? JSON.parse(input.tool_response)
    : (input.tool_response as Record<string, unknown>);
} catch {
  // tool_response is a plain string (error message, cancellation, etc.)
  // Wrap it as content so we still mark the child as completed
  taskResponse = { content: [{ type: "text", text: String(input.tool_response) }] };
}
```

### Bug B fix: Handle child thread in PostToolUseFailure (~line 1182)

In the `PostToolUseFailure` hook, after `markToolComplete`, add child thread status update:

```typescript
if (input.tool_name === "Task" || input.tool_name === "Agent") {
  const childThreadId = toolUseIdToChildThreadId.get(input.tool_use_id);
  if (childThreadId) {
    const childThreadPath = join(config.anvilDir, "threads", childThreadId);
    const metadataPath = join(childThreadPath, "metadata.json");
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      metadata.status = "error";
      metadata.updatedAt = Date.now();
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    }
    emitEvent(EventName.THREAD_STATUS_CHANGED, {
      threadId: childThreadId,
      status: "error",
    }, "PostToolUseFailure:subagent");
    toolUseIdToChildThreadId.delete(input.tool_use_id);
  }
}
```

## Phase 5: Agent harness replay verification test

**File**: `agents/src/testing/__tests__/sub-agent.integration.test.ts`

### How the existing harness replay works

The `AgentTestHarness` spawns a real agent subprocess and captures all socket messages via `MockHubServer`:

1. `MockHubServer.getMessagesForThread(threadId)` returns all messages with that `threadId`
2. `AgentTestHarness.collectMessages()` replays `thread_action` messages through `threadReducer` to reconstruct state snapshots
3. `assertAgent(output).finalState(...)` asserts against the replayed state

After Phase 2 (already done), child thread `thread_action` messages have `threadId: childThreadId` (via `sendForThread()`). This means `hub.getMessagesForThread(childThreadId)` now returns child-specific actions.

### Test plan

```typescript
it("child thread actions are emitted via socket and replay to valid state", async () => {
  harness = new AgentTestHarness();
  const output = await harness.run({
    prompt: `Use the Agent tool with subagent_type="Explore" to find TypeScript files. Description: "Find TS". Do nothing else.`,
    timeout: 120000,
  });
  assertAgent(output).succeeded();

  // Find child thread ID from metadata on disk
  const anvilDir = harness.tempDirPath!;
  const threadsDir = join(anvilDir, "threads");
  const threadDirs = readdirSync(threadsDir);
  let childThreadId: string | undefined;
  for (const dir of threadDirs) {
    const metaPath = join(threadsDir, dir, "metadata.json");
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      if (meta.parentThreadId) {
        childThreadId = dir;
        break;
      }
    }
  }
  expect(childThreadId).toBeDefined();

  // KEY: MockHubServer received thread_action messages for the child thread
  const hub = harness.getMockHub()!;
  const childMessages = hub.getMessagesForThread(childThreadId!);
  const childActions = childMessages.filter(m => m.type === "thread_action");
  expect(childActions.length).toBeGreaterThan(0);

  // Replay child actions through threadReducer — same as frontend would
  let childState: ThreadState = {
    messages: [], fileChanges: [], workingDirectory: "",
    status: "running", timestamp: 0, toolStates: {},
  };
  for (const msg of childActions) {
    childState = threadReducer(childState, msg.action as ThreadAction);
  }

  // Replayed state should have messages (sub-agent ran)
  expect(childState.messages.length).toBeGreaterThan(0);

  // Replayed state should have tool states (Explore agent uses Read/Glob/Grep)
  const toolEntries = Object.values(childState.toolStates);
  expect(toolEntries.length).toBeGreaterThan(0);

  // Compare with disk state — they should converge
  const diskState = JSON.parse(
    readFileSync(join(threadsDir, childThreadId!, "state.json"), "utf-8")
  );
  expect(childState.messages.length).toBe(diskState.messages.length);
});
```

This verifies: agent subprocess → `handleForChildThread` → `hub.sendActionForThread(childId)` → MockHubServer captures with `threadId: childId` → `threadReducer` replay → valid state matching disk.

### Future: Frontend ReplayHarness integration

The frontend has `ReplayHarness` (`src/test/helpers/event-replay.ts`) that feeds captured events through `routeAgentMessage()` → eventBus → listeners → store. A future test could:
1. Capture socket messages from agent harness (both parent + child)
2. Feed them through `ReplayHarness` for each thread
3. Assert `useThreadStore.getState().threadStates[childThreadId]` is populated

This is enabled by Phase 2's socket emission but out of scope here.

## Phase 6: Unit tests for child thread actions on empty state

**File**: `core/lib/__tests__/thread-reducer.test.ts`

Verify that `MARK_TOOL_RUNNING`, `APPEND_ASSISTANT_MESSAGE`, and `MARK_TOOL_COMPLETE` work on a fresh empty state (simulating child thread's first action arriving before INIT):

```typescript
describe("child thread actions on empty state", () => {
  const emptyState: ThreadState = {
    messages: [], fileChanges: [], workingDirectory: "",
    status: "running", timestamp: 0, toolStates: {},
  };

  it("MARK_TOOL_RUNNING on empty state", () => {
    const result = threadReducer(emptyState, {
      type: "MARK_TOOL_RUNNING",
      payload: { toolUseId: "tool_1", toolName: "Read" },
    });
    expect(result.toolStates["tool_1"]).toEqual({
      status: "running", toolName: "Read",
    });
  });

  it("APPEND_ASSISTANT_MESSAGE on empty state", () => {
    const result = threadReducer(emptyState, {
      type: "APPEND_ASSISTANT_MESSAGE",
      payload: {
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
      },
    });
    expect(result.messages).toHaveLength(1);
  });

  it("MARK_TOOL_COMPLETE on empty state with unknown tool", () => {
    const result = threadReducer(emptyState, {
      type: "MARK_TOOL_COMPLETE",
      payload: { toolUseId: "tool_1", result: "done", isError: false },
    });
    expect(result.toolStates["tool_1"].status).toBe("complete");
  });
});
```

## Risks & Mitigations

- **Double state writes**: Both disk + socket for child threads. Intentional (disk-as-truth + live updates). Reducer is deterministic so they converge.
- **Message ordering**: Child thread actions interleaved with parent actions. Same hub connection preserves per-thread ordering. Cross-thread ordering doesn't matter (independent state machines).
- **Missing INIT action**: Child thread machines start with empty state from `getOrCreateMachine()`. Phase 6 tests verify actions work on empty state. If issues arise, emit INIT before first child message.
- **Streaming deltas**: `handleForChildThread` doesn't handle `stream_event`. Out of scope — child threads don't get streaming text yet.
