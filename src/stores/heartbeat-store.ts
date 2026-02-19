import { create } from "zustand";
import { logger } from "@/lib/logger-client";

// ============================================================================
// Types
// ============================================================================

/** Heartbeat health status for a single thread */
export type HeartbeatStatus = "healthy" | "degraded" | "stale";

/** Per-thread heartbeat tracking entry */
export interface HeartbeatEntry {
  /** Agent-side timestamp from heartbeat message */
  lastTimestamp: number;
  /** Local receipt time (Date.now()) */
  lastReceivedAt: number;
  /** Sequence number from pipeline stamp */
  lastSeq: number;
  /** Consecutive missed heartbeats */
  missedCount: number;
  /** Current health status */
  status: HeartbeatStatus;
}

/** Sequence gap record for diagnostic display */
export interface SeqGapRecord {
  threadId: string;
  expectedSeq: number;
  receivedSeq: number;
  gapSize: number;
  timestamp: number;
  lastStage: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Interval for checking heartbeat freshness (ms) */
const MONITOR_INTERVAL_MS = 3_000;

/** Threshold for healthy -> degraded transition (ms) */
const DEGRADED_THRESHOLD_MS = 8_000;

/** Threshold for degraded -> stale transition (ms) */
const STALE_THRESHOLD_MS = 15_000;

/** Maximum gap records to retain per thread */
const MAX_GAP_RECORDS = 50;

// ============================================================================
// Store Interface
// ============================================================================

interface HeartbeatState {
  heartbeats: Record<string, HeartbeatEntry>;
  /** Recent sequence gaps for diagnostics */
  gapRecords: SeqGapRecord[];
  /** Per-thread cumulative gap stats */
  gapStats: Record<string, { totalGaps: number; totalDropped: number; recoveryCount: number }>;

  // Actions
  updateHeartbeat(threadId: string, timestamp: number, seq: number): void;
  removeThread(threadId: string): void;
  addGapRecord(record: SeqGapRecord): void;
  incrementRecoveryCount(threadId: string): void;
}

// ============================================================================
// Store
// ============================================================================

export const useHeartbeatStore = create<HeartbeatState>((set) => ({
  heartbeats: {},
  gapRecords: [],
  gapStats: {},

  updateHeartbeat(threadId: string, timestamp: number, seq: number): void {
    set((state) => {
      const prev = state.heartbeats[threadId];
      const now = Date.now();
      const newStatus: HeartbeatStatus = "healthy";

      // Log status transitions (always-on, not diagnostic-gated)
      if (prev && prev.status !== "healthy") {
        logger.info(
          `[heartbeat] Thread ${threadId} recovered — heartbeats resumed`
        );
      }

      return {
        heartbeats: {
          ...state.heartbeats,
          [threadId]: {
            lastTimestamp: timestamp,
            lastReceivedAt: now,
            lastSeq: seq,
            missedCount: 0,
            status: newStatus,
          },
        },
      };
    });
  },

  removeThread(threadId: string): void {
    set((state) => {
      const { [threadId]: _, ...rest } = state.heartbeats;
      const { [threadId]: __, ...restStats } = state.gapStats;
      return {
        heartbeats: rest,
        gapStats: restStats,
        gapRecords: state.gapRecords.filter((r) => r.threadId !== threadId),
      };
    });
  },

  addGapRecord(record: SeqGapRecord): void {
    set((state) => {
      const records = [...state.gapRecords, record];
      // Keep bounded
      const trimmed =
        records.length > MAX_GAP_RECORDS
          ? records.slice(records.length - MAX_GAP_RECORDS)
          : records;

      const prevStats = state.gapStats[record.threadId] ?? {
        totalGaps: 0,
        totalDropped: 0,
        recoveryCount: 0,
      };

      return {
        gapRecords: trimmed,
        gapStats: {
          ...state.gapStats,
          [record.threadId]: {
            ...prevStats,
            totalGaps: prevStats.totalGaps + 1,
            totalDropped: prevStats.totalDropped + record.gapSize,
          },
        },
      };
    });
  },

  incrementRecoveryCount(threadId: string): void {
    set((state) => {
      const prev = state.gapStats[threadId] ?? {
        totalGaps: 0,
        totalDropped: 0,
        recoveryCount: 0,
      };
      return {
        gapStats: {
          ...state.gapStats,
          [threadId]: {
            ...prev,
            recoveryCount: prev.recoveryCount + 1,
          },
        },
      };
    });
  },
}));

// ============================================================================
// Heartbeat Monitor — runs on an interval, checks freshness
// ============================================================================

/** Callback type for staleness transitions */
export type OnStaleCallback = (threadId: string) => void;

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let staleCallback: OnStaleCallback | null = null;

/**
 * Evaluates heartbeat freshness for all tracked threads.
 * Called on the monitor interval. Updates status and fires
 * the stale callback when a thread transitions to stale.
 */
function evaluateHeartbeats(): void {
  const state = useHeartbeatStore.getState();
  const now = Date.now();
  const updates: Record<string, HeartbeatEntry> = {};
  let changed = false;

  for (const [threadId, entry] of Object.entries(state.heartbeats)) {
    const elapsed = now - entry.lastReceivedAt;
    let newStatus: HeartbeatStatus;

    if (elapsed < DEGRADED_THRESHOLD_MS) {
      newStatus = "healthy";
    } else if (elapsed < STALE_THRESHOLD_MS) {
      newStatus = "degraded";
    } else {
      newStatus = "stale";
    }

    if (newStatus !== entry.status) {
      changed = true;

      const missedCount =
        newStatus === "healthy" ? 0 : entry.missedCount + 1;

      // Log status transitions (always-on)
      if (entry.status === "healthy" && newStatus === "degraded") {
        logger.warn(
          `[heartbeat] Thread ${threadId} degraded — ${missedCount} missed heartbeats`
        );
      } else if (entry.status === "degraded" && newStatus === "stale") {
        logger.warn(
          `[heartbeat] Thread ${threadId} stale — triggering disk recovery`
        );
      } else if (newStatus === "healthy" && entry.status !== "healthy") {
        logger.info(
          `[heartbeat] Thread ${threadId} recovered — heartbeats resumed`
        );
      }

      updates[threadId] = {
        ...entry,
        missedCount,
        status: newStatus,
      };

      // Fire stale callback on transition to stale
      if (newStatus === "stale" && entry.status !== "stale") {
        staleCallback?.(threadId);
      }
    }
  }

  if (changed) {
    useHeartbeatStore.setState((prev) => ({
      heartbeats: { ...prev.heartbeats, ...updates },
    }));
  }
}

/**
 * Starts the heartbeat monitoring interval.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param onStale - Called when a thread transitions to stale status
 */
export function startHeartbeatMonitor(onStale: OnStaleCallback): void {
  if (monitorInterval) return;
  staleCallback = onStale;
  monitorInterval = setInterval(evaluateHeartbeats, MONITOR_INTERVAL_MS);
  logger.info("[heartbeat] Monitor started");
}

/**
 * Stops the heartbeat monitoring interval.
 */
export function stopHeartbeatMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    staleCallback = null;
    logger.info("[heartbeat] Monitor stopped");
  }
}
