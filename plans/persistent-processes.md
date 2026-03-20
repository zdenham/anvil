# Persistent Processes: Surviving App Restarts

## Problem

When the Tauri app restarts, the sidecar (and all its child processes — PTYs and agents) die. Agent processes are spawned with `detached: true` so they *can* outlive the sidecar, but the sidecar's in-memory `Map` tracking them is lost, and PTY sessions are destroyed entirely.

## Feasibility Assessment

**Agents: Very feasible.** The groundwork is already laid:

- Agents persist state to disk (`state.json`, `metadata.json`) before any socket emission
- Hub client has reconnection logic with exponential backoff
- Agents already survive hub disconnects — they keep running, write to disk only, and resync on reconnect
- `sessionId` is persisted, enabling SDK conversation continuity across restarts

**PTY sessions: Harder, but feasible.** node-pty doesn't support "adopting" an existing PTY fd. Two viable approaches:

1. **Sidecar-as-daemon** — the sidecar outlives Tauri, PTYs survive because their owner survives
2. **PTY multiplexer** — use `screen`/`tmux` underneath, reconnect to named sessions

**Recommendation:** Option 1 (sidecar-as-daemon) is simpler and solves both agents AND PTYs in one move.

## Design: Sidecar as Long-Lived Daemon

### Core Idea

Decouple the sidecar's lifecycle from Tauri's lifecycle. The sidecar becomes a standalone daemon that:

- Starts on first Tauri launch (or first need)
- Keeps running across Tauri restarts
- Owns all PTY sessions and agent process references
- Tauri connects/reconnects to it via the existing WebSocket protocol

### Architecture Change

```
Before:
  Tauri → spawns → Sidecar → spawns → Agents/PTYs
  (Tauri exit kills sidecar, kills PTYs, orphans agents)

After:
  Tauri → connects to → Sidecar (daemon) → spawns → Agents/PTYs
  (Tauri exit ≠ sidecar exit; everything survives)
```

## Phases

- [ ] Phase 1: Sidecar daemonization

- [ ] Phase 2: PID registry and descendant labeling

- [ ] Phase 3: Kill safeguards (`mort kill-all`)

- [ ] Phase 4: Tauri reconnection on restart

- [ ] Phase 5: Stale process cleanup

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Sidecar Daemonization

**Goal:** Sidecar outlives Tauri restarts.

### Changes to `src-tauri/src/lib.rs` (`spawn_sidecar`)

The existing health-check-first pattern already handles this partially — if the sidecar is already running, it skips spawning. We need to:

1. **Detach the sidecar from Tauri's process group.** Currently spawned as a direct child. On macOS, use `pre_exec` to call `setsid()` so the sidecar becomes its own session leader:

```rust
use std::os::unix::process::CommandExt;

let child = Command::new("node")
    .arg(&server_path)
    .env(...)
    .stdout(Stdio::piped())  // still pipe for health-check startup
    .stderr(Stdio::piped())
    .pre_exec(|| { libc::setsid(); Ok(()) })  // new session
    .spawn()?;
```

2. **Write the sidecar PID to disk** at `~/.mort/sidecar.pid` after successful health check. This is the anchor for all descendant tracking.

3. **Don't kill sidecar on Tauri exit.** Remove the `SidecarProcess` cleanup. Since the child is in its own session, Tauri exiting won't signal it.

4. **Sidecar writes its own PID file** on startup (`sidecar/src/server.ts`):

```typescript
import { writeFileSync } from "node:fs";
writeFileSync(join(dataDir, "sidecar.pid"), String(process.pid));
```

5. **On startup, Tauri checks health first** (already does this), reconnects to the existing sidecar. No change needed here.

### Changes to sidecar shutdown

Currently the sidecar shuts down on SIGTERM/SIGINT. Keep this — but it should only happen on *explicit* kill, not on Tauri exit. Since we detach the process group, Tauri's exit won't send SIGTERM to the sidecar.

## Phase 2: PID Registry and Descendant Labeling

**Goal:** Track all mort-spawned processes so they can be discovered and killed.

### Environment Variable Tagging

Every process spawned by mort gets a `MORT_SESSION_ID` environment variable. This is the label that ties all descendants together.

```typescript
// Generated once per sidecar lifetime, persisted to disk
const SESSION_ID = existingSessionId ?? nanoid();
writeFileSync(join(dataDir, "session-id"), SESSION_ID);
```

All spawned processes inherit it:

- **Agent processes** (`agent-process-manager.ts` line 32): add `MORT_SESSION_ID` to env
- **PTY sessions** (`terminal-manager.ts` line 39): add `MORT_SESSION_ID` to env
- **Child agents** (`child-spawner.ts`): already inherits parent env, so gets it automatically

### Discovery via `ps`

Any process with `MORT_SESSION_ID` in its environment can be found:

```bash
# macOS: find all mort processes
ps -eo pid,ppid,command | while read pid ppid cmd; do
  if [ -f /proc/$pid/environ ] 2>/dev/null || \
     strings /proc/$pid/environ 2>/dev/null | grep -q MORT_SESSION_ID; then
    echo "$pid $ppid $cmd"
  fi
done
```

On macOS (no `/proc`), we rely on the PID registry instead.

### PID Registry on Disk

File: `~/.mort/pids.json`

```typescript
interface PidRegistry {
  sidecar: { pid: number; startedAt: string };
  agents: Record<string, { pid: number; threadId: string; startedAt: string }>;
  terminals: Record<number, { pid: number; sessionId: number; startedAt: string }>;
}
```

**Writers:**

- Sidecar writes its own entry on startup
- `AgentProcessManager.spawn()` writes agent entries
- `TerminalManager.spawn()` writes terminal entries (node-pty exposes `pty.pid`)
- All writers use read-modify-write with the existing disk-as-truth pattern

**Cleanup:**

- On process exit/close events, remove the entry
- On sidecar startup, validate all existing PIDs (check if process exists, remove stale entries)

### Process Group Tracking

Agent processes are already spawned with `detached: true`, making each one a process group leader. The PGID equals the PID. This means `kill(-pid, SIGTERM)` already kills the entire subtree (which the code already does).

For PTY processes, `node-pty` spawns with its own process group internally — `pty.pid` gives the leader PID.

### `process.title` Labeling

Set `process.title` on all Node processes for easy `ps` identification:

```typescript
// sidecar/src/server.ts
process.title = "mort-sidecar";

// agents/src/runner.ts
process.title = `mort-agent:${threadId}`;
```

This makes `ps aux | grep mort-` instantly show all mort processes with their roles.

## Phase 3: Kill Safeguards

**Goal:** User can always kill all mort processes manually, even if the UI is frozen/crashed.

### CLI Command: `mort kill-all`

Add a kill subcommand (or standalone script at `~/.mort/bin/mort-kill`):

```bash
#!/bin/bash
# ~/.mort/bin/mort-kill
# Kill all mort processes gracefully, with SIGKILL escalation

MORT_DIR="${MORT_DATA_DIR:-$HOME/.mort}"
PID_FILE="$MORT_DIR/pids.json"

echo "Killing all mort processes..."

# 1. Read PID registry
if [ -f "$PID_FILE" ]; then
  # Kill agents first (they're the most autonomous)
  for pid in $(jq -r '.agents | to_entries[].value.pid' "$PID_FILE" 2>/dev/null); do
    echo "  Killing agent process group -$pid"
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  done

  # Kill terminal PTYs
  for pid in $(jq -r '.terminals | to_entries[].value.pid' "$PID_FILE" 2>/dev/null); do
    echo "  Killing terminal $pid"
    kill -TERM "$pid" 2>/dev/null
  done

  # Wait 3s for graceful shutdown
  sleep 3

  # Kill sidecar last
  sidecar_pid=$(jq -r '.sidecar.pid' "$PID_FILE" 2>/dev/null)
  if [ "$sidecar_pid" != "null" ] && [ -n "$sidecar_pid" ]; then
    echo "  Killing sidecar $sidecar_pid"
    kill -TERM "$sidecar_pid" 2>/dev/null
  fi
fi

# 2. Fallback: kill by process title
sleep 2
pkill -f "mort-agent:" 2>/dev/null
pkill -f "mort-sidecar" 2>/dev/null

# 3. Nuclear option: SIGKILL anything remaining
sleep 1
pkill -9 -f "mort-agent:" 2>/dev/null
pkill -9 -f "mort-sidecar" 2>/dev/null

# 4. Clean up PID file
rm -f "$PID_FILE"
echo "Done."
```

### UI Kill Button

Add a "Kill All Processes" button in the app settings/debug panel that:

1. Sends a `kill-all` command to the sidecar via WebSocket
2. Sidecar iterates `agentProcesses.list()` and `terminalManager.list()`, kills each
3. Then kills itself

### Watchdog / Heartbeat

The sidecar should auto-exit if no Tauri frontend has connected for a configurable duration (e.g., 30 minutes). This prevents zombie sidecars:

```typescript
let lastFrontendHeartbeat = Date.now();
const ZOMBIE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

// Updated on every frontend WebSocket message
wss.on("connection", () => { lastFrontendHeartbeat = Date.now(); });

setInterval(() => {
  if (Date.now() - lastFrontendHeartbeat > ZOMBIE_TIMEOUT_MS) {
    if (agentProcesses.list().length === 0 && terminalManager.list().length === 0) {
      logger.info("No frontend connection and no active processes — self-terminating");
      shutdown("zombie-timeout");
    }
  }
}, 60_000);
```

Important: only self-terminate if there are no active agents or terminals. If agents are running, the sidecar should stay alive regardless.

## Phase 4: Tauri Reconnection on Restart

**Goal:** When Tauri restarts, seamlessly reconnect to existing sidecar and restore UI state.

### Frontend Reconnection

The frontend WebSocket client (`src/lib/event-bridge.ts` or equivalent) needs:

1. **Reconnect on open** — detect that the sidecar is already running (health check succeeds) and connect
2. **Request full state hydration** — send a `hydrate` request to the sidecar
3. **Sidecar responds with current state** — active agents (threadIds, statuses), active terminals (sessionIds)

### Agent State Recovery

Agents already handle this:

- They persist state to disk continuously
- On hub reconnect, they emit full state via `emitState()` → HYDRATE action
- The frontend entity stores receive this and update

The missing piece: agents that were running while Tauri was down need to be "re-discovered." The sidecar knows about them (it spawned them), so on frontend reconnect:

```typescript
// Sidecar handler for new frontend connections
wss.on("connection", (socket) => {
  // Send current process inventory
  socket.send(JSON.stringify({
    type: "inventory",
    agents: agentProcesses.list(), // threadIds
    terminals: terminalManager.list(), // sessionIds
  }));
});
```

### Terminal Session Recovery

PTY sessions survive because the sidecar survives. Terminal output that occurred while Tauri was down is lost (scrollback not persisted). Options:

1. **Accept lost scrollback** — simplest, the terminal is still alive and responsive
2. **Ring buffer** — sidecar keeps last N lines per terminal in memory, sends on reconnect
3. **Scrollback file** — write terminal output to a file, frontend replays on reconnect

Recommend option 2 (ring buffer of \~5000 lines) as a good balance.

## Phase 5: Stale Process Cleanup

**Goal:** Handle crash scenarios where PID files reference dead processes.

### On Sidecar Startup

```typescript
function cleanStalePids(registry: PidRegistry): PidRegistry {
  // Check each registered PID
  for (const [id, entry] of Object.entries(registry.agents)) {
    if (!isProcessAlive(entry.pid)) {
      delete registry.agents[id];
      // Also update thread metadata.json to "error" status if still "running"
    }
  }
  // Same for terminals
  return registry;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}
```

### PID Reuse Protection

PIDs can be reused by the OS. To prevent killing an innocent process:

1. Store `startedAt` timestamp in the PID registry
2. Before killing, verify the process start time matches (on macOS: `ps -p $PID -o lstart=`)
3. Alternatively, check that the process command line contains `mort` identifiers

## Summary of Changes by File

| File | Change |
| --- | --- |
| `src-tauri/src/lib.rs` | Detach sidecar (setsid), remove cleanup-on-exit, write PID |
| `sidecar/src/server.ts` | Write PID file, set `process.title`, add zombie timeout, ring buffer for terminal output |
| `sidecar/src/state.ts` | Add PID registry to state, add session ID |
| `sidecar/src/managers/agent-process-manager.ts` | Write PIDs to registry, set `MORT_SESSION_ID` env, remove entries on exit |
| `sidecar/src/managers/terminal-manager.ts` | Write PIDs to registry, set `MORT_SESSION_ID` env, add scrollback ring buffer |
| `agents/src/runner.ts` | Set `process.title` |
| New: `~/.mort/bin/mort-kill` | CLI kill-all script |
| New: `sidecar/src/managers/pid-registry.ts` | PID registry read/write/clean logic |
| Frontend reconnection logic | Request inventory on connect, replay terminal scrollback |

## Open Questions

1. **Should the sidecar auto-start on macOS login?** (launchd plist) — probably not initially, just on first Tauri launch
2. **Multiple Tauri windows connecting to same sidecar?** — already supported by the WebSocket architecture
3. **Sidecar version mismatch after app update?** — need a version handshake; if mismatch, gracefully restart sidecar
4. **Should** `mort kill-all` **be a Tauri command or a standalone script?** — both: UI button + standalone script for when UI is broken