/**
 * Terminal session service - manages PTY lifecycle via Tauri commands.
 */
import { invoke } from "@/lib/invoke";
import { useTerminalSessionStore } from "./store";
import type { TerminalSession } from "./types";
import { logger } from "@/lib/logger-client";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events.js";

/**
 * Service for managing terminal sessions.
 * Coordinates between the Rust PTY backend and the frontend store.
 */
class TerminalSessionService {
  private readonly encoder = new TextEncoder();
  private readonly numericIds = new Map<string, number>();

  private getNumericId(id: string): number {
    let n = this.numericIds.get(id);
    if (n === undefined) {
      n = parseInt(id, 10);
      this.numericIds.set(id, n);
    }
    return n;
  }

  /**
   * Creates a new terminal session.
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

      const session: TerminalSession = {
        id: String(numericId),
        worktreeId,
        worktreePath,
        lastCommand: undefined,
        createdAt: Date.now(),
        isAlive: true,
        isArchived: false,
      };

      // Add to store
      useTerminalSessionStore.getState().addSession(session);

      logger.info("[TerminalService] Terminal created", {
        terminalId: session.id,
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
   */
  async archive(id: string): Promise<void> {
    logger.info("[TerminalService] Archiving terminal", { terminalId: id });

    try {
      await invoke("kill_terminal", { id: this.getNumericId(id) });
      this.numericIds.delete(id);
      useTerminalSessionStore.getState().removeSession(id);
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
    await invoke("write_terminal", { id: this.getNumericId(id), data: bytes });
  }

  /**
   * Resizes a terminal's PTY.
   */
  async resize(id: string, cols: number, rows: number): Promise<void> {
    await invoke("resize_terminal", {
      id: this.getNumericId(id),
      cols,
      rows,
    });
  }

  /**
   * Updates the last command for a terminal (for sidebar display).
   */
  updateLastCommand(id: string, command: string): void {
    useTerminalSessionStore.getState().updateSession(id, { lastCommand: command });
  }

  /**
   * Marks a terminal as exited (process ended but still visible).
   */
  markExited(id: string): void {
    useTerminalSessionStore.getState().markExited(id);
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
}

export const terminalSessionService = new TerminalSessionService();
