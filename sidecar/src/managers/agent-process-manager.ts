/**
 * Agent process lifecycle manager.
 *
 * Spawns Node.js child processes, streams their output as push events,
 * and supports graceful cancel (SIGTERM with SIGKILL escalation).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { EventBroadcaster } from "../push.js";

interface AgentEntry {
  pid: number;
  process: ChildProcess;
  threadId: string;
}

export class AgentProcessManager {
  private agents = new Map<string, AgentEntry>();

  /**
   * Spawn an agent process and stream its output.
   * Returns `{ pid }`.
   */
  spawn(
    threadId: string,
    commandArgs: string[],
    cwd: string,
    env: Record<string, string>,
    broadcaster: EventBroadcaster,
  ): { pid: number } {
    const child = spawn("node", commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error("Process exited immediately");
    }

    this.agents.set(threadId, { pid, process: child, threadId });

    // Stream stdout line by line
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        broadcaster.broadcast(`agent_stdout:${threadId}`, {
          data: `${line}\n`,
        });
      });
    }

    // Stream stderr line by line
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on("line", (line) => {
        broadcaster.broadcast(`agent_stderr:${threadId}`, {
          data: `${line}\n`,
        });
      });
    }

    // Watch for exit
    child.on("close", (code, signal) => {
      this.agents.delete(threadId);
      broadcaster.broadcast(`agent_close:${threadId}`, {
        code,
        signal,
      });
    });

    return { pid };
  }

  /** Kill an agent by threadId with SIGTERM. */
  kill(threadId: string): { killed: boolean } {
    const entry = this.agents.get(threadId);
    if (!entry) {
      return { killed: false };
    }
    try {
      process.kill(-entry.pid, "SIGTERM");
    } catch {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        return { killed: false };
      }
    }
    return { killed: true };
  }

  /** Cancel an agent: SIGTERM with 5s escalation to SIGKILL. */
  async cancel(threadId: string): Promise<boolean> {
    const entry = this.agents.get(threadId);
    if (!entry) {
      return false;
    }

    // Send SIGTERM
    try {
      process.kill(-entry.pid, "SIGTERM");
    } catch {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        return false;
      }
    }

    // Wait for exit or escalate after 5s
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        entry.process.on("close", () => resolve(true));
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 5000);
      }),
    ]);

    if (!exited) {
      try {
        process.kill(-entry.pid, "SIGKILL");
      } catch {
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch {
          // Already dead
        }
      }
    }

    return true;
  }

  /** List all connected agent thread IDs. */
  list(): string[] {
    return Array.from(this.agents.keys());
  }
}
