/**
 * PtyService — low-level PTY connection manager.
 *
 * Owns the lifecycle of raw PTY connections (spawn, write, resize, kill)
 * and the ptyId ↔ connectionId mapping. Both TerminalSessionService and
 * TUI thread lifecycle use this service instead of calling `invoke()` directly.
 *
 * A `connectionId` is a UUID that the caller (terminal session or TUI thread)
 * uses as its handle into the PTY layer.
 */
import { invoke } from "@/lib/invoke";
import { ensureShellIntegration } from "@/entities/terminal-sessions/shell-integration";
import { clearOutputBuffer } from "./output-buffer";
import { logger } from "@/lib/logger-client";

export interface PtySpawnOptions {
  cwd: string;
  cols?: number;
  rows?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PtySpawnResult {
  connectionId: string;
  ptyId: number;
}

class PtyService {
  /** Maps connectionId (UUID) → numeric PTY ID for Rust IPC */
  private readonly ptyIds = new Map<string, number>();

  /** Guards against concurrent revive calls for the same connection */
  private readonly revivingIds = new Set<string>();

  /**
   * Spawns a new PTY process.
   *
   * Ensures shell integration is installed, then invokes the sidecar
   * to create the PTY. Returns a new connectionId + the numeric ptyId.
   *
   * If `connectionId` is provided, reuses it (for revive scenarios).
   * Otherwise generates a fresh UUID.
   */
  async spawn(options: PtySpawnOptions, connectionId?: string): Promise<PtySpawnResult> {
    const { cwd, cols = 80, rows = 24, command, args, env } = options;

    // Ensure shell integration script exists before spawning
    await ensureShellIntegration();

    const ptyId = await invoke<number>("spawn_terminal", {
      cols,
      rows,
      cwd,
      ...(command && { command }),
      ...(args && { args }),
      ...(env && { env }),
    });

    const connId = connectionId ?? crypto.randomUUID();
    this.ptyIds.set(connId, ptyId);

    logger.info("[PtyService] Spawned PTY", { connectionId: connId, ptyId, cwd, command });
    return { connectionId: connId, ptyId };
  }

  /**
   * Writes data to a PTY connection.
   */
  async write(connectionId: string, data: string): Promise<void> {
    await invoke("write_terminal", { id: this.getPtyId(connectionId), data });
  }

  /**
   * Resizes a PTY connection.
   */
  async resize(connectionId: string, cols: number, rows: number): Promise<void> {
    await invoke("resize_terminal", { id: this.getPtyId(connectionId), cols, rows });
  }

  /**
   * Kills a PTY connection.
   */
  async kill(connectionId: string): Promise<void> {
    const ptyId = this.ptyIds.get(connectionId);
    if (ptyId === undefined) return;

    await invoke("kill_terminal", { id: ptyId });
    this.ptyIds.delete(connectionId);
    logger.info("[PtyService] Killed PTY", { connectionId, ptyId });
  }

  /**
   * Revives a dead PTY by spawning a new one and reassociating the connectionId.
   * Clears the old output buffer so the new process starts clean.
   * Returns the new ptyId.
   */
  async revive(connectionId: string, cwd: string, cols = 80, rows = 24): Promise<number> {
    if (this.revivingIds.has(connectionId)) {
      throw new Error(`Already reviving connection ${connectionId}`);
    }

    this.revivingIds.add(connectionId);
    try {
      logger.info("[PtyService] Reviving PTY", { connectionId });

      // Clear old output so the new shell starts clean
      clearOutputBuffer(connectionId);

      const ptyId = await invoke<number>("spawn_terminal", { cols, rows, cwd });
      this.ptyIds.set(connectionId, ptyId);

      logger.info("[PtyService] PTY revived", { connectionId, ptyId });
      return ptyId;
    } finally {
      this.revivingIds.delete(connectionId);
    }
  }

  /**
   * Whether a revive is currently in progress for this connection.
   */
  isReviving(connectionId: string): boolean {
    return this.revivingIds.has(connectionId);
  }

  /**
   * Registers a ptyId mapping for an existing connection.
   * Used during hydration or when the caller already has the ptyId.
   */
  registerPtyId(connectionId: string, ptyId: number): void {
    this.ptyIds.set(connectionId, ptyId);
  }

  /**
   * Resolves a Rust PTY numeric ID to a connectionId (UUID).
   * Used by listeners that receive events keyed by ptyId.
   */
  resolveByPtyId(ptyId: number): string | undefined {
    for (const [connId, pid] of this.ptyIds.entries()) {
      if (pid === ptyId) return connId;
    }
    return undefined;
  }

  /**
   * Returns the numeric ptyId for a connectionId, or undefined if not registered.
   */
  getPtyIdOrUndefined(connectionId: string): number | undefined {
    return this.ptyIds.get(connectionId);
  }

  /**
   * Removes the ptyId mapping for a connection (on exit / cleanup).
   */
  unregisterPtyId(connectionId: string): void {
    this.ptyIds.delete(connectionId);
  }

  /**
   * Returns the numeric ptyId for a connectionId, or throws.
   */
  private getPtyId(connectionId: string): number {
    const ptyId = this.ptyIds.get(connectionId);
    if (ptyId === undefined) {
      throw new Error(`No PTY ID for connection ${connectionId}`);
    }
    return ptyId;
  }
}

export const ptyService = new PtyService();
