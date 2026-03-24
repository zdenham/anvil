# Fix: Agents Staying in "Running" State Forever

## Problem

After commit `0965523` ("many new features"), agent threads that spawn sub-agents (Task tool) stay in green "running" state in the UI indefinitely, even after the agent has finished its work. Threads that don't spawn sub-agents exit cleanly.

**Evidence from live system (investigated 2026-02-27):**

| Thread | Prompt | `metadata.status` | `state.status` | PID | PID Alive? | Age |
|---|---|---|---|---|---|---|
| `4224ebaa` | frame rate monitor plan | running | complete | 42883 | YES (+claude 43103) | ~61min |
| `88e44b55` | tauri memory detection | running | complete | 38552 | YES (+claude 38773) | ~63min |
| `03b20d8a` | timelines analysis | running | complete | 20587 | YES (no claude child!) | ~32min |

Additionally, 2 archived threads have live processes that were never killed:
- `7af65cd2` (PID 85648 + claude 85816, 43min) — archived but process still running
- `d62140e6` (PID 7936 + claude 8158, 36min) — archived but process still running

**Key observations:**
- All stuck threads spawned sub-agents via the Task tool — threads without Task usage exit normally
- All stuck threads show `state.status=complete` but `metadata.status=running` — the SDK finished but the runner never exited
- Thread `03b20d8a` has a runner PID alive but **no claude subprocess** — the SDK process may have exited/crashed while the runner hangs on the dead iterator
- Archiving a thread moves the directory but does **not** kill the runner process — separate cleanup needed
- 6 sub-agent threads (spawned by Task tool) completed correctly with consistent state — only parent runner threads are affected
- All runner processes share PPID 98308 (the Tauri Anvil app)

## Root Cause

**`activeBackgroundTasks` counter mismatch in `MessageHandler` prevents the result handler from returning `false`, so the `for-await-of` loop never breaks.**

The bug is in `agents/src/runners/message-handler.ts`. Three methods interact:

### 1. `handleTaskStarted` (line 326) — increments for ALL tasks

```typescript
private handleTaskStarted(msg: SDKTaskStartedMessage): boolean {
    this.activeBackgroundTasks++;  // <-- fires for EVERY task_started, including foreground
```

The SDK emits `task_started` for **all** Task tool invocations — both foreground and background. This handler increments the counter unconditionally.

### 2. `handleTaskNotification` (line 361) — only fires for background tasks

```typescript
private handleTaskNotification(msg: SDKTaskNotificationMessage): boolean {
    this.activeBackgroundTasks = Math.max(0, this.activeBackgroundTasks - 1);
```

The SDK only emits `task_notification` for **background** tasks (`run_in_background: true`). Foreground tasks complete inline as tool results — they never emit `task_notification`. So for foreground tasks, the counter **increments but never decrements**.

### 3. `handleResult` (line 267) — stuck waiting for phantom background tasks

```typescript
case "success": {
    if (!this.foregroundCompleted) {
        this.foregroundCompleted = true;
        await complete({...});  // <-- sets state.status="complete" ✓

        if (this.activeBackgroundTasks > 0) {
            // Background tasks still running — keep iterating
            return true;  // <-- KEEPS THE LOOP OPEN FOREVER
        }
    }
```

When `result:success` arrives, `complete()` is called (setting `state.status="complete"` — which is why we see that on disk). But then `activeBackgroundTasks > 0` (elevated by foreground task_started messages that were never decremented), so it returns `true` instead of `false`.

### The hang sequence

1. Agent spawns a Task sub-agent (foreground) → SDK emits `task_started` → `activeBackgroundTasks++` (now 1)
2. Sub-agent completes → PostToolUse hook handles completion → but **no** `task_notification` → counter stays at 1
3. Agent spawns another Task → counter goes to 2, etc.
4. Agent finishes all work → SDK emits `result:success`
5. `handleResult` calls `complete()` → `state.status = "complete"` written to disk
6. `handleResult` checks `activeBackgroundTasks > 0` → **true** → returns `true`
7. `for await` loop continues, waiting for a second `result:success` that will never come
8. Loop hangs forever → `break` never fires → `finally` block never executes → `result.close()` never called
9. Process stays alive indefinitely, holding PID, CPU, and memory

### Why `result.close()` (already implemented) doesn't help

The `result.close()` call in the `finally` block at `shared.ts:1339` is **unreachable** — the loop never breaks because `handleResult` returns `true`. The fix is correct in principle but the code path is never reached.

## Phases

- [ ] Fix the `activeBackgroundTasks` counter to not count foreground tasks
- [ ] Add safety timeout to `runner.ts` as belt-and-suspenders
- [ ] Verify fix with existing tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix `activeBackgroundTasks` counter

**File:** `agents/src/runners/message-handler.ts`

The simplest correct fix: **don't increment `activeBackgroundTasks` for foreground tasks**. The `task_started` message from the SDK should only affect the counter when it corresponds to a background task.

### Option A: Track foreground tasks and decrement on PostToolUse

In the `PostToolUse` hook for Task completion (`shared.ts:996`), we already detect background vs foreground:

```typescript
const isBackground = !!(taskResponse.task_id || taskResponse.output_file);
```

For foreground tasks, we could decrement the counter. But this requires `MessageHandler` to expose a method, which breaks encapsulation.

### Option B (preferred): Only increment for actual background tasks

The `task_started` message likely has fields that distinguish foreground from background (like a `task_id` or the absence of `tool_use_id`). But even if it doesn't, we can track which tool_use_ids correspond to background tasks.

**Simplest approach:** Don't rely on `task_started` for the counter at all. Instead, only increment when we **know** a task is background — which we learn from the PostToolUse hook detecting `isBackground`.

However, the cleanest fix is to **decrement the counter when a foreground Task completes**. The PostToolUse hook for Task already runs for foreground completions:

**In `shared.ts` PostToolUse hook (around line 996):**

```typescript
if (input.tool_name === "Task") {
    // ... existing code ...
    const isBackground = !!(taskResponse.task_id || taskResponse.output_file);
    if (isBackground) {
        // ... existing background handling ...
        return { continue: true };
    }

    // Foreground task completed — decrement the background task counter
    // that was incorrectly incremented by task_started for this foreground task.
    handler.decrementActiveBackgroundTasks();

    // ... existing foreground completion logic ...
}
```

**In `message-handler.ts`, add a public method:**

```typescript
/** Decrement active background task counter (called when foreground Task completes) */
decrementActiveBackgroundTasks(): void {
    this.activeBackgroundTasks = Math.max(0, this.activeBackgroundTasks - 1);
    logger.debug(
        `[MessageHandler] Foreground task completed, activeBackgroundTasks=${this.activeBackgroundTasks}`
    );
}
```

This is minimal, targeted, and doesn't change the background task flow at all.

## Phase 2: Safety timeout in `runner.ts`

**File:** `agents/src/runner.ts`

As belt-and-suspenders, add an unreffed timeout after `runAgentLoop()` returns to force-exit if cleanup hangs:

```typescript
await runAgentLoop(config, context, agentConfig, priorState, { ... });

// Safety timeout: if cleanup or process.exit hangs, force exit
const exitGuard = setTimeout(() => {
    logger.warn("[runner] Post-loop cleanup timed out, forcing exit");
    process.exit(1);
}, 10_000);
exitGuard.unref(); // Don't prevent natural exit

await strategy.cleanup(context, "completed");
cleanup();
logger.info("[runner] Agent completed successfully");
process.exit(0);
```

The `unref()` ensures this timeout doesn't keep the process alive if everything exits normally, but will fire if something hangs during cleanup.

## Phase 3: Verify with existing tests

Run `cd agents && pnpm test` to ensure existing tests pass with the changes. The `AgentTestHarness` tests spawn real agent processes and will catch regressions.

## Previous spike (canUseTool hypothesis)

The original plan hypothesized that `canUseTool` was the cause. This was incorrect — `canUseTool` may contribute to the subprocess staying alive, but the primary hang is in the `for-await-of` loop never breaking. The existing `result.close()` in the `finally` block and the spike test files (`agents/src/experimental/canuse-hang-spike-*`) can be kept for reference but are not the fix path.
