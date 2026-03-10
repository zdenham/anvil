# 02a — Terminal Metadata Persistence

**Layer 1 — parallel with 02b, 02c, 02d. Depends on 01.**

## Summary

Persist terminal session metadata to disk at `~/.mort/terminal-sessions/{id}/metadata.json`. Currently `TerminalSession` is runtime-only (Zustand store, lost on restart). Persistence enables `visualSettings` on terminals, sidebar organization across restarts, and makes terminals first-class entities.

Includes setting `visualSettings.parentId` to the worktree node ID at terminal creation time (terminal-specific seeding — 02c handles threads/plans/PRs).

## Dependencies

- **01-visual-settings-foundation** — `VisualSettingsSchema` must exist on `TerminalSessionSchema`

## Current State (Verified)

### Terminal ID Scheme

The current terminal `id` is `String(numericPtyId)` — a stringified integer assigned by the Rust backend via `invoke<number>("spawn_terminal", ...)`. These IDs reset on app restart (Rust process restarts at 1). This means persisted terminals cannot be matched back to PTYs after restart — which is fine, since persisted terminals from a prior session will always have `isAlive: false`.

### Current Schema (`src/entities/terminal-sessions/types.ts`)

```typescript
export const TerminalSessionSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  worktreePath: z.string(),
  lastCommand: z.string().optional(),
  createdAt: z.number(),
  isAlive: z.boolean(),
  isArchived: z.boolean(),
  // After 01: visualSettings: VisualSettingsSchema.optional(),
});
```

### Current Service (`src/entities/terminal-sessions/service.ts`)

- `create()` — calls `invoke("spawn_terminal")`, builds session with `id: String(numericId)`, adds to store
- `archive()` — calls `invoke("kill_terminal")`, removes from store, emits `TERMINAL_ARCHIVED`
- `updateLastCommand()` — in-memory store update only
- `markExited()` — in-memory store update only
- No disk I/O at all

### Current Store (`src/entities/terminal-sessions/store.ts`)

- `addSession()`, `updateSession()`, `removeSession()`, `markExited()`
- Has `_hydrated` flag but no `hydrate()` method
- No `_apply*` optimistic methods — uses direct `set()` calls
- `_sessionsArray` filters out archived sessions

### Hydration / Listeners Setup (`src/entities/index.ts`)

- `hydrateEntities()` runs all entity `.hydrate()` calls at startup — **terminal has no hydrate call**
- `setupEntityListeners()` calls `setupTerminalListeners()` — wires Rust PTY events to store

### Events (`core/types/events.ts`)

- Only `TERMINAL_ARCHIVED` exists. No `TERMINAL_CREATED` or `TERMINAL_UPDATED` events.

## Key Files

| File | Change |
| --- | --- |
| `src/entities/terminal-sessions/types.ts` | Add `TerminalSessionMetadataSchema` for disk shape; keep `TerminalSessionSchema` for runtime |
| `src/entities/terminal-sessions/store.ts` | Add `hydrate()`, `_applyCreate`, `_applyUpdate`, `_applyDelete` |
| `src/entities/terminal-sessions/service.ts` | Add disk read/write: `hydrate()`, persist on `create()`, `archive()`, `updateVisualSettings()` |
| `src/entities/terminal-sessions/listeners.ts` | Persist `isAlive: false` to disk on terminal exit |
| `src/entities/index.ts` | Add `terminalSessionService.hydrate()` to `hydrateEntities()` |
| `core/types/events.ts` | Add `TERMINAL_CREATED` and `TERMINAL_UPDATED` events |

## Implementation

### 1. Schema Changes (`src/entities/terminal-sessions/types.ts`)

The existing `TerminalSessionSchema` uses `id: z.string()` which allows any string (including the Rust numeric IDs like `"1"`, `"2"`). For disk persistence we need stable UUIDs. The solution: add a `persistenceId` (UUID) field for disk keying, while keeping `id` as the PTY-assigned runtime ID.

**However**, this dual-ID approach adds complexity for something that has a simpler solution: just switch to UUIDs at creation time, and store the numeric PTY ID as a separate `ptyId` field. All callers that talk to Rust already go through the service which can map `id` -> `ptyId` internally (the service already has a `numericIds` Map).

Replace the full file:

```typescript
/**
 * Terminal session types.
 * Terminals are PTY processes managed by the Rust backend.
 */
import { z } from "zod";
import { VisualSettingsSchema } from "@core/types/visual-settings.js";

/**
 * Schema for terminal session metadata persisted to disk.
 * Uses UUID as the primary ID (stable across restarts).
 * The ptyId is the Rust-assigned numeric ID (runtime-only, not persisted).
 */
export const TerminalSessionSchema = z.object({
  /** Stable UUID identifier */
  id: z.string().uuid(),
  /** Rust-assigned PTY ID (null for sessions loaded from disk after restart) */
  ptyId: z.number().nullable().optional(),
  /** Associated worktree ID */
  worktreeId: z.string(),
  /** Working directory path */
  worktreePath: z.string(),
  /** Last executed command (for sidebar display) */
  lastCommand: z.string().optional(),
  /** When the terminal was created */
  createdAt: z.number(),
  /** Whether the PTY process is still running */
  isAlive: z.boolean(),
  /** Whether the terminal has been archived (killed) */
  isArchived: z.boolean(),
  /** Visual tree settings (parent, sort key) */
  visualSettings: VisualSettingsSchema.optional(),
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

/**
 * Maximum lines to keep in the output buffer for scrollback.
 */
export const OUTPUT_BUFFER_MAX_LINES = 10_000;
```

**Migration note:** The `id` field changes from `z.string()` to `z.string().uuid()`. New sessions use UUIDs. For backward compat during the transition (any in-memory sessions from before the code update), the service can detect non-UUID IDs and skip disk persistence for them — but in practice the app restarts between deploys so this is a non-issue.

### 2. Store Changes (`src/entities/terminal-sessions/store.ts`)

Add `hydrate()` and optimistic `_apply*` methods following the pattern from `useThreadStore` and `usePlanStore`.

Add to the imports:

```typescript
import type { Rollback } from "@/lib/optimistic";
```

Add to `TerminalSessionStoreActions`:

```typescript
/** Hydrate store from disk (called once at app start) */
hydrate: (sessions: Record<string, TerminalSession>) => void;

/** Optimistic apply methods - return rollback functions */
_applyCreate: (session: TerminalSession) => Rollback;
_applyUpdate: (id: string, updates: Partial<TerminalSession>) => Rollback;
_applyDelete: (id: string) => Rollback;
```

Add implementations inside the `create(...)` call, following this pattern:

```typescript
hydrate: (sessions) => {
  set({
    sessions,
    _sessionsArray: Object.values(sessions).filter((s) => !s.isArchived),
    _hydrated: true,
  });
},

_applyCreate: (session: TerminalSession): Rollback => {
  set((state) => {
    const newSessions = { ...state.sessions, [session.id]: session };
    return {
      sessions: newSessions,
      _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
    };
  });
  return () =>
    set((state) => {
      const { [session.id]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        _sessionsArray: Object.values(rest).filter((s) => !s.isArchived),
      };
    });
},

_applyUpdate: (id: string, updates: Partial<TerminalSession>): Rollback => {
  const prev = get().sessions[id];
  if (!prev) return () => {};

  const updated = { ...prev, ...updates };
  set((state) => {
    const newSessions = { ...state.sessions, [id]: updated };
    return {
      sessions: newSessions,
      _sessionsArray: Object.values(newSessions).filter((s) => !s.isArchived),
    };
  });
  return () =>
    set((state) => {
      const restoredSessions = prev
        ? { ...state.sessions, [id]: prev }
        : state.sessions;
      return {
        sessions: restoredSessions,
        _sessionsArray: Object.values(restoredSessions).filter((s) => !s.isArchived),
      };
    });
},

_applyDelete: (id: string): Rollback => {
  const prev = get().sessions[id];
  if (!prev) return () => {};

  clearOutputBuffer(id);
  set((state) => {
    const { [id]: _, ...rest } = state.sessions;
    return {
      sessions: rest,
      _sessionsArray: Object.values(rest).filter((s) => !s.isArchived),
    };
  });
  return () =>
    set((state) => {
      const restoredSessions = prev
        ? { ...state.sessions, [id]: prev }
        : state.sessions;
      return {
        sessions: restoredSessions,
        _sessionsArray: Object.values(restoredSessions).filter((s) => !s.isArchived),
      };
    });
},
```

### 3. Service Changes (`src/entities/terminal-sessions/service.ts`)

This is the main change. The service gains disk I/O following the same patterns as `threadService` and `planService`.

Replace the full file with the following. Key changes:
- New `TERMINAL_SESSIONS_DIR` constant
- `create()` generates a UUID, stores the PTY numeric ID as `ptyId`, writes metadata to disk
- `archive()` deletes the metadata directory from disk
- `hydrate()` loads all persisted sessions from disk, marks them as `isAlive: false`, `ptyId: null`
- `updateVisualSettings()` merges and persists visualSettings
- `numericIds` map becomes `ptyIds` map keyed by UUID

```typescript
/**
 * Terminal session service - manages PTY lifecycle via Tauri commands.
 * Persists terminal metadata to ~/.mort/terminal-sessions/{id}/metadata.json.
 */
import { invoke } from "@/lib/invoke";
import { appData } from "@/lib/app-data-store";
import { useTerminalSessionStore } from "./store";
import { TerminalSessionSchema, type TerminalSession } from "./types";
import { logger } from "@/lib/logger-client";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import type { VisualSettings } from "@core/types/visual-settings.js";

const TERMINAL_SESSIONS_DIR = "terminal-sessions";

/**
 * Service for managing terminal sessions.
 * Coordinates between the Rust PTY backend, disk persistence, and the frontend store.
 */
class TerminalSessionService {
  private readonly encoder = new TextEncoder();
  /** Maps terminal UUID → numeric PTY ID for Rust IPC */
  private readonly ptyIds = new Map<string, number>();

  private getPtyId(id: string): number {
    const ptyId = this.ptyIds.get(id);
    if (ptyId === undefined) {
      throw new Error(`No PTY ID for terminal ${id}`);
    }
    return ptyId;
  }

  /**
   * Hydrates the store from disk.
   * Loads all persisted terminal sessions, marks them as not alive (PTY is gone after restart).
   * Called once at app initialization.
   */
  async hydrate(): Promise<void> {
    const sessions: Record<string, TerminalSession> = {};

    const pattern = `${TERMINAL_SESSIONS_DIR}/*/metadata.json`;
    const files = await appData.glob(pattern);

    await Promise.all(
      files.map(async (filePath) => {
        try {
          const raw = await appData.readJson(filePath);
          const result = raw ? TerminalSessionSchema.safeParse(raw) : null;
          if (result?.success) {
            const session: TerminalSession = {
              ...result.data,
              isAlive: false,
              ptyId: null,
            };
            sessions[session.id] = session;
          } else if (result && !result.success) {
            logger.warn("[TerminalService] Invalid metadata at", filePath, result.error.message);
          }
        } catch (err) {
          logger.warn("[TerminalService] Failed to read metadata at", filePath, err);
        }
      })
    );

    useTerminalSessionStore.getState().hydrate(sessions);
    logger.info("[TerminalService] Hydrated", { count: Object.keys(sessions).length });
  }

  /**
   * Creates a new terminal session.
   * Generates a UUID, spawns the PTY, persists metadata to disk.
   */
  async create(
    worktreeId: string,
    worktreePath: string,
    cols = 80,
    rows = 24
  ): Promise<TerminalSession> {
    logger.info("[TerminalService] Creating terminal", {
      worktreeId,
      worktreePath,
      cols,
      rows,
    });

    try {
      // Spawn the PTY in Rust
      const numericId = await invoke<number>("spawn_terminal", {
        cols,
        rows,
        cwd: worktreePath,
      });

      const id = crypto.randomUUID();

      const session: TerminalSession = {
        id,
        ptyId: numericId,
        worktreeId,
        worktreePath,
        lastCommand: undefined,
        createdAt: Date.now(),
        isAlive: true,
        isArchived: false,
        visualSettings: {
          parentId: worktreeId,
        },
      };

      // Register PTY ID mapping
      this.ptyIds.set(id, numericId);

      // Add to store
      useTerminalSessionStore.getState().addSession(session);

      // Persist to disk
      const dirPath = `${TERMINAL_SESSIONS_DIR}/${id}`;
      await appData.ensureDir(dirPath);
      await appData.writeJson(`${dirPath}/metadata.json`, session);

      logger.info("[TerminalService] Terminal created", {
        terminalId: id,
        ptyId: numericId,
        worktreeId,
      });

      return session;
    } catch (error) {
      logger.error("[TerminalService] Failed to create terminal", { error });
      throw error;
    }
  }

  /**
   * Archives (kills) a terminal session.
   * Removes metadata from disk.
   */
  async archive(id: string): Promise<void> {
    logger.info("[TerminalService] Archiving terminal", { terminalId: id });

    try {
      // Kill the PTY if it has one
      const ptyId = this.ptyIds.get(id);
      if (ptyId !== undefined) {
        await invoke("kill_terminal", { id: ptyId });
        this.ptyIds.delete(id);
      }

      useTerminalSessionStore.getState().removeSession(id);

      // Remove from disk
      await appData.removeDir(`${TERMINAL_SESSIONS_DIR}/${id}`);

      eventBus.emit(EventName.TERMINAL_ARCHIVED, { terminalId: id });

      logger.info("[TerminalService] Terminal archived", { terminalId: id });
    } catch (error) {
      logger.error("[TerminalService] Failed to archive terminal", {
        terminalId: id,
        error,
      });
      throw error;
    }
  }

  /**
   * Writes data to a terminal's PTY.
   */
  async write(id: string, data: string): Promise<void> {
    const bytes = Array.from(this.encoder.encode(data));
    await invoke("write_terminal", { id: this.getPtyId(id), data: bytes });
  }

  /**
   * Resizes a terminal's PTY.
   */
  async resize(id: string, cols: number, rows: number): Promise<void> {
    await invoke("resize_terminal", {
      id: this.getPtyId(id),
      cols,
      rows,
    });
  }

  /**
   * Updates the last command for a terminal (for sidebar display).
   */
  updateLastCommand(id: string, command: string): void {
    useTerminalSessionStore.getState().updateSession(id, { lastCommand: command });
    // lastCommand is cosmetic — fire-and-forget disk write
    this.persistMetadata(id);
  }

  /**
   * Marks a terminal as exited (process ended but still visible).
   * Persists the isAlive: false state to disk.
   */
  markExited(id: string): void {
    useTerminalSessionStore.getState().markExited(id);
    this.ptyIds.delete(id);
    // Persist so exited state survives restart
    this.persistMetadata(id);
  }

  /**
   * Updates visualSettings for a terminal and persists to disk.
   */
  async updateVisualSettings(id: string, patch: Partial<VisualSettings>): Promise<void> {
    const session = useTerminalSessionStore.getState().getSession(id);
    if (!session) throw new Error(`Terminal not found: ${id}`);

    const merged: VisualSettings = { ...session.visualSettings, ...patch };
    useTerminalSessionStore.getState().updateSession(id, { visualSettings: merged });
    await this.persistMetadata(id);
  }

  /**
   * Archives all terminals for a worktree (used when worktree is removed).
   */
  async archiveByWorktree(worktreeId: string): Promise<void> {
    const sessions = useTerminalSessionStore
      .getState()
      .getSessionsByWorktree(worktreeId);

    logger.info("[TerminalService] Archiving terminals for worktree", {
      worktreeId,
      count: sessions.length,
    });

    await Promise.all(sessions.map((s) => this.archive(s.id)));
  }

  /**
   * Gets a terminal session by ID.
   */
  get(id: string): TerminalSession | undefined {
    return useTerminalSessionStore.getState().getSession(id);
  }

  /**
   * Gets all active (non-archived) terminal sessions.
   */
  getAll(): TerminalSession[] {
    return useTerminalSessionStore.getState().getAllSessions();
  }

  /**
   * Gets all terminal sessions for a worktree.
   */
  getByWorktree(worktreeId: string): TerminalSession[] {
    return useTerminalSessionStore.getState().getSessionsByWorktree(worktreeId);
  }

  /**
   * Registers a PTY ID mapping for a terminal.
   * Used when associating a newly spawned PTY with an existing terminal.
   */
  registerPtyId(terminalId: string, ptyId: number): void {
    this.ptyIds.set(terminalId, ptyId);
  }

  /**
   * Resolves a Rust PTY numeric ID to a terminal UUID.
   * Used by listeners that receive events keyed by PTY ID.
   */
  resolveByPtyId(ptyId: number): string | undefined {
    for (const [uuid, pid] of this.ptyIds.entries()) {
      if (pid === ptyId) return uuid;
    }
    return undefined;
  }

  /**
   * Persists current in-memory state of a terminal session to disk.
   * Fire-and-forget — logs errors but does not throw.
   */
  private async persistMetadata(id: string): Promise<void> {
    const session = useTerminalSessionStore.getState().getSession(id);
    if (!session) return;

    try {
      const dirPath = `${TERMINAL_SESSIONS_DIR}/${id}`;
      await appData.ensureDir(dirPath);
      await appData.writeJson(`${dirPath}/metadata.json`, session);
    } catch (err) {
      logger.error("[TerminalService] Failed to persist metadata", { terminalId: id, err });
    }
  }
}

export const terminalSessionService = new TerminalSessionService();
```

### 4. Listener Changes (`src/entities/terminal-sessions/listeners.ts`)

The listeners receive Rust events keyed by numeric PTY ID. With the switch to UUIDs as primary IDs, listeners must resolve `numericPtyId` -> `UUID` via `terminalSessionService.resolveByPtyId()`.

Replace the full file:

```typescript
/**
 * Terminal session event listeners.
 * Connects Tauri PTY events to the frontend store and disk persistence.
 */
import { listen } from "@/lib/events";
import { useTerminalSessionStore } from "./store";
import { terminalSessionService } from "./service";
import { decodeOutput, appendOutput } from "./output-buffer";
import { logger } from "@/lib/logger-client";

interface TerminalOutputPayload {
  id: number;
  data: number[];
}

interface TerminalExitPayload {
  id: number;
}

interface TerminalKilledPayload {
  id: number;
}

/**
 * Sets up listeners for terminal PTY events from Rust.
 * Call this once during app initialization.
 */
export function setupTerminalListeners(): () => void {
  const unlisteners: Array<() => void> = [];

  // Listen for terminal output — decode once, store + notify subscribers
  listen<TerminalOutputPayload>("terminal:output", (event) => {
    const { id, data } = event.payload;
    const termId = terminalSessionService.resolveByPtyId(id);
    if (!termId) return; // Unknown PTY ID — ignore
    const text = decodeOutput(termId, data);
    appendOutput(termId, text);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal exit (process ended)
  listen<TerminalExitPayload>("terminal:exit", (event) => {
    const ptyId = event.payload.id;
    const termId = terminalSessionService.resolveByPtyId(ptyId);
    if (!termId) return;

    logger.info("[TerminalListeners] Terminal exited", { terminalId: termId, ptyId });
    terminalSessionService.markExited(termId);
  }).then((unlisten) => unlisteners.push(unlisten));

  // Listen for terminal killed (archived)
  listen<TerminalKilledPayload>("terminal:killed", (event) => {
    const ptyId = event.payload.id;
    const termId = terminalSessionService.resolveByPtyId(ptyId);
    if (!termId) return;

    logger.info("[TerminalListeners] Terminal killed", { terminalId: termId, ptyId });
    useTerminalSessionStore.getState().removeSession(termId);
  }).then((unlisten) => unlisteners.push(unlisten));

  logger.info("[TerminalListeners] Terminal event listeners set up");

  // Return cleanup function
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
```

### 5. Hydration Registration (`src/entities/index.ts`)

Add the terminal hydrate call to `hydrateEntities()`.

**Import** (add near line 121, alongside other service imports):

```typescript
import { terminalSessionService } from "./terminal-sessions/service";
```

**Note**: `terminalSessionService` is already imported via the barrel export at line 63, but `hydrateEntities()` uses direct module imports for services. The barrel re-export at line 63 is `from "./terminal-sessions"` which goes through `index.ts`. For consistency with how `threadService`, `planService`, etc. are imported at the top of the hydration section, add a direct import.

**Add to the core parallel hydration block** (inside the `Promise.all` at line 153):

```typescript
await timed("core entities (parallel)", () => Promise.all([
  timed("threadService.hydrate", () => threadService.hydrate()),
  timed("repoService.hydrate", () => repoService.hydrate()),
  timed("settingsService.hydrate", () => settingsService.hydrate()),
  timed("planService.hydrate", () => planService.hydrate()),
  timed("relationService.hydrate", () => relationService.hydrate()),
  timed("terminalSessionService.hydrate", () => terminalSessionService.hydrate()),
]));
```

### 6. Events (`core/types/events.ts`)

Add `TERMINAL_CREATED` and `TERMINAL_UPDATED` events for cross-window sync (following the thread/plan pattern).

In the `EventName` const (near line 97, after `TERMINAL_ARCHIVED`):

```typescript
TERMINAL_CREATED: "terminal:created",
TERMINAL_UPDATED: "terminal:updated",
TERMINAL_ARCHIVED: "terminal:archived",
```

In the `EventPayloads` interface (near line 260, after the existing `TERMINAL_ARCHIVED` entry):

```typescript
[EventName.TERMINAL_CREATED]: { terminalId: string; worktreeId: string };
[EventName.TERMINAL_UPDATED]: { terminalId: string };
[EventName.TERMINAL_ARCHIVED]: { terminalId: string };
```

Add `TERMINAL_CREATED` and `TERMINAL_UPDATED` to the `frontendEventNames` array (near line 465, alongside `TERMINAL_ARCHIVED`).

### 7. Update `updateVisualSettings()` Dispatcher (`src/lib/visual-settings.ts`)

The `"terminal"` case in the dispatcher (created by 01) currently does a store-only update. Update it to use the new service method that also persists to disk:

```typescript
case "terminal": {
  const { terminalSessionService } = await import("@/entities/terminal-sessions/service");
  await terminalSessionService.updateVisualSettings(entityId, patch);
  break;
}
```

### 8. Hooks Update (`src/entities/terminal-sessions/hooks.ts`)

The `useTerminalActions` hook wraps service calls. Update the `createTerminal` and `archiveTerminal` callbacks to match the new service signatures (UUID IDs are now returned from `create()`). The hook itself needs the `writeToTerminal` and `resizeTerminal` callbacks updated since they now use UUIDs that resolve to PTY IDs internally.

No changes needed — the hook already delegates to `terminalSessionService.create(...)` and `terminalSessionService.archive(...)`. The internal ID scheme change is transparent to callers.

### 9. Callers That Use `String(id)` for PTY Mapping

Search for any code that constructs terminal IDs from PTY numeric IDs. The only place this happens is:
- `service.ts` `create()` — already being rewritten (see step 3)
- `listeners.ts` — already being rewritten (see step 4) to use `resolveByPtyId()`

Any component code that passes `session.id` to the service will continue working since the service maps UUID -> PTY ID internally.

## Edge Cases

### PTY ID Reuse After Restart

Rust may assign PTY ID `1` to a new terminal after restart. This is not a problem because:
1. Persisted sessions from the prior session have `ptyId: null`
2. Only live sessions (created this session) have entries in the `ptyIds` map
3. `resolveByPtyId()` only searches the current session's `ptyIds` map

### Exited Terminals and Cleanup

Exited terminals (`isAlive: false`) remain on disk indefinitely. They appear in the sidebar as dimmed. Users archive them via context menu or the existing archive action. Future work could add auto-cleanup of old exited terminals, but that is out of scope for this plan.

### Concurrent Writes

Terminal metadata is only written by the Tauri frontend process (unlike thread metadata which is written by both the frontend and Node agent processes). No read-modify-write pattern is needed — direct writes are safe.

## Acceptance Criteria

- [x] Terminal metadata written to `~/.mort/terminal-sessions/{id}/metadata.json` on create

- [x] Terminal `id` is a stable UUID; PTY numeric ID stored as `ptyId`

- [x] `visualSettings.parentId` set to worktreeId on terminal creation

- [x] Terminals survive app restart (appear as dimmed/exited in sidebar)

- [x] Archive deletes metadata from disk

- [x] `updateVisualSettings()` works for terminal entities and persists to disk

- [x] Terminal exit (`isAlive: false`) is persisted to disk

- [x] Rust PTY events (output, exit, killed) correctly resolve numeric PTY IDs to UUIDs

- [ ] TypeScript compiles: `pnpm tsc --noEmit`

- [ ] Existing tests pass: `pnpm test`

## Phases

- [x] Update `TerminalSessionSchema` in `types.ts` (add `ptyId`, change `id` to UUID, add `visualSettings`)

- [x] Add `hydrate()` and `_apply*` optimistic methods to `store.ts`

- [x] Rewrite `service.ts` with disk persistence: `hydrate()`, `create()`, `archive()`, `updateVisualSettings()`, `markExited()`, `persistMetadata()`

- [x] Update `listeners.ts` to resolve PTY IDs via `resolveByPtyId()`

- [x] Add `TERMINAL_CREATED`/`TERMINAL_UPDATED` events to `core/types/events.ts`

- [x] Register `terminalSessionService.hydrate()` in `src/entities/index.ts` `hydrateEntities()`

- [x] Update `"terminal"` case in `src/lib/visual-settings.ts` dispatcher to use service

- [ ] Verify: `pnpm tsc --noEmit`, `pnpm test`, manual test of terminal create/exit/restart persistence (pending manual verification)

<!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
