/**
 * Terminal session service - manages terminal session entities.
 * Delegates PTY lifecycle to PtyService.
 * Persists terminal metadata to ~/.mort/terminal-sessions/{id}/metadata.json.
 */
import { appData } from "@/lib/app-data-store";
import { useTerminalSessionStore } from "./store";
import { TerminalSessionSchema, type TerminalSession } from "./types";
import { logger } from "@/lib/logger-client";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";
import { ptyService } from "@/entities/pty";
import type { VisualSettings } from "@core/types/visual-settings.js";

const TERMINAL_SESSIONS_DIR = "terminal-sessions";

/**
 * Service for managing terminal sessions.
 * Coordinates between PtyService, disk persistence, and the frontend store.
 */
class TerminalSessionService {
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
   * Generates a unique auto-label like "dirname 1", "dirname 2", etc.
   */
  private generateAutoLabel(worktreeId: string, worktreePath: string): string {
    const dirname = worktreePath.split("/").pop() ?? "terminal";
    const existing = this.getByWorktree(worktreeId);
    const n = existing.length + 1;
    return `${dirname} ${n}`;
  }

  /**
   * Creates a new terminal session.
   * Generates a UUID, spawns the PTY via PtyService, persists metadata to disk.
   */
  async create(
    worktreeId: string,
    worktreePath: string,
    cols = 80,
    rows = 24,
    options?: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    },
  ): Promise<TerminalSession> {
    logger.info("[TerminalService] Creating terminal", {
      worktreeId,
      worktreePath,
      cols,
      rows,
      command: options?.command,
    });

    try {
      const id = crypto.randomUUID();

      // Spawn PTY via PtyService (reuse the terminal's UUID as connectionId)
      const { ptyId: numericId } = await ptyService.spawn(
        {
          cwd: worktreePath,
          cols,
          rows,
          command: options?.command,
          args: options?.args,
          env: options?.env,
        },
        id,
      );

      const label = this.generateAutoLabel(worktreeId, worktreePath);

      const session: TerminalSession = {
        id,
        ptyId: numericId,
        worktreeId,
        worktreePath,
        lastCommand: undefined,
        label,
        createdAt: Date.now(),
        isAlive: true,
        isArchived: false,
        visualSettings: {
          parentId: worktreeId,
        },
      };

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
      // Kill the PTY via PtyService
      await ptyService.kill(id);

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
    await ptyService.write(id, data);
  }

  /**
   * Resizes a terminal's PTY.
   */
  async resize(id: string, cols: number, rows: number): Promise<void> {
    await ptyService.resize(id, cols, rows);
  }

  /**
   * Sets a user-assigned label for a terminal (overrides lastCommand in sidebar).
   */
  setLabel(id: string, label: string): void {
    useTerminalSessionStore.getState().updateSession(id, { label, isUserLabel: true });
    // Fire-and-forget disk write — same pattern as updateLastCommand
    this.persistMetadata(id);
  }

  /**
   * Updates the last command for a terminal (for sidebar display).
   */
  updateLastCommand(id: string, command: string): void {
    useTerminalSessionStore.getState().updateSession(id, { lastCommand: command });
    // lastCommand is cosmetic -- fire-and-forget disk write
    this.persistMetadata(id);
  }

  /**
   * Marks a terminal as exited (process ended but still visible).
   * Persists the isAlive: false state to disk.
   */
  markExited(id: string): void {
    useTerminalSessionStore.getState().markExited(id);
    ptyService.unregisterPtyId(id);
    // Persist so exited state survives restart
    this.persistMetadata(id);
  }

  /**
   * Revives a dead terminal by spawning a new PTY and re-associating it.
   * Clears the old output buffer so the user gets a fresh shell.
   */
  async revive(id: string, cols = 80, rows = 24): Promise<void> {
    const session = this.get(id);
    if (!session) throw new Error(`Terminal not found: ${id}`);
    if (session.isAlive || ptyService.isReviving(id)) return;

    try {
      const numericId = await ptyService.revive(id, session.worktreePath, cols, rows);

      useTerminalSessionStore.getState().updateSession(id, {
        isAlive: true,
        ptyId: numericId,
      });

      await this.persistMetadata(id);
      logger.info("[TerminalService] Terminal revived", { terminalId: id, ptyId: numericId });
    } catch (error) {
      logger.error("[TerminalService] Failed to revive terminal", { terminalId: id, error });
      throw error;
    }
  }

  /**
   * Creates a placeholder terminal (no PTY spawned) for lazy activation.
   * The terminal shows in the sidebar and gets a live PTY on first click via revive().
   */
  async createPlaceholder(worktreeId: string, worktreePath: string): Promise<TerminalSession> {
    const id = crypto.randomUUID();
    const label = this.generateAutoLabel(worktreeId, worktreePath);
    const session: TerminalSession = {
      id,
      ptyId: null,
      worktreeId,
      worktreePath,
      label,
      createdAt: Date.now(),
      isAlive: false,
      isArchived: false,
      visualSettings: { parentId: worktreeId },
    };

    useTerminalSessionStore.getState().addSession(session);

    const dirPath = `${TERMINAL_SESSIONS_DIR}/${id}`;
    await appData.ensureDir(dirPath);
    await appData.writeJson(`${dirPath}/metadata.json`, session);

    logger.info("[TerminalService] Placeholder terminal created", { terminalId: id, worktreeId });
    return session;
  }

  /**
   * Ensures each worktree has at least one terminal.
   * Creates lazy placeholders for worktrees with zero terminals.
   */
  async ensureTerminalsForWorktrees(
    worktrees: Array<{ worktreeId: string; worktreePath: string }>
  ): Promise<void> {
    for (const wt of worktrees) {
      const existing = this.getByWorktree(wt.worktreeId);
      if (existing.length === 0) {
        await this.createPlaceholder(wt.worktreeId, wt.worktreePath);
      }
    }
  }

  /**
   * Archives stale dead terminals on hydration.
   * If a worktree has more than one terminal and all are dead, keeps only the newest.
   */
  async cleanupStaleTerminals(): Promise<void> {
    const sessions = this.getAll();
    const byWorktree = new Map<string, TerminalSession[]>();
    for (const s of sessions) {
      const list = byWorktree.get(s.worktreeId) ?? [];
      list.push(s);
      byWorktree.set(s.worktreeId, list);
    }

    for (const [, terminals] of byWorktree) {
      if (terminals.length > 1 && terminals.every(t => !t.isAlive)) {
        const sorted = [...terminals].sort((a, b) => b.createdAt - a.createdAt);
        for (const stale of sorted.slice(1)) {
          await this.archive(stale.id);
        }
      }
    }
  }

  /**
   * Returns true if the given terminal is the last one in its worktree.
   */
  isLastInWorktree(id: string): boolean {
    const session = this.get(id);
    if (!session) return false;
    return this.getByWorktree(session.worktreeId).length <= 1;
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
   * Persists current in-memory state of a terminal session to disk.
   * Fire-and-forget -- logs errors but does not throw.
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
