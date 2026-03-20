/**
 * Event broadcaster for server-initiated push messages.
 *
 * Maintains a set of listener functions (one per WS connection) and broadcasts
 * push events to all connected clients. Format: `{"event": "...", "payload": ...}`
 */

import type { WsPushEvent } from "./types.js";

export type PushListener = (event: WsPushEvent) => void;

export class EventBroadcaster {
  private listeners = new Set<PushListener>();

  /** Register a listener. Returns an unsubscribe function. */
  subscribe(listener: PushListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Broadcast an event to all connected clients. */
  broadcast(event: string, payload: unknown): number {
    const pushEvent: WsPushEvent = { event, payload };
    for (const listener of this.listeners) {
      try {
        listener(pushEvent);
      } catch {
        // Ignore errors from individual listeners
      }
    }
    return this.listeners.size;
  }

  /** Number of active listeners. */
  get size(): number {
    return this.listeners.size;
  }
}
