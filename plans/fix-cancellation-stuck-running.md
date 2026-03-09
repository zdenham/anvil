# Fix: Cancellation Leaves Thread Stuck in "Running" State

## Problem

When cancelling a running agent, the thread stays in green "running" state. The cancel button doesn't disappear, no cancelled banner appears, and subsequent cancel attempts log `cancel_agent: no process found (already exited)`.

## Root Cause

**Duplicate signal handlers in** `agents/src/runner.ts` — two SIGTERM handlers are registered in sequence:

```
Line 310:  process.on("SIGTERM", () => { cleanup(); process.exit(0); });    ← FIRES FIRST
Line 358:  setupSignalHandlers(async () => { ... }, abortController);        ← NEVER RUNS
```

Node.js calls signal listeners in registration order. The first handler calls `process.exit(0)` immediately, which terminates the process before the second handler (from `setupSignalHandlers`) can fire. This means:

1. `abortController.abort()` never fires — the SDK query is never aborted
2. `strategy.cleanup(context, "cancelled")` never runs — metadata is never updated to "cancelled" on disk
3. Process exits with **code 0** (not 130) — frontend doesn't recognize it as cancellation

The frontend `agent_close` handler only calls `markCancelled()` when `code === 130`. With code 0, it falls through to `AGENT_COMPLETED` → `refreshById` → reads "running" from disk (never updated). Thread is stuck.

## Secondary Issues

Even if the root cause is fixed, there are defense gaps:

1. **No fallback when cancel finds no process** — `cancelAgent()` returns false, frontend does nothing, thread stays "running" forever.

2. **Signal-killed processes not handled** — if SIGKILL fires (5s escalation), `s.code()` returns `null` and `s.signal()` returns `9`. The `code === 130` check fails. Thread stays "running".

3. **AGENT_COMPLETED doesn't enforce status** — after `refreshById`, if metadata on disk still says "running" (agent crashed before writing), the thread stays "running" indefinitely.

## Phases

- [x] Phase 1: Fix the root cause (duplicate signal handlers)

- [x] Phase 2: Frontend defense in depth

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix the root cause (duplicate signal handlers)

`agents/src/runner.ts` — Remove the early SIGTERM/SIGINT handlers at lines 310-318.

Before:

```ts
// Register cleanup handlers
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", cleanup);
```

After:

```ts
// Hub disconnect on any exit path (natural, abort, crash)
process.on("exit", cleanup);
```

The `process.on("exit", cleanup)` stays — it handles hub disconnect for all exit paths. The SIGTERM/SIGINT handling is done properly by `setupSignalHandlers()` at line 358, which:

- Aborts the controller → SDK throws AbortError
- Catch block runs `strategy.cleanup(context, "cancelled")` → writes "cancelled" to metadata
- Exits with code 130

### Verification

After this fix, SIGTERM should produce:

- Metadata on disk: `{ status: "cancelled" }`
- Exit code: 130
- Frontend: `code === 130` → `markCancelled()` → thread shows "cancelled" + banner

## Phase 2: Frontend defense in depth

Three changes to handle edge cases (lost events, SIGKILL, agent crashes):

### 2a: Handle all termination signals in agent_close handler

`src/lib/agent-service.ts` — in both `spawnSimpleAgent` and `resumeSimpleAgent` close handlers, expand the cancellation detection:

```ts
// Current: only handles exit code 130
if (code.code === 130) { ... }

// Fixed: also handle signal-based termination (SIGKILL escalation, uncaught SIGTERM)
const wasCancelled = code.code === 130 || code.signal === 15 || code.signal === 9;
if (wasCancelled) {
  await threadService.markCancelled(options.threadId);
  eventBus.emit(EventName.AGENT_CANCELLED, { threadId: options.threadId });
}
```

This handles the SIGKILL escalation path (5s timeout → SIGKILL → signal 9, no exit code).

### 2b: Cancel fallback when process already gone

`src/lib/agent-service.ts` — in `cancelAgent()`, when the invoke returns false (no process found), fall back to marking cancelled directly:

```ts
export async function cancelAgent(threadId: string): Promise<boolean> {
  logger.info(`[agent-service] cancelAgent: ${threadId}`);
  const result = await invoke<boolean>("agent_cancel", { threadId });

  agentProcesses.delete(threadId);
  activeSimpleProcesses.delete(threadId);

  if (!result) {
    // Process already exited — agent_close may have been missed.
    // Force-transition if thread is still "running".
    const thread = threadService.get(threadId);
    if (thread?.status === "running") {
      logger.warn(`[agent-service] cancelAgent: process gone but thread still running, forcing cancelled`);
      await threadService.markCancelled(threadId);
      eventBus.emit(EventName.AGENT_CANCELLED, { threadId });
    }
  }

  return result;
}
```

This is the direct fix for the user's scenario: repeated cancel clicks finding no process.

### 2c: AGENT_COMPLETED safety net for stuck "running" status

`src/entities/threads/listeners.ts` — in the `AGENT_COMPLETED` handler, after `refreshById`, check if the thread is still stuck in "running" and force a terminal status:

```ts
eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId, exitCode }) => {
  try {
    await threadService.refreshById(threadId);

    // Safety net: if metadata on disk still says "running" after the process
    // exited, the agent crashed before writing its final status. Force-transition.
    const thread = threadService.get(threadId);
    if (thread?.status === "running") {
      logger.warn(`[ThreadListener] Thread ${threadId} still "running" after process exit (code=${exitCode}), forcing status`);
      const forcedStatus = exitCode === 130 ? "cancelled" : exitCode === 0 ? "completed" : "error";
      await threadService.setStatus(threadId, forcedStatus);
    }

    // ... rest of handler unchanged
  }
});
```

### Files to modify

| File | Change |
| --- | --- |
| `agents/src/runner.ts` | Remove duplicate SIGTERM/SIGINT handlers (lines 310-318) |
| `src/lib/agent-service.ts` | Expand signal detection in close handlers + cancel fallback |
| `src/entities/threads/listeners.ts` | Safety net in AGENT_COMPLETED handler |
