# Reliable Agent Cancellation

## Problem Statement

Agent cancellation has three core issues that erode user trust:

1. **No visual feedback** — when an agent is cancelled, there's no visible indicator in the thread history. The thread just stops updating.
2. **Streaming content lost** — WIP (work-in-progress) streamed content disappears on cancellation. Partial text/thinking/tool calls that were visible during streaming vanish.
3. **Cancellation hangs when socket unavailable** — if the agent's hub socket is disconnected, the socket cancel silently fails and the SIGTERM fallback requires a PID from thread metadata which may not exist. The process stays alive.

## Current Architecture

### Cancel trigger path (frontend → agent)

```
User clicks Cancel button (content-pane-header.tsx or thread-input.tsx)
  → cancelAgent(threadId)  [agent-service.ts:1028]
    → Try 1: isAgentSocketConnected() → cancelAgentSocket() → sendToAgent({ type: "cancel" })
    → Try 2 (fallback): threadService.get(threadId).pid → invoke("kill_process", { pid })
```

### Cancel handling (agent side)

```
Hub message handler receives { type: "cancel" }  [runner.ts:250]
  → abortController.abort()
    → SDK query() throws AbortError
      → runner.ts catch block [line 420-444]
        → cancelled() → dispatch({ type: "CANCELLED" }) → writes state to disk + emits via socket
        → strategy.cleanup(context, "cancelled")
        → process.exit(130)
```

### Signal handler path (SIGTERM)

```
SIGTERM received [shared.ts:259]
  → setupSignalHandlers handler [shared.ts:236]
    → abortController.abort()  (same as socket cancel)
```

### Process exit handling (frontend)

```
agent_close:{threadId} event [agent-service.ts:776-813]
  → if exit code 130: threadService.markCancelled() + emit AGENT_CANCELLED
  → always: emit AGENT_COMPLETED
```

### Thread reducer (state machine)

```
CANCELLED action [thread-reducer.ts:351-354]
  → markOrphanedTools() — running tools marked as "error: Tool execution was interrupted"
  → status: "cancelled"
```

## Gap Analysis

### Issue 1: No visual cancelled indicator in thread

**Root cause**: When `CANCELLED` is dispatched, the reducer sets `status: "cancelled"` and marks orphaned tools, but there's no **cancelled message block** appended to the `messages` array. The thread just stops mid-stream with no visible indicator. The `StatusAnnouncement` component exists but is screen-reader-only (`sr-only` class).

**What the user sees**: The last streamed content abruptly stops. No "cancelled" badge, no separator, nothing. If they scroll up and back down later, they can't tell where the agent was cancelled vs. where it completed.

### Issue 2: Streaming content lost

**Root cause**: The `cancelled()` function in `output.ts:251` dispatches `{ type: "CANCELLED" }` which calls `applyCancelled()` in the reducer. This sets `status: "cancelled"` and marks orphaned tools, but **does not commit WIP content**. The `wipMap` entries are left as-is — WIP messages remain in the `messages` array but with their streaming content intact... *on disk*.

However, the real problem is the **race condition**: when `abortController.abort()` fires, the SDK's `for await (const message of result)` loop [shared.ts:1327] terminates. The `StreamAccumulator` may have unflushed deltas (it uses 50ms throttling). More critically, the `output.cancelled()` function writes state to disk and emits `CANCELLED` via socket, but the `AGENT_COMPLETED` handler in `listeners.ts:159` calls `threadService.loadThreadState()` which reads from disk and does a full HYDRATE — this should preserve WIP.

The actual loss happens because:
1. The `StreamAccumulator` has a pending flush timer that gets abandoned when abort fires
2. The `cancelled()` dispatch happens before the accumulator flushes its final delta
3. On the frontend, the HYDRATE from disk should recover the WIP content, but only if the disk write happened after the last delta was accumulated

**Deeper issue**: The `cancelled()` function in `output.ts` writes state to disk, but the `StreamAccumulator` operates independently — it sends deltas directly over the socket to the frontend, but doesn't write its accumulated content to disk. The agent's `MessageHandler` only writes completed messages to state. So if cancellation happens mid-stream, the on-disk state may have an empty WIP message while the frontend had streamed content that is now lost.

### Issue 3: Cancellation hangs when socket unavailable

**Root cause**: `cancelAgent()` in `agent-service.ts:1028` tries socket first, then falls back to SIGTERM via PID. But:

1. **Socket fallback is serial, not parallel** — if `isAgentSocketConnected()` returns true but the socket is actually broken (race condition), the `cancelAgentSocket()` call may hang or silently fail. Only then does it try SIGTERM.
2. **PID lookup requires thread metadata** — the fallback reads `thread.pid` from `threadService.get()`. If the PID was never written to metadata (race at startup) or was cleared prematurely, the fallback fails and returns `false`.
3. **SIGTERM only kills the parent process** — the `kill_process` Rust command sends SIGTERM to a single PID. If the agent spawned child processes (sub-agents, CLI tools), they become orphans and keep running.
4. **No timeout on socket cancel** — there's no mechanism to detect that the socket cancel was received but the agent is stuck (e.g., in a long-running tool call that doesn't check the abort signal).
5. **No escalation to SIGKILL** — if SIGTERM doesn't work (process ignoring signals), there's no follow-up.

## Phases

- [ ] Phase 1: Visual cancelled indicator in thread history
- [ ] Phase 2: Preserve streaming content on cancellation
- [ ] Phase 3: Robust process termination (kill tree + escalation)
- [ ] Phase 4: Cancellation timeout + force-kill fallback
- [ ] Phase 5: Frontend optimistic cancellation feedback

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Visual cancelled indicator in thread history

**Goal**: When an agent is cancelled, append a visible "Cancelled" block to the thread so users can see where cancellation occurred.

### Approach

Add a new `APPEND_CANCELLED_MARKER` action to the thread reducer that appends a system message to the messages array. This marker gets written to disk and displayed in the UI.

### Changes

**`core/lib/thread-reducer.ts`**:
- In `applyCancelled()`, after marking orphaned tools, append a system message to `messages`:
  ```ts
  const cancelledMessage: StoredMessage = {
    id: crypto.randomUUID(),
    role: "system",
    content: [{ type: "text", text: "Agent cancelled" }],
  };
  return { ...state, messages: [...state.messages, cancelledMessage], toolStates, status: "cancelled" };
  ```

**`src/components/thread/`**:
- Add rendering for system-role messages with a "cancelled" visual treatment (e.g., a horizontal divider with "Cancelled" text, similar to how Claude Code shows "Task was interrupted")
- Style: muted red/orange text, centered, with a subtle horizontal rule

**Alternative**: Instead of a system message, add a dedicated `CancelledBanner` component that renders at the end of the thread when `status === "cancelled"`. This is simpler and doesn't require changing the message format. **Recommended approach** — render it based on thread status rather than a message, since the status is already there.

### Files to modify
- `src/components/thread/thread-view.tsx` — render `CancelledBanner` after MessageList when `status === "cancelled"`
- New: `src/components/thread/cancelled-banner.tsx` — simple visual component

## Phase 2: Preserve streaming content on cancellation

**Goal**: When cancellation occurs mid-stream, commit the accumulated WIP content so it's preserved in both the on-disk state and the UI.

### Approach

Before dispatching `CANCELLED`, flush the `StreamAccumulator` and commit any WIP content to the message state. The key insight is that the `StreamAccumulator` has the most recent content but it's only been sent as socket deltas — it hasn't been written to the messages array in state.

### Changes

**`agents/src/output.ts`**:
- Add a new `commitWipContent()` export that takes accumulated blocks and merges them into the current WIP message before the `CANCELLED` dispatch
- Or: add a `COMMIT_WIP` reducer action that finalizes WIP messages (moves them from wipMap to regular committed messages with their current content)

**`core/lib/thread-reducer.ts`**:
- Modify `applyCancelled()` to commit WIP messages before marking status. The WIP content is already in the messages array (added by STREAM_START / STREAM_DELTA) — we just need to ensure the wipMap entries are consumed so the content isn't treated as transient.
- Add wipMap cleanup to `applyCancelled()`:
  ```ts
  function applyCancelled(state: ThreadState): ThreadState {
    const toolStates = markOrphanedTools(state.toolStates);
    // Commit all WIP messages — they contain partial but valuable content
    const wipMap = {}; // Clear wipMap to commit all WIP content
    return { ...state, messages: state.messages, toolStates, wipMap, status: "cancelled" };
  }
  ```

**`agents/src/runners/shared.ts`** (or `runner.ts` catch block):
- Before calling `cancelled()`, flush the StreamAccumulator:
  ```ts
  if (accumulator) {
    accumulator.flush(); // Emit final deltas over socket
  }
  ```
- This ensures the frontend has the latest content before CANCELLED fires

**`agents/src/runner.ts`** (catch block around line 425):
- The accumulator is created inside `runAgentLoop` and not accessible from runner.ts. Need to either:
  1. Return it from runAgentLoop (leaky)
  2. Add a `flush` callback to AgentLoopOptions
  3. Handle it inside the `finally` block of the for-await loop in shared.ts — **best option**

### Recommended: Handle in shared.ts finally block

In the `finally` block of the `for await` loop (shared.ts ~line 1342), flush the accumulator before cleanup:
```ts
finally {
  // Flush any pending stream deltas before cleanup
  accumulator?.flush();
  // ... existing cleanup
}
```

This runs whether the loop exits normally, on error, or on abort — covering all cases.

### Files to modify
- `core/lib/thread-reducer.ts` — update `applyCancelled()` to clear wipMap
- `agents/src/runners/shared.ts` — flush accumulator in finally block

## Phase 3: Robust process termination (kill tree + escalation)

**Goal**: When cancellation is needed and the socket is unavailable, reliably kill the agent process and all its descendants.

### Approach

Replace the single-PID SIGTERM with a process-tree kill. On macOS/Linux, use `pkill -P` or walk `/proc` to find child processes. Add SIGKILL escalation after a timeout.

### Changes

**`src-tauri/src/process_commands.rs`**:
- Add a new `kill_process_tree(pid: u32)` command that:
  1. Sends SIGTERM to the process group (using `killpg` on Unix or `pkill -P` for descendants)
  2. Waits up to 3 seconds for processes to exit
  3. Sends SIGKILL to any remaining processes
- Validate PID before killing: check that the process command matches expected patterns (e.g., contains "node" and "runner.js") to avoid killing unrelated processes

**`src/lib/agent-service.ts`**:
- Update `cancelAgent()` to use `kill_process_tree` instead of `kill_process` for the SIGTERM fallback
- Add PID validation: before killing, verify the process still matches what we expect

### Process tree kill implementation (Rust)

```rust
#[tauri::command]
pub async fn kill_process_tree(pid: u32) -> Result<bool, String> {
    // 1. Validate: read /proc/{pid}/cmdline or use `ps -p {pid} -o command=`
    //    Verify it contains "node" and "runner.js" or "mort"
    // 2. Get all descendant PIDs: `pgrep -P {pid}` recursively
    // 3. Send SIGTERM to all (leaf-first, then parent)
    // 4. Wait up to 3s, checking if processes exited
    // 5. SIGKILL any survivors
}
```

On macOS, use `sysctl` or `ps -o pid,ppid` to build the process tree. On Linux, read `/proc/{pid}/children` or use `pgrep`.

### Files to modify
- `src-tauri/src/process_commands.rs` — add `kill_process_tree`
- `src-tauri/src/lib.rs` — register new command
- `src/lib/agent-service.ts` — use `kill_process_tree` in fallback path
- `src/lib/tauri-commands.ts` — add command type if needed

## Phase 4: Cancellation timeout + force-kill fallback

**Goal**: If socket cancel doesn't result in process exit within N seconds, escalate to process kill.

### Approach

When `cancelAgent()` sends a socket cancel, start a timer. If the agent doesn't exit within the timeout, escalate to process tree kill.

### Changes

**`src/lib/agent-service.ts`**:
- Refactor `cancelAgent()` to implement a staged cancellation protocol:

```ts
export async function cancelAgent(threadId: string): Promise<boolean> {
  // Stage 1: Try socket cancel (graceful)
  const socketSent = await trySendSocketCancel(threadId);

  if (socketSent) {
    // Wait up to 5s for agent to exit gracefully
    const exited = await waitForAgentExit(threadId, 5000);
    if (exited) return true;

    // Stage 2: Socket cancel was sent but agent didn't exit — force kill
    logger.warn(`[agent-service] Agent ${threadId} didn't exit after socket cancel, escalating to kill`);
  }

  // Stage 2/3: Force kill via process tree
  return await forceKillAgent(threadId);
}
```

- `waitForAgentExit()` polls `isAgentRunning()` or listens for `AGENT_COMPLETED` event with a timeout
- `forceKillAgent()` reads PID from metadata and calls `kill_process_tree`

### Immediate optimistic UI feedback

When the user clicks cancel, immediately update the UI to show "Cancelling..." state before the backend confirms. This gives instant feedback even if the actual cancellation takes a few seconds.

### Files to modify
- `src/lib/agent-service.ts` — refactor `cancelAgent()` with staged protocol
- `src/components/content-pane/content-pane-header.tsx` — show "Cancelling..." state
- `src/components/content-pane/thread-content.tsx` — handle cancelling state

## Phase 5: Frontend optimistic cancellation feedback

**Goal**: Give immediate visual feedback when the user clicks Cancel, before the backend confirms.

### Approach

When the user clicks cancel:
1. Immediately show a "Cancelling..." indicator (replace the Cancel button with a spinner + "Cancelling...")
2. Disable further cancel clicks
3. Dispatch an optimistic `CANCELLING` state to the thread store
4. When `AGENT_CANCELLED` / `AGENT_COMPLETED` arrives, transition to final `cancelled` state

### Changes

**`core/types/threads.ts`** (optional):
- No new thread status needed — use local component state for the "cancelling" UI

**`src/components/content-pane/thread-content.tsx`**:
- Add `isCancelling` local state
- On cancel click: set `isCancelling = true`, call `cancelAgent()`
- Pass `isCancelling` to the input section to show feedback
- Reset `isCancelling` when thread status changes to non-running

**`src/components/reusable/thread-input.tsx`**:
- When `isCancelling` is true, show a disabled button with "Cancelling..." text and a spinner
- Alternatively, show a pulsing red square icon

**`src/components/content-pane/content-pane-header.tsx`**:
- Same treatment for the header cancel button

### Files to modify
- `src/components/content-pane/thread-content.tsx`
- `src/components/reusable/thread-input.tsx`
- `src/components/content-pane/content-pane-header.tsx`

## Implementation Priority

Phases 1, 2, and 5 are the highest impact for user trust — they provide visual confirmation that cancellation worked and preserve work. Phase 3 and 4 fix the reliability edge cases.

Recommended order: **5 → 1 → 2 → 3 → 4** (optimistic feedback first since it's cheapest and most impactful for perceived reliability, then visual indicator, then content preservation, then backend robustness).

## SDK Behavior Notes

From the Claude Agent SDK types (`sdk.d.ts`):
- `abortController` option: "Controller for cancelling the query. When aborted, the query will stop and clean up resources."
- The `query()` async iterator throws `AbortError` when the controller is aborted
- `result.close()` method exists for forceful query termination — could be used as additional cleanup in the abort handler
- `includePartialMessages: true` is already set — this means partial SDK messages are yielded during streaming, so the MessageHandler has access to partial content
- SDK tool outcomes include `'cancelled'` as a possible value
- `canUseTool` receives an `AbortSignal` — tools that check this signal will abort cooperatively

## Risks and Considerations

1. **Process tree kill safety** — must validate PID/command before killing to avoid killing unrelated processes. The validation regex should check for "node" + ("runner.js" | "mort") in the command line.
2. **SIGKILL data loss** — SIGKILL prevents graceful cleanup. The agent won't write final state to disk. This is acceptable as a last resort since the disk state from the last write is still valid.
3. **Sub-agent orphans** — when killing a parent agent, sub-agents may also need cleanup. The process tree kill handles this, but hub connections from sub-agents may linger. The hub should detect disconnected sockets and clean up.
4. **Race conditions** — the agent might complete naturally during the cancellation timeout window. The code should handle this gracefully (cancelling an already-completed agent is a no-op).
