# Fix Background Agent Lifecycle

Background sub-agents spawned via the Task tool with `run_in_background: true` are killed when the parent agent completes. This plan documents the root cause analysis and fix strategy.

## Phases

- [x] Spike 1: Raw SDK background task behavior
- [x] Spike 2: Verify behavior through our actual runner harness
- [x] Spike 3: Upgrade SDK to v0.2.51+ and re-run Spike 2 tests
- [x] Fix: Handle background task lifecycle messages + correct child metadata
- [ ] UI: Background tasks running indicator above input area
- [ ] Cleanup: Mark orphaned sub-agent threads on unexpected exit

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Root Cause (Confirmed Empirically)

### The Kill Chain (on SDK v0.2.39)

```
1. SDK emits result:success (agent's foreground turn is done)
2. MessageHandler.handleResult() returns false        → message-handler.ts:259
3. for-await loop breaks: if (!shouldContinue) break  → shared.ts:1311
4. finally block cleans up (drain, gates, streams)     → shared.ts:1316-1340
5. runAgentLoop() returns to runner.ts
6. strategy.cleanup(context, "completed")              → runner.ts:378
7. cleanup() — hub.disconnect()                        → runner.ts:379
8. process.exit(0) — kills everything                  → runner.ts:382
```

The SDK iterator naturally blocks until all background tasks complete (Spike 1 proved ~19s of blocking for a 20s sleep). But we never give it the chance — `handleResult()` returns `false`, the loop `break`s, and `process.exit(0)` kills background tasks mid-flight.

### Two Bugs

| Bug | Location | What happens |
|-----|----------|-------------|
| Background tasks killed | `message-handler.ts:259` | `return false` breaks the for-await loop early; `process.exit(0)` follows |
| Child metadata lies | `PostToolUse:Task` hook | Fires at tool-return time, marking child `completed` before it runs any tools |

### Evidence

**Spike 1** (raw SDK, no runner) — `agents/src/experimental/background-task-*-runner.ts`:
- SDK iterator blocks ~19s after `result:success` for a `sleep 20` background task
- Signal files always exist when iterator ends — SDK waits for completion
- No special messages during background execution; iterator just blocks longer

**Spike 2** (full runner via AgentTestHarness) — `agents/src/testing/__tests__/background-task-lifecycle.test.ts`:

| Test | durationMs | Signal file | Child metadata | Child state |
|------|-----------|-------------|----------------|-------------|
| Bash `sleep 15` bg | ~12s | missing | completed | status=complete, tools=2 |
| Task agent `sleep 10` bg | ~8s | missing | completed | status=running, tools=0, msgs=1 |

Process exits well before background tasks finish. Child metadata says "completed" but state shows the work never happened.

### Process Lifecycle & Follow-Up Messages

**Architecture today:** 1:1 mapping of threadId → OS process. Tauri spawns a Node process with `--thread-id`. The process registers with AgentHub via Unix socket (`threadId → channel`). If the user sends a follow-up to a running agent, it routes via socket as `queued_message`. If the agent is idle/completed, Tauri spawns a **new process** with `--history-file` to resume from saved state.

**The lingering process cannot accept follow-up messages.** After `result:success`, the SDK is done pulling from our `SocketMessageStream` generator — the conversation turn is over. The SDK is just blocking internally for background tasks, not accepting new user input.

**Two-process overlap is safe:** Emit `thread:status:changed → completed` on `result:success` as today. The old process lingers silently for background tasks (disk I/O only). The frontend sees the thread as idle; follow-ups spawn a new process via standard resume flow. The new process overwrites the hub registration — the old process doesn't need it.

---

## SDK Upgrade: The Likely Fix

### v0.2.45 fixes the core issue upstream

Our SDK is v0.2.39. The changelog for **v0.2.45** states:

> Fixed `Session.stream()` returning prematurely when background subagents are still running, **by holding back intermediate result messages until all tasks complete**

This means on v0.2.45+, the SDK **does not emit `result:success` until background tasks finish**. Our `handleResult()` returning `false` would no longer cause premature exit because the message wouldn't arrive until everything is done.

### Relevant versions between v0.2.39 → v0.2.59

| Version | Change |
|---------|--------|
| **v0.2.45** | `task_started` system message; **fixed `Session.stream()` premature return** by holding back `result:success` |
| **v0.2.47** | `tool_use_id` field on `task_notification` (correlates bg task → parent tool call) |
| **v0.2.51** | `task_progress` events with usage metrics, tool counts, duration; fixed `session.close()` killing subprocess before persist |
| v0.2.53 | `listSessions()` for session discovery |
| v0.2.59 | `getSessionMessages()` for reading session history (latest) |

### New message types available after upgrade

**v0.2.39 (current):** Only `SDKTaskNotificationMessage` (no `tool_use_id`, no `usage`)

**v0.2.51+ (target):** Three new background task message types flow through the iterator:

```typescript
// Emitted when a background task starts
SDKTaskStartedMessage = {
  type: 'system'; subtype: 'task_started';
  task_id: string; tool_use_id?: string;
  description: string; task_type?: string;
}

// Emitted periodically during background task execution
SDKTaskProgressMessage = {
  type: 'system'; subtype: 'task_progress';
  task_id: string; tool_use_id?: string;
  description: string; last_tool_name?: string;
  usage: { total_tokens, tool_uses, duration_ms };
}

// Emitted when a background task completes/fails/stops
SDKTaskNotificationMessage = {
  type: 'system'; subtype: 'task_notification';
  task_id: string; tool_use_id?: string;
  status: 'completed' | 'failed' | 'stopped';
  output_file: string; summary: string;
  usage?: { total_tokens, tool_uses, duration_ms };
}
```

Plus `Query.stopTask(taskId)` for cancelling background tasks.

### Original Hypothesis

> If we upgrade to v0.2.51+ and re-run the Spike 2 tests, the SDK will hold back `result:success` until background tasks finish, and `handleResult()` returning false would be fine because `result:success` now means everything is truly done.

**Verdict: PARTIALLY WRONG.** The SDK does NOT hold back `result:success`. Instead, it emits **two** `result:success` messages — one when foreground is done, one when all background tasks complete. Our `handleResult()` breaks on the first one, never seeing the second. See Spike 3 Results section for details.

---

## Phase 3: Spike 3 — Upgrade SDK and Re-Test (COMPLETED)

See "Spike 3 Results" section above for full details.

---

## Spike 3 Results (SDK v0.2.59)

### Setup

Upgraded SDK from v0.2.39 → v0.2.59 (`pnpm add @anthropic-ai/claude-agent-sdk@^0.2.59`).

### Blocker: `CLAUDECODE` environment variable

SDK v0.2.59 bundles Claude Code CLI v2.1.59, which **refuses to start inside another Claude Code session**. The bundled CLI detects the `CLAUDECODE` environment variable (set by the outer Claude Code process) and errors:

```
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

**Fix for test harness**: Add `CLAUDECODE: undefined` to the env passed to spawned agent processes.

**Fix for production**: Our runner already sets a custom env for child processes. Ensure `CLAUDECODE` is stripped from the env when spawning agents via the SDK.

### Hypothesis: Partially Confirmed

**The v0.2.45 fix DOES apply to `query()`.** But the behavior is different from what was predicted.

#### What actually happens (raw SDK, no runner)

Tested with a minimal `query()` script that does NOT break on `result:success`:

| Time | Message |
|------|---------|
| 6.3s | `task_started` (task_id: br92jzn70) |
| 8.4s | **First `result:success`** — foreground agent done |
| 11.3s | `task_notification` (status: completed, task_id: br92jzn70) |
| 11.3s | New `init` — SDK re-processes the bg task output |
| 23.2s | **Second `result:success`** — everything truly done |
| 23.7s | Iterator exhausted |

**Signal file exists.** The SDK emits **two** `result:success` messages — the first when the foreground agent finishes, the second when all background tasks complete. If you don't break on the first one, the iterator naturally blocks until everything is done.

#### What happens through our runner (Spike 2 re-run)

With `CLAUDECODE` unset, both tests pass but behavior is **unchanged from Spike 2**:

| Test | durationMs | Signal file | Verdict |
|------|-----------|-------------|---------|
| Bash sleep 15 bg | 9.2s | missing | Still exits early |
| Task agent sleep 10 bg | 4.8s | missing | Still exits early |

**Why**: Our `MessageHandler.handleResult()` returns `false` on the **first** `result:success`, breaking the for-await loop. The SDK emits `task_started`, `task_notification`, and a second `result:success` AFTER the first one, but we never see them because we break out.

### New message types confirmed

On SDK v0.2.59, these message types ARE emitted through `query()`:

- **`task_started`** — emitted when background task launches. Fields: `task_id`, `tool_use_id`, `description`, `task_type`
- **`task_notification`** — emitted when background task completes/fails/stops. Fields: `task_id`, `tool_use_id`, `status`, `output_file`, `summary`, `usage`
- **`task_progress`** — not observed in this short test (5s sleep). May require longer-running tasks.

### Revised Fix Strategy

The fix is now clear and simpler than expected:

1. **`MessageHandler.handleResult()`**: Do NOT return `false` on the first `result:success`. Instead, return `true` to keep the iterator running. Track whether there are active background tasks. Only return `false` (break loop) when:
   - `result:success` arrives AND no background tasks are active, OR
   - `result:end_turn` or `result:max_turns` arrives

2. **Handle new message types**: `task_started` increments active background task count, `task_notification` decrements it and updates child metadata.

3. **Process lifecycle**: The SDK handles the "lingering" naturally. The iterator blocks until all tasks complete, then we exit cleanly.

4. **`CLAUDECODE` env var**: Strip from environment in runner and test harness.

---

## Phase 4: Handle Background Task Messages + Metadata

The SDK upgrade alone doesn't fix the exit bug — we must also change how `MessageHandler` handles `result:success`. This phase combines the core loop fix with new message type handling.

### Core fix: Don't break on first result:success

**`MessageHandler.handleResult()`** currently returns `false` unconditionally, breaking the for-await loop. The fix:

1. Track active background task count (incremented by `task_started`, decremented by `task_notification`)
2. On `result:success`: if active bg tasks > 0, return `true` (keep iterating). If 0, return `false` (done).
3. On `result:end_turn` or `result:max_turns`: always return `false`.
4. Emit `thread:status:changed → completed` on the FIRST `result:success` (so UI shows thread as idle immediately)
5. After the iterator exhausts (second `result:success`), proceed to `process.exit(0)` — now safe because everything is done.

### Handle new system message subtypes

Handle three new `system` subtypes in `handleSystem()` or as separate cases:

1. **`task_started`** → Increment active bg task count. Create/update child thread metadata with status `"running"`. Use `tool_use_id` to correlate with `toolUseIdToChildThreadId`. Emit `background_task:started` event to frontend.

2. **`task_progress`** → Update child thread state with progress info (last tool, usage). Emit `background_task:progress` event. This powers the UI indicator.

3. **`task_notification`** → Decrement active bg task count. When `status: "completed"`, update child thread metadata to `"completed"` with correct timestamps and final usage. When `status: "failed"` or `"stopped"`, mark accordingly. Emit `background_task:completed` event. Use `tool_use_id` to find the correct child thread.

### PostToolUse:Task fix

For `run_in_background: true` tasks, `PostToolUse:Task` should NOT mark the child as "completed". Instead, leave status as `"running"` and let `task_notification` handle the real completion. Gate this on whether the tool result indicates `async_launched` vs `completed`.

### CLAUDECODE env var fix

Strip `CLAUDECODE` from the environment passed to the SDK's `query()` call. SDK v0.2.59's bundled CLI v2.1.59 refuses to start if this variable is present (detects nested session). Add to `env` option: `{ ...process.env, CLAUDECODE: undefined }`.

Also fix test harness (`AgentTestHarness`) to strip `CLAUDECODE` from spawned processes.

**Files to change:**
- `agents/src/runners/message-handler.ts` — handle `task_started`, `task_progress`, `task_notification`; fix `handleResult()` to not break on first result:success when bg tasks active
- `agents/src/runners/shared.ts` — PostToolUse:Task: skip premature completion for bg tasks; strip CLAUDECODE env var from query() call
- `agents/src/testing/agent-harness.ts` — strip CLAUDECODE env var from spawned processes

---

## Phase 5: Background Tasks Running Indicator (UI)

**Goal:** Show a persistent indicator above the input area when background sub-agents are running.

**Approach:**
- Forward `background_task:started`, `background_task:progress`, `background_task:completed` events through the hub to the frontend
- Frontend tracks active background tasks per thread in a store
- Show indicator above input when count > 0
- Each item shows: description, progress (last tool, duration), link to child thread
- Cancel button per task (calls `Query.stopTask(taskId)` via hub → agent socket)

---

## Phase 6: Orphaned Sub-Agent Cleanup

**Problem:** If the parent process is killed (SIGKILL, OOM, crash), background tasks die with it. Child thread metadata stuck at `status: "running"` forever.

**Approach:**
- During cleanup (SIGTERM, SIGINT, error paths), sweep `toolUseIdToChildThreadId` and mark remaining children as `"error"`
- On frontend startup, scan for threads with `status: "running"` where parent is `"completed"` or `"error"` — mark as orphaned
- Metadata-only fix; the actual background tasks are already dead if the parent died
