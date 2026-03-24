# Add TerminalManager and FileWatcherManager to Sidecar

## Context

The sidecar is missing two stateful manager classes that the Rust Tauri backend provides: **TerminalManager** (PTY sessions via `node-pty`) and **FileWatcherManager** (directory watching via `chokidar`). These correspond to Wave 2 commands in the consolidation plan (Phase B2) — 6 terminal commands and 3 file watcher commands.

The Rust reference implementations live at:

- `src-tauri/src/terminal.rs` — PTY session pool, reader threads, shell integration
- `src-tauri/src/file_watcher.rs` — debounced directory watchers, cleanup-on-drop

Both follow the same pattern as the existing `AgentProcessManager`: a class with a private `Map`, lifecycle methods, and event broadcasting via `EventBroadcaster`.

## Phases

- [x] Add TerminalManager (`sidecar/src/managers/terminal-manager.ts`)

- [x] Add FileWatcherManager (`sidecar/src/managers/file-watcher-manager.ts`)

- [x] Wire dispatch and state

- [x] Add tests

- [x] Verify build

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: TerminalManager

Create `sidecar/src/managers/terminal-manager.ts` (&lt;250 lines).

### Dependencies

Add `node-pty` to `sidecar/package.json`. This is the same library VS Code uses for terminal emulation.

### Class Design

```typescript
export class TerminalManager {
  private sessions = new Map<number, TerminalSession>();
  private nextId = 1;

  spawn(cols: number, rows: number, cwd: string, broadcaster: EventBroadcaster): number
  write(id: number, data: string): void
  resize(id: number, cols: number, rows: number): void
  kill(id: number, broadcaster: EventBroadcaster): void
  killByCwd(cwd: string, broadcaster: EventBroadcaster): number[]
  list(): number[]
  dispose(): void  // kill all sessions — called on sidecar shutdown
}
```

### Behavior (mirroring `terminal.rs`)

`spawn`: Create a PTY via `node-pty`, spawn the user's `$SHELL` (default `/bin/zsh`) with `-l` flag. Set environment: `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG/LC_ALL=en_US.UTF-8`, propagate `HOME`, `USER`, `PATH`. For zsh, set `ZDOTDIR` to `~/.anvil/data/shell-integration/zsh` (same as Rust). Wire `pty.onData()` to broadcast `terminal:output` with `{id, data}`. Wire `pty.onExit()` to broadcast `terminal:exit` with `{id}` and clean up the session. Return the session ID.

`write`: Get session by ID, call `pty.write(data)`. Throw if not found.

`resize`: Get session by ID, call `pty.resize(cols, rows)`. Throw if not found.

`kill`: Remove session, call `pty.kill()`, broadcast `terminal:killed` with `{id}`.

`killByCwd`: Filter sessions by `cwd`, kill each, return killed IDs.

`list`: Return `Array.from(sessions.keys())`.

`dispose`: Kill all sessions (no broadcast needed — used on shutdown).

### Events (via `EventBroadcaster`)

- `terminal:output` — `{ id: number, data: string }` (node-pty gives strings, not byte arrays)
- `terminal:exit` — `{ id: number }`
- `terminal:killed` — `{ id: number }`

---

## Phase 2: FileWatcherManager

Create `sidecar/src/managers/file-watcher-manager.ts` (&lt;250 lines).

### Dependencies

Add `chokidar` to `sidecar/package.json`.

### Class Design

```typescript
export class FileWatcherManager {
  private watchers = new Map<string, FSWatcher>();

  start(watchId: string, path: string, recursive: boolean, broadcaster: EventBroadcaster): void
  stop(watchId: string): void
  list(): string[]
  dispose(): void  // close all watchers — called on sidecar shutdown
}
```

### Behavior (mirroring `file_watcher.rs`)

`start`: If `watchId` already exists, close the old watcher first (prevent duplicates). Create a chokidar watcher with `{ depth: recursive ? undefined : 0, ignoreInitial: true }`. Debounce change events (200ms, matching Rust) — collect changed paths, then broadcast `file-watcher:changed` with `{ watchId, changedPaths }`. Store the watcher.

`stop`: Get watcher by ID, call `watcher.close()`, remove from map.

`list`: Return `Array.from(watchers.keys())`.

`dispose`: Close all watchers.

### Debounce Strategy

Chokidar fires per-file events. To match the Rust 200ms debounce behavior, batch events: on each `change`/`add`/`unlink` event, collect the path into a Set and reset a 200ms timer. When the timer fires, broadcast the collected paths and clear the Set.

### Events (via `EventBroadcaster`)

- `file-watcher:changed` — `{ watchId: string, changedPaths: string[] }`

---

## Phase 3: Wire Dispatch and State

### Update `sidecar/src/state.ts`

Add both managers to `SidecarState` interface and `createState()`:

```typescript
terminalManager: TerminalManager;
fileWatcherManager: FileWatcherManager;
```

### Update `sidecar/src/dispatch.ts`

Add prefix routing for terminal commands. File watcher commands go through `dispatchMisc` (only 3 commands, not worth a separate dispatcher).

```typescript
if (cmd.startsWith("terminal_") || cmd === "spawn_terminal" || ...) {
  return dispatchTerminal(cmd, args, state);
}
```

Or, since the Rust commands use names like `spawn_terminal`, `write_terminal`, etc. (no shared prefix), route them in `dispatchMisc`. Choose based on which keeps files under 250 lines — if `dispatch-misc.ts` is already 376 lines, a separate `dispatch-terminal.ts` is required.

### Create `sidecar/src/dispatch/dispatch-terminal.ts`

Handle 6 terminal commands + 3 file watcher commands (9 total, well under 250 lines):

| Command | Args | Returns |
| --- | --- | --- |
| `spawn_terminal` | `{cols, rows, cwd}` | `number` (terminal ID) |
| `write_terminal` | `{id, data}` | `null` |
| `resize_terminal` | `{id, cols, rows}` | `null` |
| `kill_terminal` | `{id}` | `null` |
| `kill_terminals_by_cwd` | `{cwd}` | `number[]` (killed IDs) |
| `list_terminals` | `{}` | `number[]` |
| `start_watch` | `{watchId, path, recursive}` | `null` |
| `stop_watch` | `{watchId}` | `null` |
| `list_watches` | `{}` | `string[]` |

### Shutdown Coordination

In `sidecar/src/server.ts`, add cleanup on process exit:

```typescript
process.on("SIGTERM", () => {
  state.terminalManager.dispose();
  state.fileWatcherManager.dispose();
  process.exit(0);
});
```

---

## Phase 4: Tests

Create `sidecar/src/__tests__/terminal-manager.test.ts` and `sidecar/src/__tests__/file-watcher-manager.test.ts`.

### TerminalManager Tests

- Spawn returns incrementing IDs
- Write to valid session succeeds
- Write to invalid session throws
- Kill removes session and broadcasts `terminal:killed`
- List returns active IDs
- KillByCwd only kills matching sessions
- Dispose kills all sessions

Note: `node-pty` spawns real PTY processes. Tests should spawn, verify the ID, write a simple command, and kill. Use a short timeout to avoid hanging.

### FileWatcherManager Tests

- Start creates a watcher, stop removes it
- Duplicate watchId replaces old watcher
- List returns active IDs
- Dispose closes all watchers
- Change events are debounced and broadcast (write a temp file, wait &gt;200ms, verify event)

### Dispatch Integration Tests

Extend the existing `command-dispatch.test.ts` to cover terminal and watcher commands over WebSocket.

---

## Phase 5: Verify Build

- `cd sidecar && pnpm build` succeeds
- `cd sidecar && pnpm test` passes all tests (existing + new)
- `tsc --noEmit` clean
- `pnpm web:build` still succeeds (no regressions)

---

## File Summary

| Action | File |
| --- | --- |
| Create | `sidecar/src/managers/terminal-manager.ts` |
| Create | `sidecar/src/managers/file-watcher-manager.ts` |
| Create | `sidecar/src/dispatch/dispatch-terminal.ts` |
| Create | `sidecar/src/__tests__/terminal-manager.test.ts` |
| Create | `sidecar/src/__tests__/file-watcher-manager.test.ts` |
| Edit | `sidecar/src/state.ts` — add both managers |
| Edit | `sidecar/src/dispatch.ts` — add terminal/watcher routing |
| Edit | `sidecar/src/server.ts` — add shutdown cleanup |
| Edit | `sidecar/package.json` — add `node-pty` and `chokidar` |
| Edit | `sidecar/src/__tests__/command-dispatch.test.ts` — extend coverage |
