# Repl Cancellation Propagation

## Problem

When a parent agent is cancelled (via UI or SIGTERM), its repl-spawned children — and their descendants — may continue running, consuming tokens and money.

## Cancellation Model

**There is one cancellation path: SIGTERM.**

```
UI cancel → Rust agent_cancel → SIGTERM (to process / process group)
                                   ↓ (within each process)
                              setupSignalHandlers catches SIGTERM
                                   ↓
                              abortController.abort()
                                   ↓
                              SDK query() iterator stops, process exits 130
```

AbortSignal is an internal consequence of SIGTERM within each process — not a separate entry point. The socket `{ type: "cancel" }` message that currently calls `abortController.abort()` directly should be removed. All cancellation flows through SIGTERM.

## Research Findings

### Architecture Summary

**Current cancel entry point:**

| Path | Trigger | Mechanism | Reaches children? |
|---|---|---|---|
| **Tauri IPC** | UI `cancelAgent(threadId)` → `invoke("agent_cancel")` | Rust looks up PID in `AgentProcessMap`, sends `kill(pid, SIGTERM)` | **No** — children not in map |

**Note**: A socket cancel path (`cancelAgentSocket`) also exists but should be removed — it bypasses SIGTERM and calls `abortController.abort()` directly, creating a second entry point.

**Three cancel mechanisms in the Rust layer:**

1. `process_commands::agent_cancel` — Tauri IPC command, uses `AgentProcessMap`
2. `dispatch_agent::cancel_agent` — WS command, uses same `AgentProcessMap` (shared `Arc<Mutex<...>>` from `lib.rs:761`)
3. `process_commands::kill_process` — direct PID kill, SIGTERM only

All three use `send_signal(pid, SignalKind)` which calls `nix::sys::signal::kill(Pid::from_raw(pid as i32), sig)`.

### Process Group Analysis

**Current PGID chain:**
```
Rust Tauri app (PID=100, PGID=100)  ← session leader
  └─ Node parent agent (PID=200, PGID=100)  ← inherits Rust's PGID
       └─ Node child agent (PID=300, PGID=100)  ← inherits same PGID
```

**Problem**: `kill(-200, SIGTERM)` fails with ESRCH because PGID=200 doesn't exist. All processes share PGID=100 (Rust app). Sending `kill(-100, SIGTERM)` would kill the Rust app too.

**Fix**: Spawn parent agents with `process_group(0)` in `dispatch_agent::spawn_agent`. This gives each agent tree its own PGID:
```
Rust Tauri app (PID=100, PGID=100)
  └─ Node parent agent (PID=200, PGID=200)  ← own process group
       └─ Node child agent (PID=300, PGID=200)  ← inherits parent's PGID
            └─ Node grandchild (PID=400, PGID=200)  ← same PGID, any depth
```

Now `kill(-200, SIGTERM)` kills the entire tree without touching Rust.

### Key Code Locations

| What | File | Line(s) |
|---|---|---|
| `send_signal` (single PID) | `src-tauri/src/process_commands.rs` | 55-80 |
| `agent_cancel` (Tauri IPC) | `src-tauri/src/process_commands.rs` | 16-48 |
| `cancel_agent` (WS) | `src-tauri/src/ws_server/dispatch_agent.rs` | 191-226 |
| `spawn_agent` (needs `process_group(0)`) | `src-tauri/src/ws_server/dispatch_agent.rs` | 50-70 |
| AgentProcessMap type | `src-tauri/src/ws_server/dispatch_agent.rs` | 16-28 |
| `ChildSpawner` class | `agents/src/lib/anvil-repl/child-spawner.ts` | 25-282 |
| `setupSignalHandlers` | `agents/src/runners/shared.ts` | 231-263 |
| Cancel message handler (to remove) | `agents/src/runner.ts` | 250-253 |
| `cancelAgent` (frontend) | `src/lib/agent-service.ts` | 1025-1045 |
| `cancelAgentSocket` (frontend, to remove) | `src/lib/agent-service.ts` | 346-349 |
| `SpawnOptions` type | `agents/src/lib/anvil-repl/types.ts` | 25-28 |

---

## Implementation Plan

### Phase 1: Process Group Kill (highest impact, Rust-only)

**Goal**: When parent agent is cancelled via SIGTERM, all descendants die automatically.

#### 1a. Spawn agents in own process group

**File**: `src-tauri/src/ws_server/dispatch_agent.rs`

In `spawn_agent`, add `process_group(0)` before `.spawn()`:

```rust
// After line 66 (.stderr), before .spawn():
#[cfg(unix)]
{
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
}
```

This makes each agent the leader of its own process group (PGID = agent PID). All children spawned with `detached: false` inherit this PGID.

**Note**: `tokio::process::Command` exposes `process_group()` via `CommandExt` on Unix. On Windows, this is a no-op (Windows uses job objects, not PGIDs).

#### 1b. Add process-group kill function

**File**: `src-tauri/src/process_commands.rs`

Add alongside existing `send_signal`:

```rust
/// Send a signal to the entire process group led by `pid`.
/// On Unix, this uses kill(-pid, sig) to target all processes in the group.
pub fn send_signal_to_group(pid: u32, signal: SignalKind) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        let sig = match signal {
            SignalKind::Term => Signal::SIGTERM,
            SignalKind::Kill => Signal::SIGKILL,
        };

        // Negative PID sends signal to the process group
        match kill(Pid::from_raw(-(pid as i32)), sig) {
            Ok(_) => {
                tracing::info!(pid = %pid, signal = ?sig, "Sent signal to process group");
                Ok(true)
            }
            Err(nix::errno::Errno::ESRCH) => {
                tracing::warn!(pid = %pid, "Process group not found (already exited)");
                Ok(false)
            }
            Err(e) => {
                tracing::error!(pid = %pid, error = %e, "Failed to send signal to group");
                Err(format!("Failed to send group signal: {}", e))
            }
        }
    }

    #[cfg(windows)]
    {
        // taskkill /T kills the process tree
        let output = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|e| format!("Failed to run taskkill: {}", e))?;

        Ok(output.status.success())
    }
}
```

#### 1c. Update both cancel paths to use group kill

**File**: `src-tauri/src/process_commands.rs` — `agent_cancel` function

Change line 32: `send_signal(pid, SignalKind::Term)?` → `send_signal_to_group(pid, SignalKind::Term)?`
Change line 42: `send_signal(pid, SignalKind::Kill)` → `send_signal_to_group(pid, SignalKind::Kill)`

**File**: `src-tauri/src/ws_server/dispatch_agent.rs` — `cancel_agent` function

Change line 210: `send_signal(pid, ...)` → `send_signal_to_group(pid, ...)`
Change line 220: `send_signal(pid, ...)` → `send_signal_to_group(pid, ...)`

### Phase 2: Remove Socket Cancel Path

**Goal**: Eliminate the second cancellation entry point. All cancellation goes through SIGTERM.

#### 2a. Remove cancel message handler from runner.ts

**File**: `agents/src/runner.ts` — lines ~250-253

Remove (or no-op) the `{ type: "cancel" }` socket message handler that calls `abortController.abort()`. The process will receive SIGTERM directly from Rust, which triggers `setupSignalHandlers` → `abortController.abort()`.

#### 2b. Remove `cancelAgentSocket` from frontend

**File**: `src/lib/agent-service.ts`

Remove the `cancelAgentSocket` function (lines ~346-349) and any callers. The frontend's `cancelAgent` should only use the Tauri IPC path (`invoke("agent_cancel")`).

#### 2c. Register child PIDs in AgentProcessMap

**Goal**: Ensure Rust can SIGTERM individual children (e.g., user clicks cancel on a child thread in the sidebar).

Children spawned by `ChildSpawner` have PIDs but they're not in the Rust `AgentProcessMap`. Two options:

**Option A (simpler)**: Have children self-register via hub socket. When a child runner starts, it sends a `{ type: "register_pid", threadId, pid: process.pid }` message to the hub. The hub forwards this to Rust to insert into `AgentProcessMap`.

**Option B**: Have `ChildSpawner` emit a `child:spawned` event with the PID, which propagates to Rust via the parent's hub connection.

Either way, the result is that `agent_cancel(childThreadId)` finds the child's PID in the map and sends SIGTERM to it directly.

### Phase 3: Per-Child Wall-Clock Timeout (Safety Net)

**Goal**: Prevent runaway children that somehow survive SIGTERM.

#### 3a. Add `timeoutMs` to SpawnOptions

**File**: `agents/src/lib/anvil-repl/types.ts`

```typescript
export interface SpawnOptions {
  prompt: string;
  contextShortCircuit?: ContextShortCircuit;
  timeoutMs?: number;  // default 600_000 (10 min), wall-clock from spawn
}
```

#### 3b. Implement timeout in ChildSpawner.waitForResult

**File**: `agents/src/lib/anvil-repl/child-spawner.ts`

Wrap the exit promise with a timeout race:

```typescript
private async waitForResult(
  child: ReturnType<typeof spawnProcess>,
  childThreadId: string,
  childThreadPath: string,
  timeoutMs: number = 600_000,
): Promise<string> {
  const startTime = Date.now();

  const exitCode = await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn(`[anvil-repl] Child ${childThreadId} timed out after ${timeoutMs}ms, killing`);
      try { process.kill(child.pid!, "SIGTERM"); } catch { /* already exited */ }
      setTimeout(() => {
        try { process.kill(child.pid!, "SIGKILL"); } catch { /* already exited */ }
      }, 5000);
    }, timeoutMs);

    child.on("exit", (code) => { clearTimeout(timer); resolve(code ?? 1); });
    child.on("error", (err) => {
      clearTimeout(timer);
      logger.error(`[anvil-repl] Child process error: ${err}`);
      resolve(1);
    });
  });

  // ... rest unchanged ...
}
```

Update `spawn()` to pass `timeoutMs`:
```typescript
return this.waitForResult(child, childThreadId, childThreadPath, options.timeoutMs);
```

### Phase 4: Pass --parent-id to Children for Hub Hierarchy

**Goal**: Fix the gap where children don't register their parent relationship with the hub, enabling future hub-based tree operations.

**File**: `agents/src/lib/anvil-repl/child-spawner.ts` — `spawnProcess`

Add `--parent-id` to the args array:

```typescript
const args = [
  runnerPath,
  "--thread-id", childThreadId,
  "--parent-id", this.context.threadId,  // ← add (for HubClient hierarchy)
  "--parent-thread-id", this.context.threadId,
  // ... rest unchanged
];
```

This makes the child's HubClient register with `parentId`, so the hub's hierarchy map correctly tracks the relationship.

---

## Phases

- [x] 1: Spawn agents with `process_group(0)` and use group kill in `agent_cancel`
- [x] 2: Remove socket cancel path, register child PIDs in AgentProcessMap for individual child cancel
- [x] 3: Add per-child wall-clock timeout with SIGTERM → SIGKILL escalation
- [x] 4: Pass --parent-id to children for hub hierarchy tracking

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Priority

**Phase 1 alone fixes the most dangerous scenario**: user clicks cancel, parent dies, children keep burning tokens. It's a Rust-only change (~20 lines) that kills the entire process tree via process group SIGTERM.

**Phase 2** removes the socket cancel backdoor and ensures individual child cancel works via SIGTERM (by registering child PIDs in AgentProcessMap).

**Phase 3-4** are safety nets and housekeeping.
