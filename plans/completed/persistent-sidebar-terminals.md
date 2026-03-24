# Persistent Sidebar Terminals

## Summary

Terminals should always be present in the sidebar under each worktree. Currently, terminals are ephemeral — the PTY process is killed on app exit (`kill_all()` in `lib.rs`), and on hydration the sessions are loaded with `isAlive: false` and `ptyId: null`. Clicking an exited terminal in the sidebar opens a dead terminal view with "\[Process exited\]". There's no mechanism to revive the PTY or ensure at least one terminal exists per worktree.

This plan makes terminals persistent and self-healing: each worktree always has at least one terminal in the sidebar, and clicking a dead terminal transparently respawns its PTY.

## Current Lifecycle (Investigation Summary)

1. **Creation**: `terminalSessionService.create()` → `invoke("spawn_terminal")` (Rust PTY) → writes `~/.anvil/terminal-sessions/{uuid}/metadata.json` → adds to Zustand store
2. **Hydration on restart**: `terminalSessionService.hydrate()` loads metadata from disk, sets `isAlive: false`, `ptyId: null` on every session (PTY is gone)
3. **App exit**: Rust `TerminalManager::kill_all()` kills every PTY process. Metadata files survive on disk.
4. **Sidebar display**: Dead terminals show `(exited)` text and a dimmer icon. Still clickable, but opens a dead xterm view.
5. **Navigation**: Clicking a terminal calls `navigationService.navigateToTerminal(id)` → `findOrOpenTab({ type: "terminal", terminalId })`. No alive check.
6. **Archive**: The only way to remove a terminal is explicit archive (hover the archive button). This kills PTY + removes metadata from disk.

**Key gap**: No "revive" path. No "ensure one terminal exists" path.

## Phases

- [x] Revive dead terminals on click (respawn PTY, reuse UUID)

- [x] Ensure at least one terminal per worktree on hydration

- [x] Clean up stale exited terminals on hydration

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Revive Dead Terminals on Click (Respawn PTY, Reuse UUID)

When a user clicks a terminal that is `isAlive: false`, respawn a new PTY and re-associate it with the existing terminal UUID. This makes clicking a dead terminal indistinguishable from clicking a live one.

### Design

Add a `revive(id: string)` method to `TerminalSessionService`:

```ts
async revive(id: string, cols = 80, rows = 24): Promise<void> {
  const session = this.get(id);
  if (!session) throw new Error(`Terminal not found: ${id}`);
  if (session.isAlive) return; // Already alive, no-op

  // Spawn new PTY in same working directory
  const numericId = await invoke<number>("spawn_terminal", {
    cols,
    rows,
    cwd: session.worktreePath,
  });

  // Re-register PTY mapping
  this.registerPtyId(id, numericId);

  // Update store: mark alive, set new ptyId
  useTerminalSessionStore.getState().updateSession(id, {
    isAlive: true,
    ptyId: numericId,
  });

  // Persist updated state
  await this.persistMetadata(id);
}
```

**Note**: `persistMetadata` is currently private. Make it `private` → keep it private but call from within the class (it's already callable). No change needed.

### Wire into navigation

Modify `navigateToTerminal` or the `handleItemSelect` callback in `main-window-layout.tsx` so that before opening the terminal tab, it checks if the session is alive and calls `revive()` if not.

Best place: `main-window-layout.tsx` `handleItemSelect` — this is where user intent is clear:

```ts
} else if (itemType === "terminal") {
  // Revive dead terminal before navigating
  const session = terminalSessionService.get(itemId);
  if (session && !session.isAlive && !session.isArchived) {
    await terminalSessionService.revive(itemId);
  }
  await navigationService.navigateToTerminal(itemId, { newTab });
}
```

### TerminalContent scrollback behavior

When a terminal is revived, the `TerminalContent` component will remount (or the existing instance will see the terminal become alive). The output buffer from the previous session is still in memory (cleared only on archive). On remount, `TerminalContent` writes `initialBuffer` to xterm and then subscribes to new output.

**Decision**: Clear the output buffer when reviving so the user gets a fresh terminal. Add `clearOutputBuffer(id)` call at the start of `revive()`. This prevents old dead output from mixing with the new shell session.

### Files to modify

- `src/entities/terminal-sessions/service.ts` — Add `revive()` method
- `src/components/main-window/main-window-layout.tsx` — Call `revive()` in `handleItemSelect` for dead terminals

## Phase 2: Ensure At Least One Terminal Per Worktree on Hydration

After hydrating terminal sessions from disk, check each known worktree. If a worktree has zero terminals, auto-create one.

### Design

Add an `ensureTerminalsForWorktrees()` method to `TerminalSessionService`:

```ts
async ensureTerminalsForWorktrees(
  worktrees: Array<{ worktreeId: string; worktreePath: string }>
): Promise<void> {
  for (const wt of worktrees) {
    const existing = this.getByWorktree(wt.worktreeId);
    if (existing.length === 0) {
      await this.create(wt.worktreeId, wt.worktreePath);
    }
  }
}
```

**When to call**: After both terminal sessions and worktrees have been hydrated. The app initialization sequence in `main-window-layout.tsx` (or wherever hydration is orchestrated) should call this after `terminalSessionService.hydrate()` and `worktreeService.hydrate()` complete.

**Important**: The auto-created terminal starts with `isAlive: true` because `create()` spawns a PTY. This means each worktree gets a live terminal on startup. If we want to defer PTY creation (lazy spawn), we could create with `isAlive: false` and let `revive()` handle it on first click — but eager spawn is simpler and matches the "terminal is always ready" UX goal.

### Decision: Eager vs Lazy PTY spawn

**Recommendation: Lazy spawn.** Eagerly spawning a PTY for every worktree on app launch could be expensive if the user has many worktrees. Instead:

1. Create the terminal metadata on disk and in the store with `isAlive: false` (no PTY spawned).
2. When the user clicks the terminal, Phase 1's `revive()` handles spawning.

This requires a new method `createPlaceholder()` that creates terminal metadata without spawning a PTY:

```ts
async createPlaceholder(worktreeId: string, worktreePath: string): Promise<TerminalSession> {
  const id = crypto.randomUUID();
  const session: TerminalSession = {
    id,
    ptyId: null,
    worktreeId,
    worktreePath,
    createdAt: Date.now(),
    isAlive: false,
    isArchived: false,
    visualSettings: { parentId: worktreeId },
  };

  useTerminalSessionStore.getState().addSession(session);
  const dirPath = `${TERMINAL_SESSIONS_DIR}/${id}`;
  await appData.ensureDir(dirPath);
  await appData.writeJson(`${dirPath}/metadata.json`, session);

  return session;
}
```

Then `ensureTerminalsForWorktrees` uses `createPlaceholder` instead of `create`.

### Files to modify

- `src/entities/terminal-sessions/service.ts` — Add `createPlaceholder()` and `ensureTerminalsForWorktrees()` methods
- App initialization code (likely `main-window-layout.tsx`) — Call `ensureTerminalsForWorktrees()` after hydration

## Phase 3: Clean Up Stale Exited Terminals on Hydration

When the app hydrates, all persisted terminals come back as `isAlive: false`. Over time, if the user creates many terminals without archiving them, the sidebar could accumulate dead terminals.

### Design

During hydration, if a worktree has **more than one** terminal and **all are dead**, keep only the most recent one (by `createdAt`) and auto-archive the rest. This ensures:

- Each worktree always keeps at least one terminal (the most recent)
- Old dead terminals don't pile up
- User-created terminals that were alive at app close get a fresh start

Add cleanup logic to `hydrate()` or as a separate `cleanupStaleTerminals()` called right after hydration:

```ts
async cleanupStaleTerminals(): Promise<void> {
  const sessions = this.getAll();
  // Group by worktree
  const byWorktree = new Map<string, TerminalSession[]>();
  for (const s of sessions) {
    const list = byWorktree.get(s.worktreeId) ?? [];
    list.push(s);
    byWorktree.set(s.worktreeId, list);
  }

  for (const [_worktreeId, terminals] of byWorktree) {
    // All dead? Keep only the newest, archive the rest
    if (terminals.length > 1 && terminals.every(t => !t.isAlive)) {
      const sorted = [...terminals].sort((a, b) => b.createdAt - a.createdAt);
      for (const stale of sorted.slice(1)) {
        await this.archive(stale.id);
      }
    }
  }
}
```

### Files to modify

- `src/entities/terminal-sessions/service.ts` — Add `cleanupStaleTerminals()`
- App initialization code — Call after `hydrate()`

## Edge Cases

- **Worktree path no longer exists** (e.g., user deleted the directory outside Anvil): `revive()` will fail when Rust tries to spawn a PTY with a missing `cwd`. We should catch this error and show a notification rather than crashing. Could also auto-archive the terminal.
- **Multiple terminals per worktree**: Fully supported. `ensureTerminalsForWorktrees` only creates one if **zero** exist. Users can create additional terminals via Cmd+T.
- **Terminal revive while content pane is already open**: If `TerminalContent` is already mounted showing the dead terminal, the revive will update the store (`isAlive: true`), but the xterm instance was initialized with the old buffer and exit message. The simplest fix: force a remount of `TerminalContent` by keying it on a combination of `terminalId` + `isAlive` status, or by clearing the buffer and letting the effect re-run. Clearing the buffer in `revive()` + using `terminalId` as key should work since React won't remount for the same key. Best approach: add a `reviveCount` or `sessionEpoch` to the terminal metadata that increments on revive, and use `terminalId + epoch` as the React key.
- **Sidebar should not show "(exited)" for placeholder terminals**: Since placeholders are created with `isAlive: false`, `terminalToNode` would show them as exited. Add a check: if a terminal has never been alive (no `lastCommand`, freshly created), don't show "(exited)". Alternatively, add a `isPlaceholder` flag or just check `ptyId === null && !lastCommand`.