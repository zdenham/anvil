# Decouple TUI Threads from Terminal Sessions

## Problem

When a Claude Code TUI thread is created, `createTuiThread()` calls `terminalSessionService.create()`, which produces a `TerminalSession` entity. Both the thread **and** the terminal appear as separate nodes in the sidebar tree — the thread as "cc New Thread" and the terminal as "dirname 1".

The root cause is that TUI threads piggyback on the `TerminalSession` entity for PTY lifecycle, output buffering, and xterm rendering. This creates a phantom terminal that the tree builder doesn't know to hide.

## Goal

TUI threads should own their PTY connection directly, without creating a `TerminalSession`. Both TUI threads and plain terminals should share the same underlying PTY primitives (spawn, write, resize, kill, output buffering) but remain separate entity types.

## Design

Extract a low-level `PtyService` that manages raw PTY connections. Both `TerminalSessionService` and TUI thread lifecycle code use it.

```
┌──────────────────┐     ┌──────────────────────┐
│  TUI Thread       │     │  Terminal Session     │
│  (threadKind,     │     │  (label, worktreeId,  │
│   ptyConnectionId)│     │   ptyConnectionId)    │
└────────┬─────────┘     └────────┬──────────────┘
         │                        │
         └───────┬────────────────┘
                 ▼
        ┌────────────────┐
        │   PtyService   │
        │  spawn/write/  │
        │  resize/kill   │
        │  output buffer │
        │  ptyId mapping │
        └────────────────┘
                 │
                 ▼
          invoke("spawn_terminal", ...)
          (sidecar dispatch)
```

### PtyService responsibilities (extracted from TerminalSessionService + output-buffer)

- `spawn(cwd, cols, rows, opts?)` → returns `{ connectionId, ptyId }`
- `write(connectionId, data)`
- `resize(connectionId, cols, rows)`
- `kill(connectionId)`
- `resolveByPtyId(ptyId)` → `connectionId`
- `registerPtyId(connectionId, ptyId)`
- Output buffer: `appendOutput(connectionId, data)`, `getOutputBuffer(connectionId)`, `onOutput(connectionId, cb)`

The `connectionId` is a UUID that both terminals and TUI threads use as their handle into the PTY layer. For terminals, `connectionId === terminal.id` (preserving current behavior). For TUI threads, `connectionId` is stored on the thread metadata (replacing `terminalId` or reusing it with clearer semantics).

### What changes per entity

**TerminalSessionService:**

- `create()` calls `ptyService.spawn()` instead of `invoke("spawn_terminal")` directly
- Removes its own `ptyIds` map, `resolveByPtyId()`, `registerPtyId()` — delegates to PtyService
- `write()`, `resize()` delegate to PtyService
- `markExited()` delegates to PtyService for cleanup

**TUI thread creation (**`thread-creation-service.ts`**):**

- Calls `ptyService.spawn()` directly instead of `terminalSessionService.create()`
- Stores `ptyConnectionId` on the thread (rename from `terminalId` for clarity, or keep `terminalId` and change its semantics — see open question)
- No `TerminalSession` entity is created → no phantom sidebar node

**Terminal listeners (**`terminal-sessions/listeners.ts`**):**

- `terminal:output` and `terminal:exit` events resolve via `ptyService.resolveByPtyId()`
- Exit handler checks: is this a terminal session? → `terminalSessionService.markExited()`. Is this a TUI thread? → `markTuiThreadCompleted()`. Both paths can coexist.
- Alternatively, PtyService emits its own events and both terminal sessions and TUI lifecycle subscribe independently.

**TerminalContent component:**

- Currently imports from `terminal-sessions` for write/resize/revive and the output buffer
- Refactor to accept a `ptyConnectionId` prop and use `ptyService` directly for I/O
- Both `TuiThreadContent` and the terminal sidebar can render `TerminalContent` by passing their respective `ptyConnectionId`

**Tree builder (**`use-tree-data.ts`**):**

- No filtering needed — TUI threads don't create terminal sessions, so no phantom nodes exist

### What about revive?

Terminal sessions support reviving dead PTYs. TUI threads should too (user closes Claude CLI, wants to restart). The revive logic can live in PtyService since it's just "spawn a new PTY and reassociate the connectionId." The caller (terminal service or TUI lifecycle) handles updating their own entity's state.

## Open Questions

1. **Field naming**: Rename `terminalId` on ThreadMetadata to `ptyConnectionId`? Or keep `terminalId` since it's already persisted on disk? Renaming is cleaner but needs a migration or fallback read.
2. **Event routing**: Should PtyService emit typed events (e.g. `pty:exit`) that terminal-sessions and tui-lifecycle subscribe to independently? Or keep the current listener structure that dispatches to both? The former is cleaner separation; the latter is less churn.
3. **Output buffer location**: Currently in `terminal-sessions/output-buffer.ts`. Move to a `pty/` module alongside PtyService? Or keep it where it is and just re-export?

## Phases

- [x] Extract PtyService from TerminalSessionService (spawn, write, resize, kill, ptyId mapping, output buffer)

- [x] Refactor TerminalSessionService to delegate to PtyService

- [x] Refactor TerminalContent component to accept ptyConnectionId and use PtyService directly

- [x] Update TUI thread creation to use PtyService directly (no TerminalSession created)

- [x] Update terminal listeners to route PTY events through PtyService to both terminals and TUI threads

- [x] Update TUI thread lifecycle (revive, exit handling) to work without TerminalSession

- [x] Remove terminalId-based filtering workarounds if any were added; verify tree shows no duplicates

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files Touched

| File | Change |
| --- | --- |
| `src/entities/pty/service.ts` (new) | PtyService class |
| `src/entities/pty/output-buffer.ts` (new or moved) | Output buffer, re-keyed by connectionId |
| `src/entities/terminal-sessions/service.ts` | Delegate PTY ops to PtyService |
| `src/entities/terminal-sessions/listeners.ts` | Use PtyService for ptyId resolution; route events |
| `src/lib/thread-creation-service.ts` | Use PtyService.spawn() instead of terminalSessionService.create() |
| `src/lib/tui-thread-lifecycle.ts` | Handle exit/revive via PtyService |
| `src/components/content-pane/terminal-content.tsx` | Accept ptyConnectionId, use PtyService for I/O |
| `src/components/content-pane/tui-thread-content.tsx` | Pass ptyConnectionId from thread metadata |
| `core/types/threads.ts` | Potentially rename terminalId → ptyConnectionId |
| `src/hooks/use-tree-data.ts` | No change needed (bug fixed by design) |
