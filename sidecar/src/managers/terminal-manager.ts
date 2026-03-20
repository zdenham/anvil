/**
 * Terminal (PTY) session manager.
 *
 * Spawns pseudo-terminal sessions via node-pty, streams output as push events,
 * and supports resize / kill / killByCwd operations.
 *
 * Mirrors the Rust `TerminalManager` in `src-tauri/src/terminal.rs`.
 */

import type { IPty } from "node-pty";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventBroadcaster } from "../push.js";

interface TerminalSession {
  id: number;
  pty: IPty;
  cwd: string;
}

export class TerminalManager {
  private sessions = new Map<number, TerminalSession>();
  private nextId = 1;

  /**
   * Spawn a new PTY session.
   * Returns the session ID.
   */
  spawn(
    cols: number,
    rows: number,
    cwd: string,
    broadcaster: EventBroadcaster,
  ): number {
    const id = this.nextId++;
    const shell = process.env.SHELL ?? "/bin/zsh";
    const home = homedir();

    const env = buildPtyEnv(home, shell);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePty = require("node-pty") as typeof import("node-pty");
    const pty = nodePty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });

    const session: TerminalSession = { id, pty, cwd };
    this.sessions.set(id, session);

    pty.onData((data) => {
      broadcaster.broadcast("terminal:output", { id, data });
    });

    pty.onExit(() => {
      this.sessions.delete(id);
      broadcaster.broadcast("terminal:exit", { id });
    });

    return id;
  }

  /** Write data to a terminal session. */
  write(id: number, data: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Terminal session ${id} not found`);
    }
    session.pty.write(data);
  }

  /** Resize a terminal session. */
  resize(id: number, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Terminal session ${id} not found`);
    }
    session.pty.resize(cols, rows);
  }

  /** Kill a terminal session by ID. */
  kill(id: number, broadcaster: EventBroadcaster): void {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Terminal session ${id} not found`);
    }
    this.sessions.delete(id);
    session.pty.kill();
    broadcaster.broadcast("terminal:killed", { id });
  }

  /** Kill all sessions matching a working directory. Returns killed IDs. */
  killByCwd(cwd: string, broadcaster: EventBroadcaster): number[] {
    const killed: number[] = [];
    for (const [id, session] of this.sessions) {
      if (session.cwd === cwd) {
        this.sessions.delete(id);
        session.pty.kill();
        broadcaster.broadcast("terminal:killed", { id });
        killed.push(id);
      }
    }
    return killed;
  }

  /** List all active session IDs. */
  list(): number[] {
    return Array.from(this.sessions.keys());
  }

  /** Kill all sessions. Called on sidecar shutdown. */
  dispose(): void {
    for (const [, session] of this.sessions) {
      try {
        session.pty.kill();
      } catch {
        // Best-effort cleanup
      }
    }
    this.sessions.clear();
  }
}

/**
 * Build the environment for PTY sessions.
 * Mirrors the Rust terminal environment setup.
 */
function buildPtyEnv(home: string, shell: string): Record<string, string> {
  const dataDir = process.env.MORT_DATA_DIR ?? join(home, ".mort");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    HOME: home,
    USER: process.env.USER ?? "",
    PATH: process.env.PATH ?? "",
  };

  // Shell integration: redirect zsh's ZDOTDIR so our .zshenv loads first.
  // Mirrors src-tauri/src/terminal.rs:98-104
  if (shell.endsWith("zsh")) {
    env.MORT_ORIGINAL_ZDOTDIR = process.env.ZDOTDIR ?? "";
    env.ZDOTDIR = join(dataDir, "shell-integration", "zsh");
  }

  return env;
}
