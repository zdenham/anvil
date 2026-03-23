/**
 * Thread state writer for TUI hook bridge.
 *
 * Manages in-memory ThreadState per active thread using threadReducer.
 * Writes state to disk and broadcasts updates to the frontend.
 * Uses per-thread async mutex to serialize same-thread dispatches.
 */

import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type { ThreadState } from "@core/types/events.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EventBroadcaster } from "../push.js";
import type { SidecarLogger } from "../logger.js";

export class ThreadStateWriter {
  private states = new Map<string, ThreadState>();
  private locks = new Map<string, Promise<void>>();

  constructor(
    private dataDir: string,
    private broadcaster: EventBroadcaster,
    private log: SidecarLogger,
  ) {}

  async dispatch(threadId: string, action: ThreadAction): Promise<void> {
    const prev = this.locks.get(threadId) ?? Promise.resolve();
    const next = prev.then(() => this.applyAction(threadId, action));
    this.locks.set(threadId, next.catch(() => {}));
    await next;
  }

  getState(threadId: string): ThreadState | undefined {
    return this.states.get(threadId) ?? this.loadFromDisk(threadId);
  }

  private applyAction(threadId: string, action: ThreadAction): void {
    let state = this.states.get(threadId) ?? this.loadFromDisk(threadId);
    if (!state) {
      // Auto-init on first action
      state = threadReducer(
        {
          messages: [],
          fileChanges: [],
          workingDirectory: "",
          status: "running",
          timestamp: Date.now(),
          toolStates: {},
          wipMap: {},
          blockIdMap: {},
        },
        action,
      );
    } else {
      state = threadReducer(state, action);
    }
    this.states.set(threadId, state);
    this.writeToDisk(threadId, state);
    this.broadcastUpdate(threadId, action);
  }

  private threadDir(threadId: string): string {
    return join(this.dataDir, "threads", threadId);
  }

  private loadFromDisk(threadId: string): ThreadState | undefined {
    const statePath = join(this.threadDir(threadId), "state.json");
    try {
      if (!existsSync(statePath)) return undefined;
      return JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
    } catch (err) {
      this.log.warn(`Failed to load state for thread ${threadId}: ${err}`);
      return undefined;
    }
  }

  private writeToDisk(threadId: string, state: ThreadState): void {
    const dir = this.threadDir(threadId);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify(state));
    } catch (err) {
      this.log.error(`Failed to write state for thread ${threadId}: ${err}`);
    }
  }

  private broadcastUpdate(threadId: string, action: ThreadAction): void {
    this.broadcaster.broadcast("tui-thread-state", {
      threadId,
      action,
    });
  }

  /** Clean up in-memory state for a thread (e.g., on Stop hook). */
  evict(threadId: string): void {
    this.states.delete(threadId);
    this.locks.delete(threadId);
  }
}
