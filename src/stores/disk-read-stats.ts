import { logger } from "@/lib/logger-client.js";

interface ThreadStats {
  metadataReads: number;
  fullStateReads: number;
  gapTriggeredReads: number;
  deltaApplied: number;
  streamGaps: number;
}

/**
 * Lightweight diagnostic counters for tracking disk-read frequency during streaming.
 * Exposed on `window.__diskReadStats` for devtools inspection.
 *
 * Key ratio: `gapTriggeredReads / (deltaApplied + gapTriggeredReads)` — if high,
 * the event chain is broken frequently and deltas aren't helping.
 */
class DiskReadStats {
  private stats: Record<string, ThreadStats> = {};
  private logIntervalId: ReturnType<typeof setInterval> | null = null;

  private ensure(threadId: string): ThreadStats {
    if (!this.stats[threadId]) {
      this.stats[threadId] = {
        metadataReads: 0,
        fullStateReads: 0,
        gapTriggeredReads: 0,
        deltaApplied: 0,
        streamGaps: 0,
      };
    }
    return this.stats[threadId];
  }

  recordMetadataRead(threadId: string): void {
    this.ensure(threadId).metadataReads++;
  }

  recordFullStateRead(threadId: string): void {
    this.ensure(threadId).fullStateReads++;
  }

  recordGapTriggeredRead(threadId: string): void {
    const s = this.ensure(threadId);
    s.fullStateReads++;
    s.gapTriggeredReads++;
  }

  recordDeltaApplied(threadId: string): void {
    this.ensure(threadId).deltaApplied++;
  }

  recordStreamGap(threadId: string): void {
    this.ensure(threadId).streamGaps++;
  }

  /** Returns a snapshot of all per-thread stats. */
  snapshot(): Record<string, ThreadStats> {
    return structuredClone(this.stats);
  }

  /** Clears stats for a specific thread. */
  clear(threadId: string): void {
    delete this.stats[threadId];
  }

  /** Starts periodic logging (every 10s) of non-zero stats. */
  startPeriodicLog(): void {
    if (this.logIntervalId) return;
    this.logIntervalId = setInterval(() => {
      for (const [threadId, s] of Object.entries(this.stats)) {
        const total = s.deltaApplied + s.gapTriggeredReads + s.fullStateReads;
        if (total === 0) continue;
        const gapRatio = s.gapTriggeredReads / (s.deltaApplied + s.gapTriggeredReads) || 0;
        logger.info(
          `[disk-read-stats] ${threadId}: metadata=${s.metadataReads} fullState=${s.fullStateReads} gapTriggered=${s.gapTriggeredReads} deltaApplied=${s.deltaApplied} streamGaps=${s.streamGaps} gapRatio=${(gapRatio * 100).toFixed(1)}%`,
        );
      }
    }, 10_000);
  }

  stopPeriodicLog(): void {
    if (this.logIntervalId) {
      clearInterval(this.logIntervalId);
      this.logIntervalId = null;
    }
  }
}

export const diskReadStats = new DiskReadStats();

// Expose on window for devtools inspection
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__diskReadStats = diskReadStats;
}
