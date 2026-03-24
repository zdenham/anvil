# Persistent Processes: Surviving App Restarts

## Problem

When the Tauri app restarts, the sidecar (and all its child processes — PTYs and agents) die. Agent processes are spawned with `detached: true` so they *can* outlive the sidecar, but the sidecar's in-memory `Map` tracking them is lost, and PTY sessions are destroyed entirely.

## Design: Detached PTY Holder Processes

Same pattern as agents: spawn a detached child process per PTY that owns the `node-pty` instance and exposes a WebSocket server. The sidecar connects as a client and relays data to/from the frontend. If the sidecar restarts, the PTY holder keeps running and the sidecar reconnects.

```
Before:
  Tauri → Sidecar → node-pty (in-process) → shell
  (sidecar exit kills PTY)

After:
  Tauri → Sidecar ←WS→ PTY Holder (detached) → node-pty → shell
  (sidecar exit ≠ PTY exit; holder keeps running)
```

### PTY Holder Process

A small Node script (`sidecar/src/pty-holder.ts`) that:

1. **Spawns the PTY** using `node-pty` (same setup as current `TerminalManager.spawn()`)
2. **Starts a WebSocket server** on a random port, writes the port to a well-known path (`~/.anvil/pty/{id}.json`)
3. **Relays bidirectionally** — PTY output → WS broadcast, WS messages → PTY stdin
4. **Maintains a scrollback ring buffer** (\~5000 lines) so reconnecting clients can catch up
5. **Exits when the shell exits** — self-cleaning, like agent runners
6. **Self-terminates after idle timeout** if no WS client connects for 30 minutes

The holder writes a manifest file on startup:

```typescript
// ~/.anvil/pty/{id}.json
{
  id: number,
  pid: number,
  port: number,
  cwd: string,
  startedAt: string,
}
```

### TerminalManager Changes

`TerminalManager` changes from owning `IPty` directly to spawning holder processes and connecting to their WebSocket servers:

```typescript
// Current: in-process PTY
const pty = getNodePty().spawn(bin, binArgs, { ... });
pty.onData((data) => broadcaster.broadcast("terminal:output", { id, data }));

// New: spawn detached holder, connect via WS
const holder = spawn("node", [holderScript, ...args], {
  detached: true,
  stdio: "ignore",
});
holder.unref();

// Read port from manifest, connect as WS client
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
ws.on("message", (data) => broadcaster.broadcast("terminal:output", { id, data }));
```

On sidecar startup, `TerminalManager` scans `~/.anvil/pty/` for existing manifests, validates that each PID is still alive, and reconnects to surviving holders. Dead manifests are cleaned up.

### Data Flow

```
User types → Frontend WS → Sidecar → Holder WS → PTY stdin
PTY output → Holder WS → Sidecar → Frontend WS → xterm.js

On sidecar restart:
PTY output → Holder ring buffer (accumulates)
...sidecar starts...
Sidecar reads manifests → connects to holders → gets scrollback replay → resumes streaming
```

### WebSocket Protocol (Sidecar ↔ Holder)

Simple JSON messages:

```typescript
// Holder → Sidecar
{ type: "output", data: string }           // PTY stdout
{ type: "exit", code: number | null }      // shell exited
{ type: "scrollback", lines: string[] }    // sent on connect for replay

// Sidecar → Holder
{ type: "write", data: string }            // stdin
{ type: "resize", cols: number, rows: number }
{ type: "kill" }                           // graceful termination
```

## Phases

- [ ] Phase 1: PTY holder process

- [ ] Phase 2: TerminalManager refactor to WS client

- [ ] Phase 3: Reconnection and scrollback replay

- [ ] Phase 4: PID registry and process discovery

- [ ] Phase 5: Kill safeguards (`anvil kill-all`)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: PTY Holder Process

**Goal:** Standalone Node script that owns a PTY and exposes it over WebSocket.

### New file: `sidecar/src/pty-holder.ts`

Accepts CLI args: `--id`, `--cols`, `--rows`, `--cwd`, `--shell`, `--data-dir`, optional `--command`, `--args`, `--env` (JSON).

1. Spawn PTY using `node-pty` (reuse existing `getNodePty()` + `buildPtyEnv()` logic)
2. Start a WebSocket server on `127.0.0.1:0` (OS-assigned port)
3. Write manifest to `{dataDir}/pty/{id}.json` with `{ id, pid, port, cwd, startedAt }`
4. On WS connection:
   - Send `scrollback` message with buffered lines
   - Forward PTY output as `output` messages
   - Handle `write`, `resize`, `kill` messages
5. On PTY exit: broadcast `exit` message, clean up manifest file, `process.exit()`
6. Idle timeout: if no WS client for 30 min and PTY still alive, self-terminate
7. Set `process.title = "anvil-pty:{id}"`

### Build integration

Add `pty-holder.ts` as an additional entry point in `sidecar/tsup.config.ts` so it gets bundled alongside the main sidecar.

## Phase 2: TerminalManager Refactor

**Goal:** `TerminalManager` spawns holder processes instead of owning PTYs directly.

### Changes to `sidecar/src/managers/terminal-manager.ts`

Replace `TerminalSession` interface:

```typescript
// Before
interface TerminalSession {
  id: number;
  pty: IPty;
  cwd: string;
}

// After
interface TerminalSession {
  id: number;
  pid: number;        // holder process PID
  port: number;       // holder WS port
  ws: WebSocket;      // connection to holder
  cwd: string;
}
```

`spawn()` becomes:

1. Spawn `pty-holder` as detached child (`detached: true`, `stdio: "ignore"`, `.unref()`)
2. Poll for manifest file (holder writes it on startup)
3. Connect to holder's WS server
4. Wire up WS messages to `broadcaster.broadcast()`
5. Return session ID

`write()`, `resize()`, `kill()` send WS messages to the holder instead of calling `pty.write()` etc.

`dispose()` sends `kill` to all holders (or just disconnects — holders self-terminate on idle).

### Remove direct node-pty dependency from TerminalManager

`getNodePty()` and `buildPtyEnv()` move to `pty-holder.ts` (the only place that needs them). TerminalManager no longer imports node-pty.

## Phase 3: Reconnection and Scrollback Replay

**Goal:** Sidecar reconnects to surviving PTY holders on restart.

### Startup scan

On `TerminalManager` construction (or a new `reconnect()` method called from server startup):

1. Read all files in `~/.anvil/pty/*.json`
2. For each manifest, check if PID is alive (`process.kill(pid, 0)`)
3. If alive, connect to the holder's WS port
4. Holder sends `scrollback` message with buffered output
5. Register as an active session in the `sessions` map
6. If PID is dead, delete the stale manifest

### Frontend hydration

When a frontend WS client connects, sidecar sends an inventory that includes reconnected terminals. Frontend creates terminal sessions for them and feeds the scrollback into xterm.js.

The existing `terminal:output` event path handles live data after reconnect — no changes needed on the frontend event listener side, just the initial hydration.

### Scrollback buffer in holder

Ring buffer of \~5000 lines. On new WS client connection, send the full buffer as a single `scrollback` message before streaming live output. This ensures no gap between what was on screen before restart and what appears after.

## Phase 4: PID Registry and Process Discovery

**Goal:** Track all anvil-spawned processes for discovery and cleanup.

### Environment variable tagging

Every process spawned by anvil gets `ANVIL_SESSION_ID`:

```typescript
const SESSION_ID = existingSessionId ?? nanoid();
writeFileSync(join(dataDir, "session-id"), SESSION_ID);
```

Applied to:

- Agent processes (`agent-process-manager.ts`): add to env
- PTY holder processes: add to env
- Child agents: already inherit parent env

### `process.title` labeling

```typescript
// sidecar/src/server.ts
process.title = "anvil-sidecar";

// agents/src/runner.ts
process.title = `anvil-agent:${threadId}`;

// sidecar/src/pty-holder.ts
process.title = `anvil-pty:${id}`;
```

### PID registry on disk

File: `~/.anvil/pids.json`

```typescript
interface PidRegistry {
  sidecar: { pid: number; startedAt: string };
  agents: Record<string, { pid: number; threadId: string; startedAt: string }>;
  terminals: Record<number, { pid: number; sessionId: number; port: number; startedAt: string }>;
}
```

Writers: sidecar on startup, `AgentProcessManager.spawn()`, `TerminalManager.spawn()`. Cleanup: on exit events remove entries, on sidecar startup validate all PIDs.

## Phase 5: Kill Safeguards

**Goal:** User can always kill all anvil processes, even if UI is broken.

### CLI: `anvil kill-all`

```bash
#!/bin/bash
ANVIL_DIR="${ANVIL_DATA_DIR:-$HOME/.anvil}"

echo "Killing all anvil processes..."

# Kill agents (most autonomous)
for pid in $(jq -r '.agents | to_entries[].value.pid' "$ANVIL_DIR/pids.json" 2>/dev/null); do
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
done

# Kill PTY holders
for pid in $(jq -r '.terminals | to_entries[].value.pid' "$ANVIL_DIR/pids.json" 2>/dev/null); do
  kill -TERM "$pid" 2>/dev/null
done

sleep 3

# Kill sidecar last
sidecar_pid=$(jq -r '.sidecar.pid' "$ANVIL_DIR/pids.json" 2>/dev/null)
[ "$sidecar_pid" != "null" ] && kill -TERM "$sidecar_pid" 2>/dev/null

# Fallback: kill by process title
sleep 2
pkill -f "anvil-agent:" 2>/dev/null
pkill -f "anvil-pty:" 2>/dev/null
pkill -f "anvil-sidecar" 2>/dev/null

# Clean up
rm -f "$ANVIL_DIR/pids.json"
rm -f "$ANVIL_DIR/pty/"*.json
echo "Done."
```

### UI kill button

Settings/debug panel button that sends `kill-all` command to sidecar. Sidecar kills all agents, sends `kill` to all PTY holders, then exits.

## Summary of Changes by File

| File | Change |
| --- | --- |
| New: `sidecar/src/pty-holder.ts` | Standalone PTY holder process with WS server |
| `sidecar/src/managers/terminal-manager.ts` | Refactor from in-process PTY to WS client connecting to holders |
| `sidecar/src/managers/agent-process-manager.ts` | Add `ANVIL_SESSION_ID` env, write to PID registry |
| `sidecar/tsup.config.ts` | Add `pty-holder` entry point |
| `sidecar/src/server.ts` | Set `process.title`, startup reconnection scan |
| `agents/src/runner.ts` | Set `process.title` |
| New: `sidecar/src/managers/pid-registry.ts` | PID registry read/write/clean logic |
| New: `~/.anvil/bin/anvil-kill` | CLI kill-all script |
| Frontend reconnection | Hydrate terminal sessions from sidecar inventory on connect |

## Open Questions

1. **Port discovery race:** Holder writes manifest after binding — sidecar needs to poll or holder could write port to stdout before detaching. Polling the manifest file with a short retry loop is simplest.
2. **Multiple sidecar instances?** If two Tauri windows launch, both could try connecting to the same holder. The holder should accept multiple WS clients (broadcast to all). Or enforce single-client with handoff.
3. **Sidecar version mismatch after app update?** Need a version field in the manifest. If mismatch, kill old holder and spawn new one (accepting session loss).