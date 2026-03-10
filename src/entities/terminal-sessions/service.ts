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
  /** Maps terminal UUID -> numeric PTY ID for Rust IPC */
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
    // lastCommand is cosmetic -- fire-and-forget disk write
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
