# Reliable Agent Cancellation

## Problem Statement

Agent cancellation has two issues:

1. **No visual feedback** — when cancelled, the thread just stops. No indicator of what happened.
2. **Cancellation can fail silently** — socket cancel depends on socket health; the SIGTERM fallback depends on PID being in thread metadata. Multiple paths means multiple failure modes.

## Key Insight

Socket cancel (`{ type: "cancel" }`) and SIGTERM both trigger the same handler: `abortController.abort()`. There's no reason to maintain two paths. One reliable path is better than two fragile ones.

```
Socket cancel:  hub message → runner.ts case "cancel" → abortController.abort()
SIGTERM:        OS signal   → setupSignalHandlers()   → abortController.abort()
```

Same result, different transport. SIGTERM is more reliable because it doesn't depend on socket health.

## Current Architecture

```
cancelAgent(threadId)  [agent-service.ts:1028]
  → Path A: isAgentSocketConnected() → cancelAgentSocket() → sendToAgent({ type: "cancel" })
  → Path B: threadService.get(threadId).pid → invoke("kill_process", { pid })  ← SIGTERM only, no escalation
```

Agent side (both paths converge):
```
abortController.abort()
  → SDK query() throws AbortError
  → cancelled() → dispatch({ type: "CANCELLED" }) → writes state to disk
  → strategy.cleanup(context, "cancelled")
  → process.exit(130)
```

Frontend receives `agent_close:{threadId}` event → exit code 130 → `markCancelled()` → `AGENT_CANCELLED`.

## Simplified Design

**One path: always SIGTERM, with auto-escalation to SIGKILL.**

```
User clicks Cancel
  → cancelAgent(threadId)
    → invoke("cancel_agent", { threadId })
      → Rust looks up PID from agent_pids map (always available — Rust spawned the process)
      → SIGTERM → wait up to 5s → SIGKILL if still alive
  → agent's signal handler fires → abort → cleanup → exit(130)
  → frontend gets agent_close event → marks cancelled
```

No socket health check. No branching. No PID lookup from JS-side metadata.

## Phases

- [x] Phase 1: Unified cancel command with SIGKILL escalation
- [x] Phase 2: Visual cancelled feedback

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Unified cancel command with SIGKILL escalation

**Goal**: Replace the two-path cancel with a single Tauri command that always works.

### Why move cancel to Rust

The Rust backend already tracks every agent process in `AgentProcessMap` (populated at spawn time in `dispatch_agent.rs`). This is more reliable than the JS-side PID lookup from thread metadata because:
- It's populated immediately at spawn (no race with disk writes)
- It's in-memory (no disk I/O)
- It's managed by the same process that spawned the agent

### Changes

**`src-tauri/src/ws_server/dispatch_agent.rs`** — store a `Notify` alongside each PID, fire it from the close watcher:

```rust
/// Tracked state for a running agent process.
pub struct AgentProcess {
    pub pid: u32,
    /// Fired by the close watcher when the process exits.
    pub exited: Arc<Notify>,
}

pub type AgentProcessMap = Arc<Mutex<HashMap<String, AgentProcess>>>;
```

In `spawn_agent`, create the `Notify` and store it:
```rust
let exited = Arc::new(Notify::new());
state.agent_processes.lock().await.insert(thread_id.clone(), AgentProcess {
    pid,
    exited: exited.clone(),
});
```

In the close watcher, fire it before removing from the map:
```rust
tokio::spawn(async move {
    let status = child.wait().await;
    exited.notify_waiters();  // wake cancel_agent if it's waiting
    processes.lock().await.remove(&tid);
    // ... broadcast agent_close as before
});
```

**`src-tauri/src/process_commands.rs`** — new `cancel_agent` command using `select!` instead of polling:

```rust
#[tauri::command]
pub async fn cancel_agent(
    thread_id: String,
    process_map: tauri::State<'_, AgentProcessMap>,
) -> Result<bool, String> {
    let entry = process_map.lock().await.get(&thread_id).map(|p| (p.pid, p.exited.clone()));
    let Some((pid, exited)) = entry else {
        return Ok(false); // No process found (already exited)
    };

    // SIGTERM — triggers the agent's graceful shutdown handler
    send_signal(pid, Signal::SIGTERM)?;

    // Race: process exits (event-driven via Notify) vs 5s timeout
    let graceful = tokio::select! {
        _ = exited.notified() => true,
        _ = tokio::time::sleep(Duration::from_secs(5)) => false,
    };

    if !graceful {
        // Still alive — SIGKILL
        send_signal(pid, Signal::SIGKILL)?;
    }

    Ok(true)
}
```

**`src-tauri/src/lib.rs`**:
- Extract `AgentPidMap` creation so it's shared: create it once, clone the `Arc` into both `WsState` and Tauri `.manage(AgentPidMap)`.
- Register `cancel_agent` in the Tauri command handler.

**`src/lib/agent-service.ts`** — simplify `cancelAgent()`:

```ts
export async function cancelAgent(threadId: string): Promise<boolean> {
  logger.info(`[agent-service] cancelAgent: ${threadId}`);
  const result = await invoke<boolean>("cancel_agent", { threadId });

  if (result) {
    agentProcesses.delete(threadId);
    activeSimpleProcesses.delete(threadId);
  }

  return result;
}
```

Remove `cancelAgentSocket()`, `isAgentSocketConnected()` check in cancel path, and the PID-from-metadata fallback. The `{ type: "cancel" }` hub message type can stay in the protocol for potential future use but is no longer used for cancellation.

### Files to modify
- `src-tauri/src/ws_server/dispatch_agent.rs` — replace `AgentPidMap` with `AgentProcessMap` (struct with pid + `Notify`), fire notify from close watcher
- `src-tauri/src/process_commands.rs` — add `cancel_agent` using `select!`-based escalation
- `src-tauri/src/lib.rs` — share `AgentProcessMap` with Tauri state, register command
- `src/lib/agent-service.ts` — simplify `cancelAgent()` to one invoke call

## Phase 2: Visual cancelled feedback

**Goal**: Show the user that cancellation happened, both immediately (button) and permanently (thread history).

### 2a: Optimistic cancel button state

When the user clicks Cancel, immediately swap the button to a disabled "cancelling" state. This is local component state — no new thread status needed.

**`src/components/content-pane/content-pane-header.tsx`**:
- `handleCancel`: set `isCancelling = true` before calling `cancelAgent()`
- Render disabled button with spinner when `isCancelling`
- Reset on thread status change (via effect watching `isStreaming`)

**`src/components/reusable/thread-input.tsx`**:
- Accept `isCancelling` prop
- Swap the cancel square icon for a spinner when true

### 2b: Cancelled banner in thread history

Render a visible `CancelledBanner` based on `status === "cancelled"` (already tracked by the reducer). No new message type needed.

**New: `src/components/thread/cancelled-banner.tsx`**:
- Simple centered divider: muted text "Cancelled" with horizontal rules on each side
- Styled similar to the existing error/completed states

**`src/components/thread/thread-view.tsx`**:
- Render `CancelledBanner` after MessageList when `status === "cancelled"`

### Files to modify
- `src/components/content-pane/content-pane-header.tsx` — optimistic button state
- `src/components/reusable/thread-input.tsx` — accept `isCancelling` prop
- `src/components/thread/thread-view.tsx` — render banner
- New: `src/components/thread/cancelled-banner.tsx`

## What we're removing

The current plan proposed 4 phases with staged protocols, polling loops, and socket+SIGTERM+SIGKILL cascades. This version removes:

- **Socket cancel path** — SIGTERM does the same thing, more reliably
- **Socket connectivity check** — no longer needed
- **JS-side PID lookup from thread metadata** — Rust already has the PID
- **Staged cancellation protocol** — no stages, just one command
- **`waitForAgentExit()` polling** — Rust handles the wait internally
- **Separate "timeout + force-kill" phase** — built into the single command

## Risks

1. **SIGKILL data loss** — if escalation reaches SIGKILL, the agent won't write final state. Acceptable as a last resort; the last incremental disk write is still valid.
2. **AgentProcessMap sharing** — requires extracting the map creation so both WsState and Tauri managed state hold a clone. This is a small refactor to `lib.rs`.
3. **Child process orphans** — SIGTERM only hits the parent PID. If this becomes an issue, we can enhance `cancel_agent` to use `killpg` (process group kill) instead of `kill`. Not needed initially since agent child processes (sub-agents) are spawned by the Rust side and tracked in the same PID map.
