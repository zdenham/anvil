# Sidecar + WebSocket Refactor — Manual QA Checklist

## Audit Summary

The refactor moved \~7,600 lines of command dispatch logic from Rust (axum/tokio WS server + Unix socket agent hub) into \~3,400 lines of Node.js sidecar (Express + ws). Tauri is now a thin shell (\~500 lines) handling only process spawning, window management, and native integrations. All data commands (file, git, agent, terminal, watcher) route through the sidecar via WebSocket.

11 potential issues identified (0 showstoppers, 3 high-concern, 5 medium, 3 low). Checklist ordered by risk.

---

## Startup & Connection

- [ ] **Cold start**: Launch app from quit state. First command should succeed without delay or error.

- [ ] **Sidecar health gate**: Kill sidecar process before app launch, watch logs — does app report a clear error or silently degrade?

- [ ] **Port conflict**: Start something on port 9600, then launch app. Should detect existing service via health check and either reuse or error clearly.

- [ ] **Dev mode double-spawn**: Run `pnpm dev`, then run it again in another terminal. Second instance should detect existing sidecar and skip spawning.

## Agent Lifecycle

- [ ] **Spawn agent**: Create a new agent thread. Verify it registers with the hub and receives commands.

- [ ] **Kill agent**: Kill a running agent. Verify process is cleaned up (no orphan in `ps aux | grep node`).

- [ ] **Cancel agent mid-tool**: Cancel an agent while it's running a tool. Verify the SDK subprocess terminates.

- [ ] **Multiple agents**: Spawn 3+ agents simultaneously. All should register independently and route messages correctly.

- [ ] **Agent stdout/stderr streaming**: Agent output should stream to the frontend in real time, not batch on completion.

## WebSocket Reconnection

- [ ] **Sidecar crash recovery**: Kill the sidecar process (`kill -9`) while the app is open. Frontend should:

  1. Show a disconnected/reconnecting indicator
  2. Reconnect automatically when sidecar restarts (Tauri should respawn it)
  3. Resume normal operation without a full app restart

- [ ] **Agent reconnect**: Kill sidecar while an agent is connected. Agent should reconnect and re-register. Verify with a command after reconnect.

- [ ] **Rapid disconnect/reconnect**: Toggle network off/on quickly 3 times. Connections should stabilize without duplicate registrations or zombie sockets.

## Command Dispatch (Sidecar Routes)

### File System

- [ ] **Read file**: Open a file in the editor pane. Contents should render correctly.

- [ ] **Write file**: Edit and save a file. Verify changes persist on disk.

- [ ] **Read large file**: Open a file &gt;1MB. Should not hang or timeout.

- [ ] **Read binary file**: Attempt to open an image or binary. Should handle gracefully (not crash).

- [ ] **Path with spaces/special chars**: Read/write a file at a path containing spaces or unicode.

### Git

- [ ] **Git status**: Open a repo with staged, unstaged, and untracked changes. All categories should appear correctly.

- [ ] **Git diff**: View a diff. Hunks should render with correct +/- lines.

- [ ] **Git log**: View commit history. Should paginate or load without hanging.

- [ ] **Git operation &gt;10s**: Run a slow git operation (e.g., large blame). Should complete without 30s timeout if within bounds, or error clearly if it exceeds.

### Terminal

- [ ] **Open terminal**: Launch a terminal session. Shell prompt should appear.

- [ ] **Terminal input/output**: Run a command (e.g., `ls`). Output should stream back.

- [ ] **Multiple terminals**: Open 3+ terminal sessions. Each should be independent.

- [ ] **Close terminal**: Close a terminal tab. PTY process should be cleaned up (`ps aux | grep`).

- [ ] **Rapid open/close**: Open and immediately close 5 terminals. No orphaned PTY processes.

### File Watcher

- [ ] **Watch directory**: Start watching a directory, then create/modify/delete a file. Events should appear in the UI.

- [ ] **Stop watcher**: Stop watching. Subsequent file changes should NOT trigger events.

- [ ] **Watch symlinked dir**: Watch a directory containing symlinks. Changes to symlinked targets should trigger events.

### Worktree

- [ ] **Create worktree**: Create a git worktree via the UI. Should appear in worktree list.

- [ ] **Switch worktree**: Switch between worktrees. File tree and git state should update.

- [ ] **Delete worktree**: Remove a worktree. Should clean up on disk.

## Event Routing (Tauri IPC vs WebSocket)

- [ ] **Panel toggle**: Toggle sidebar/panels. These route through Tauri IPC (`app.emit()`), not sidecar — verify they still work.

- [ ] **Clipboard**: Copy text from the app. Clipboard integration goes through Tauri — verify it works.

- [ ] **Navigation**: Click a link or trigger navigation. Should route through eventBus (not WS).

- [ ] **Log events**: Check that app logs still write correctly (routed via Tauri IPC).

## Push Events (Sidecar → Frontend)

- [ ] **Agent progress events**: Start an agent task. Progress/streaming events should appear in real time.

- [ ] **File watcher events**: Modify a watched file externally. Event should push to frontend within \~200ms (debounce window).

- [ ] **Event during hidden window**: Minimize the app, let an agent emit events, restore the app. Events should catch up or state should be consistent.

## Process Cleanup & Resource Leaks

- [ ] **Quit app normally**: Quit via Cmd+Q. Check `ps aux | grep -E 'sidecar|node'` — no orphaned processes.

- [ ] **Force quit app**: Force quit via Activity Monitor. Check for orphaned sidecar or agent processes.

- [ ] **Long session**: Use the app for 10+ minutes with multiple agents and terminals. Check memory usage doesn't grow unboundedly (Activity Monitor).

## Lock Manager

- [ ] **Concurrent repo access**: Two agents operating on the same repo. Lock should serialize access, second should wait or error clearly.

- [ ] **Stale lock**: If a lock exists from a crashed process (&gt;30 min old), it should be auto-expired.

## Error UX

- [ ] **Timeout error message**: Trigger a 30s timeout (e.g., massive git operation). Error should say "timed out" with the command name, not a generic failure.

- [ ] **Agent not found**: Send a command to a non-existent agent thread. Error should say "Agent not connected: &lt;threadId&gt;".

- [ ] **Sidecar not reachable**: If sidecar is down, commands should show "disconnected" state, not hang indefinitely.

---

## Issues Found in Audit

These are code-level concerns worth tracking. None are blocking for QA but all are worth addressing:

| \# | Severity | Issue | File |
| --- | --- | --- | --- |
| 1 | HIGH | Sidecar health check times out after 5s but continues anyway — silent degradation | `src-tauri/src/lib.rs` |
| 2 | MEDIUM | In-flight dispatch operations continue after frontend WS closes — orphaned work | `sidecar/src/ws-handler.ts` |
| 3 | MEDIUM | Agent socket readyState check races with `.send()` — message can be lost | `sidecar/src/managers/agent-hub.ts` |
| 4 | MEDIUM | Agent re-register after reconnect has no ack — hub may have stale state | `agents/src/lib/hub/client.ts` |
| 5 | MEDIUM | `detached: true` on agent spawn + no kill verification — orphan risk on crash | `sidecar/src/managers/agent-process-manager.ts` |
| 6 | MEDIUM | Shutdown has no timeout — hung PTY can block graceful exit | `sidecar/src/server.ts` |
| 7 | LOW | Sequence gap detection logs but takes no action | `sidecar/src/managers/agent-hub.ts` |
| 8 | LOW | File watcher `.close()` not awaited — late events possible after stop | `sidecar/src/managers/file-watcher-manager.ts` |
| 9 | LOW | Broadcaster swallows listener errors silently | `sidecar/src/push.ts` |
| 10 | LOW | Hardcoded 30s timeout with no per-command override | `src/lib/invoke.ts` |
| 11 | LOW | Visibility-gated events silently dropped, agent unaware | `agents/src/lib/hub/client.ts` |
