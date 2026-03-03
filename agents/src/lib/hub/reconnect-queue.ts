/**
 * Bounded queue for messages buffered during hub reconnection.
 *
 * Smart dedup: only keeps the latest state message per threadId,
 * but preserves all event messages. When full, drops oldest
 * non-state messages first to avoid losing critical state updates.
 */
import type { SocketMessage } from "./types.js";

const DEFAULT_MAX_SIZE = 50;

export class ReconnectQueue {
  private queue: SocketMessage[] = [];
  private peakDepth = 0;

  constructor(private maxSize = DEFAULT_MAX_SIZE) {}

  /** Enqueue a message with smart dedup for state and state_event messages. */
  push(msg: SocketMessage): void {
    if (msg.type === "state") {
      const idx = this.queue.findIndex(
        (m) => m.type === "state" && m.threadId === msg.threadId,
      );
      if (idx >= 0) {
        this.queue[idx] = msg;
        return;
      }
    }

    if (msg.type === "state_event") {
      const idx = this.queue.findIndex(
        (m) => m.type === "state_event" && m.threadId === msg.threadId,
      );
      if (idx >= 0) {
        // Replace with latest event, force full resync after reconnect
        this.queue[idx] = { ...msg, previousEventId: null };
        return;
      }
    }

    if (this.queue.length >= this.maxSize) {
      // Drop oldest non-state/non-state_event message to make room
      const dropIdx = this.queue.findIndex(
        (m) => m.type !== "state" && m.type !== "state_event",
      );
      if (dropIdx >= 0) {
        this.queue.splice(dropIdx, 1);
      } else {
        this.queue.shift();
      }
    }

    this.queue.push(msg);
    if (this.queue.length > this.peakDepth) {
      this.peakDepth = this.queue.length;
    }
  }

  /** Drain all queued messages and return them. */
  flush(): SocketMessage[] {
    return this.queue.splice(0);
  }

  get depth(): number {
    return this.queue.length;
  }

  get maxDepthSeen(): number {
    return this.peakDepth;
  }
}
