# Cancel Tool Call (Bash) from UI

## Context

User wants to cancel a running Bash tool call from the UI. The SDK executes Bash internally — our code never spawns the subprocess and has no direct PID access. We need to find a way to interrupt a running Bash command and return a "user cancelled" result to Claude so the conversation continues naturally.

## Architecture Constraint

The process tree when Bash runs:

```
Agent (Node.js) → SDK CLI subprocess → Bash subprocess
     ^our code        ^opaque to us       ^we want to kill this
```

- `query()` from `@anthropic-ai/claude-agent-sdk` spawns a CLI subprocess
- The CLI subprocess handles tool execution, spawning Bash as a grandchild
- `abortController.abort()` kills the entire SDK loop (overkill for one tool)
- PreToolUse hooks fire **before** execution — can deny but can't cancel mid-run
- PostToolUse hooks fire **after** execution — tool already completed

## Approach: Process Tree Kill

Kill the Bash grandchild process directly. The SDK CLI sees its child die, returns the exit signal as a tool result, and Claude continues naturally.

### How to find the PID

**Option A — Process tree scan (reliable, cross-platform-ish)**:When PreToolUse fires for Bash (before execution), snapshot child PIDs of our process. After hook returns "allow", a new child appears (the Bash command). Track the delta.

```
PreToolUse: snapshot = getChildPids(process.pid)
...SDK executes Bash...
PostToolUse won't help (too late), but we can poll briefly after PreToolUse returns
```

Problem: timing. The Bash process spawns inside the SDK's CLI subprocess, not as a direct child of our process. We'd need to walk the tree: `pgrep -P $(pgrep -P $$)`.

**Option B —** `canUseTool` **as a checkpoint (simpler):**`canUseTool` fires right before execution. Use it to:

1. Record that a Bash tool with `toolUseId` X is about to run
2. Start a background process-tree watcher that finds the new Bash child
3. Store `toolUseId → pid` mapping
4. On cancel, kill that PID

**Option C — Abort + restart with injected result (safest)**:Don't try to find the PID. Instead:

1. On cancel, call `abortController.abort()` — kills everything including Bash
2. Restart `query()` with `resume: sessionId` plus conversation history
3. Inject a `tool_result` for the cancelled `toolUseId` with `is_error: true, content: "User cancelled this tool call"`
4. Claude picks up naturally

This avoids all PID-hunting but requires restarting the SDK loop.

## Recommended: Hybrid (Option C primary, Option B as enhancement)

Option C is the safest starting point — it uses existing abort infrastructure and doesn't rely on process tree hacking. Option B can be layered on later for faster cancellation (no restart overhead).

## Phases

- [ ] Phase 0: Spike — verify SDK resume behavior after abort (does it accept injected tool results on resume?)

- [ ] Phase 1: Add `cancel_tool` hub message type and UI cancel button

- [ ] Phase 2: Implement abort-restart pattern in runner

- [ ] Phase 3: Wire up PreToolUse tracking so UI knows which tools are cancellable

- [ ] Phase 4: (Optional) Process tree PID tracking for instant kill without restart

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 0: Spike — SDK resume after abort

**Goal:** Determine if `query({ resume: sessionId })` accepts a conversation where the last message is an injected `tool_result` for a tool_use that the previous session generated.

Steps:

1. Write a minimal test in `agents/src/experimental/` that:
   - Starts a `query()` with a prompt that triggers Bash
   - Aborts via `abortController.abort()` mid-execution
   - Restarts `query()` with `resume: sessionId`
   - Injects a user message containing a `tool_result` block with `is_error: true`
   - Verifies Claude continues the conversation
2. If resume doesn't support injected tool results, test alternative: restart without resume, passing full message history with the injected result

**Key unknowns:**

- Does the SDK expose `session_id` before the loop completes?
  - YES: `shared.ts:1520-1523` captures it from the init message
- Does `resume` pick up mid-turn (after tool_use, before tool_result)?
- Can we inject a synthetic `tool_result` in the `prompt` on resume?

## Phase 1: Hub message type + UI cancel button

### Agent side (`agents/src/lib/hub/types.ts`)

Add to `TauriToAgentMessage`:

```typescript
| { type: "cancel_tool"; payload: { toolUseId: string } }
```

### Runner side (`agents/src/runner.ts`)

Add handler in the hub message switch:

```typescript
case "cancel_tool": {
  const { toolUseId } = msg.payload;
  logger.info(`[runner] Cancel requested for tool: ${toolUseId}`);
  // Signal the cancel (Phase 2 implements the actual abort)
  pendingCancellation = toolUseId;
  abortController.abort();
  break;
}
```

### UI side

- Add a cancel button on Bash tool_use blocks while status is "running"
- Button sends `cancel_tool` message via the agent hub socket
- Need the `toolUseId` — already available in the thread state from assistant message events

### Tauri side (`src-tauri/`)

- Add `cancel_tool` to the IPC command set (or use existing socket relay)

## Phase 2: Abort-restart pattern in runner

### Core change in `runner.ts`

Instead of exiting on AbortError when `pendingCancellation` is set:

```typescript
if (isAbort && pendingCancellation) {
  // Don't exit — restart the loop with cancelled tool result
  const cancelledToolUseId = pendingCancellation;
  pendingCancellation = null;

  // Create new abort controller for the restarted loop
  abortController = new AbortController();

  // Restart query() with resume + injected cancellation result
  // The exact API depends on Phase 0 spike findings
  await runAgentLoop(config, context, agentConfig, priorState, {
    abortController,
    cancelledToolResult: {
      toolUseId: cancelledToolUseId,
      content: "User cancelled this tool call",
    },
    // ...rest of options
  });
}
```

### State management

- Save `sessionId` from the init message (already done at `shared.ts:1520`)
- Save accumulated messages for history reconstruction if resume doesn't work
- The `messageStream` and gates need to be reset/recreated for the new loop

### Edge cases

- What if Claude called multiple tools in one turn? (e.g., Bash + Read)
  - Need to provide results for ALL pending tools, not just the cancelled one
  - Other tools may have already completed — their results are in PostToolUse state
- What if cancel arrives during PreToolUse hook (before execution)?
  - Simpler: just deny the hook, no abort needed
- What if the Bash command completes between cancel click and abort?
  - Race condition: abort fires but tool already finished
  - Handle gracefully: if no pending tool_use on resume, just continue

## Phase 3: PreToolUse tracking for UI

Emit tool lifecycle events so the UI knows which tools are running:

```typescript
// Already partially exists via DrainEventName.TOOL_STARTED
// Need to surface toolUseId + tool_name + tool_input to UI via hub events
emitEvent(EventName.TOOL_STARTED, {
  toolUseId,
  toolName: input.tool_name,
  toolInput: input.tool_input,
  cancellable: input.tool_name === "Bash",
});
```

The UI can then show a cancel button only for Bash tools that are currently executing.

## Phase 4: (Optional) PID tracking for instant kill

If the abort-restart overhead is noticeable, add direct process killing:

1. In `canUseTool` for Bash, before returning `allow`:
   - Start a 100ms poll that watches for new child processes
   - Store the new PID in a `Map<toolUseId, number>`
2. On `cancel_tool`, look up the PID and `process.kill(pid, "SIGTERM")`
3. The SDK sees its Bash subprocess die and returns the result naturally
4. No abort/restart needed — the SDK loop continues uninterrupted

This requires `pgrep` or reading `/proc` on Linux / `ps` on macOS, which is platform-specific but doable.

## Open Questions

1. **Does the SDK support** `resume` **mid-turn?** Phase 0 spike will answer this. If not, we fall back to full message history replay.
2. **Multi-tool cancellation:** If Claude issues Bash + Read in one turn, cancelling Bash still needs Read's result. Need to buffer completed tool results.
3. **Sub-agent Bash:** Should cancellation propagate to Bash commands inside sub-agents? (Probably not in v1.)
4. **Streaming output:** When Bash is cancelled, should we show partial stdout captured so far? The SDK may emit `tool_progress` messages with partial output.