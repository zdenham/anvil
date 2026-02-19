/**
 * Heartbeat emitter for agent-to-hub liveness signaling.
 *
 * Keeps heartbeat timer logic separate from HubClient (single responsibility).
 * The frontend uses missing heartbeats to detect agent staleness.
 */
export class HeartbeatEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sendFn: (msg: { type: string; timestamp: number }) => boolean | void,
    private intervalMs = 5000,
  ) {}

  /** Start emitting heartbeats at the configured interval. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sendFn({ type: "heartbeat", timestamp: Date.now() });
    }, this.intervalMs);
  }

  /** Stop emitting heartbeats and clear the timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the heartbeat timer is currently active. */
  get isRunning(): boolean {
    return this.timer !== null;
  }
}
