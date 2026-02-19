import type { HubClient } from "./hub/client.js";
import type { DrainEventNameType, DrainEventPayloads } from "@core/types/drain-events.js";

/**
 * Type-safe wrapper around HubClient.sendDrain().
 *
 * Provides:
 * 1. Type-safe emit() that maps event names to their property schemas
 * 2. Graceful no-op when hub is not connected (agents without hub still work)
 * 3. Timing helpers (startTimer / endTimer) for duration tracking
 *
 * No buffering — events are already buffered by the Rust SQLite worker.
 * TS side is fire-and-forget.
 */
export class DrainManager {
  private timers = new Map<string, number>();

  constructor(private hub: HubClient | null) {}

  /**
   * Emit a typed drain event. No-op if hub is not connected.
   */
  emit<E extends DrainEventNameType>(
    event: E,
    properties: DrainEventPayloads[E],
  ): void {
    if (!this.hub?.isConnected) return;

    // Flatten to Record<string, string | number | boolean>
    // (already flat by schema design, but satisfies the wire type)
    const flat: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v !== undefined && v !== null) {
        flat[k] = v as string | number | boolean;
      }
    }
    this.hub.sendDrain(event, flat);
  }

  /**
   * Start a timer for a keyed operation (e.g. tool use ID).
   * Returns the start timestamp for immediate use.
   */
  startTimer(key: string): number {
    const now = Date.now();
    this.timers.set(key, now);
    return now;
  }

  /**
   * End a timer and return elapsed milliseconds.
   * Returns 0 if timer was never started (defensive).
   */
  endTimer(key: string): number {
    const start = this.timers.get(key);
    this.timers.delete(key);
    if (!start) return 0;
    return Date.now() - start;
  }
}
