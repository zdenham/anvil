# Fix: Web Interface Crash on Agent Spawn

## Problem

When sending a message from the web interface (non-Tauri), the app crashes with:
```
Uncaught TypeError: Cannot read properties of undefined (reading 'transformCallback')
```

**Root cause**: `agent-service.ts` uses `@tauri-apps/plugin-shell` `Command.create()` / `command.spawn()` directly. These APIs call `new Channel()` internally, which accesses `window.__TAURI_INTERNALS__` — undefined in a browser environment.

The rest of the app correctly guards Tauri APIs via `isTauri()` from `src/lib/runtime.ts` (see `invoke.ts`, `events.ts`), but `agent-service.ts` bypasses this by importing `Command` from the shell plugin directly.

## Phases

- [x] Add `spawn_agent` WS command to the Rust backend
- [x] Route agent spawning through `invoke()` instead of shell plugin
- [x] Handle stdout/stderr/close events via WS push events

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Phase 1: Add `spawn_agent` WS command to the Rust backend

Add a new command to the WS dispatch that spawns a node child process server-side. The Rust backend already spawns processes (terminals), so this follows existing patterns.

**New file**: `src-tauri/src/ws_server/dispatch_agent.rs`

Add a `spawn_agent` command that:
1. Accepts args: `runnerPath`, `commandArgs`, `cwd`, `env`, `threadId`
2. Spawns the node process using `tokio::process::Command`
3. Returns `{ pid }` on success
4. Streams stdout/stderr lines as WS push events: `agent_stdout:{threadId}`, `agent_stderr:{threadId}`
5. Sends `agent_close:{threadId}` push event with exit code/signal on close
6. Stores child handle in `WsState` so `kill_process` still works

Also add a `kill_agent` command that sends SIGINT to the child process (for cancel).

Route in `dispatch.rs`: prefix `agent_` → `dispatch_agent.rs`.

### Phase 2: Route agent spawning through `invoke()` in `agent-service.ts`

Replace the direct `Command.create().spawn()` usage with a call through our `invoke()` wrapper:

```ts
// Before (crashes in browser):
import { Command } from "@tauri-apps/plugin-shell";
const command = Command.create("node", commandArgs, { cwd, env });
command.stdout.on("data", ...);
command.on("close", ...);
const child = await command.spawn();

// After (works in both):
const { pid } = await invoke<{ pid: number }>("spawn_agent", {
  threadId: options.threadId,
  runnerPath,
  commandArgs,
  cwd: options.sourcePath,
  env: envVars,
});
```

This automatically routes through WS in browser and Tauri IPC in desktop (though for now, only the WS path is needed since even Tauri uses the WS server).

### Phase 3: Handle stdout/stderr/close events via WS push

The current `command.stdout.on("data", ...)` pattern needs to be replaced with WS push event listeners:

```ts
// Listen for agent output via the event system
import { listen } from "@/lib/events";

const unlistenStdout = await listen(`agent_stdout:${threadId}`, (event) => {
  handleSimpleAgentOutput(threadId, event.payload.data, stdoutBuffer);
});

const unlistenStderr = await listen(`agent_stderr:${threadId}`, (event) => {
  logger.error("[simple-agent] stderr:", event.payload.data);
});

const unlistenClose = await listen(`agent_close:${threadId}`, (event) => {
  // ... existing close handler logic
  unlistenStdout();
  unlistenStderr();
  unlistenClose();
});
```

The `events.ts` module already handles routing between Tauri events and WS push events, so this works in both environments.

### Same treatment for `resumeSimpleAgent`

`resumeSimpleAgent` (line 881) has the same issue — it also uses `Command.create().spawn()`. Apply identical changes.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/ws_server/dispatch_agent.rs` | **New** — spawn/kill agent commands |
| `src-tauri/src/ws_server/dispatch.rs` | Route `agent_` prefix to new dispatcher |
| `src-tauri/src/ws_server/mod.rs` | Add `dispatch_agent` module, add agent process map to `WsState` |
| `src-tauri/src/ws_server/push.rs` | Forward agent stdout/stderr/close as push events |
| `src/lib/agent-service.ts` | Replace `Command.spawn()` with `invoke("spawn_agent")` + event listeners |

## Alternatives Considered

1. **Guard with `isTauri()` + throw error**: Quick but means web interface can't spawn agents at all — defeats the purpose.
2. **Call node directly from browser via `fetch` to a local HTTP endpoint**: Over-engineered; the WS server already exists.
3. **Only fix `spawnSimpleAgent`, not `resumeSimpleAgent`**: Both have the same bug, both need the fix.
