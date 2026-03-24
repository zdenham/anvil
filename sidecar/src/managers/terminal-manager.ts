/**
 * Terminal (PTY) session manager.
 *
 * Spawns pseudo-terminal sessions via node-pty, streams output as push events,
 * and supports resize / kill / killByCwd operations.
 *
 * Mirrors the Rust `TerminalManager` in `src-tauri/src/terminal.rs`.
 */

import type { IPty } from "node-pty";
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
import type { EventBroadcaster } from "../push.js";

let nodePty: typeof import("node-pty") | undefined;

function getNodePty(): typeof import("node-pty") {
  if (nodePty) return nodePty;

  // Tauri resource bundling strips the execute bit from native binaries.
  // Ensure spawn-helper is executable before node-pty tries to use it.
  const helperPath = join(
    dirname(require.resolve("node-pty/package.json")),
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (existsSync(helperPath)) {
    chmodSync(helperPath, 0o755);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodePty = require("node-pty") as typeof import("node-pty");
  return nodePty;
}

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
   *
   * When `command` is provided, spawns that binary instead of the user's shell.
   * Extra `extraEnv` entries are merged into the child process environment.
   */
  spawn(
    cols: number,
    rows: number,
    cwd: string,
    broadcaster: EventBroadcaster,
    options?: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    },
  ): number {
    const id = this.nextId++;
    const shell = process.env.SHELL ?? "/bin/zsh";
    const home = homedir();

    const baseEnv = buildPtyEnv(home, shell);
    const env = options?.env
      ? { ...baseEnv, ...options.env }
      : baseEnv;

    const bin = options?.command ?? shell;
    const binArgs = options?.command ? (options.args ?? []) : ["-l"];

    const pty = getNodePty().spawn(bin, binArgs, {
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
  const dataDir = process.env.ANVIL_DATA_DIR ?? join(home, ".anvil");

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
    env.ANVIL_ORIGINAL_ZDOTDIR = process.env.ZDOTDIR ?? "";
    env.ZDOTDIR = join(dataDir, "shell-integration", "zsh");
  }

  return env;
}
