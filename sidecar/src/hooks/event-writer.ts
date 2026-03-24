/**
 * Lifecycle event writer for TUI hook bridge.
 *
 * Appends structured events to `~/.anvil/threads/{id}/events.jsonl`.
 * Enables post-session review, cost tracking, and file change tracking.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SidecarLogger } from "../logger.js";

export interface LifecycleEvent {
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export class EventWriter {
  constructor(
    private dataDir: string,
    private log: SidecarLogger,
  ) {}

  /** Append a lifecycle event to the thread's events.jsonl file. */
  write(threadId: string, event: LifecycleEvent): void {
    const dir = join(this.dataDir, "threads", threadId);
    const filePath = join(dir, "events.jsonl");

    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(filePath, JSON.stringify(event) + "\n");
    } catch (err) {
      this.log.warn(`[event-writer] Failed to write event for ${threadId}: ${err}`);
    }
  }

  /** Emit a TOOL_STARTED event. */
  toolStarted(threadId: string, toolName: string, toolUseId: string): void {
    this.write(threadId, {
      type: "TOOL_STARTED",
      timestamp: Date.now(),
      payload: { toolName, toolUseId },
    });
  }

  /** Emit a TOOL_COMPLETED event. */
  toolCompleted(
    threadId: string,
    toolName: string,
    toolUseId: string,
    isError: boolean,
  ): void {
    this.write(threadId, {
      type: "TOOL_COMPLETED",
      timestamp: Date.now(),
      payload: { toolName, toolUseId, isError },
    });
  }

  /** Emit a TOOL_DENIED event. */
  toolDenied(threadId: string, toolName: string, reason: string): void {
    this.write(threadId, {
      type: "TOOL_DENIED",
      timestamp: Date.now(),
      payload: { toolName, reason },
    });
  }

  /** Emit a FILE_MODIFIED event. */
  fileModified(threadId: string, filePath: string, toolUseId: string): void {
    this.write(threadId, {
      type: "FILE_MODIFIED",
      timestamp: Date.now(),
      payload: { filePath, toolUseId },
    });
  }

  /** Emit a SESSION_STARTED event. */
  sessionStarted(threadId: string, workingDirectory: string): void {
    this.write(threadId, {
      type: "SESSION_STARTED",
      timestamp: Date.now(),
      payload: { workingDirectory },
    });
  }

  /** Emit a SESSION_ENDED event. */
  sessionEnded(threadId: string): void {
    this.write(threadId, {
      type: "SESSION_ENDED",
      timestamp: Date.now(),
      payload: {},
    });
  }
}
