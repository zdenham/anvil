import { threadService } from "@/entities";
import { eventBus } from "@/entities/events";
import { EventName, type EventPayloads } from "@core/types/events.js";
import { logger } from "./logger-client";
import { useHeartbeatStore } from "@/stores/heartbeat-store";

// ============================================================================
// Constants
// ============================================================================

/** Polling interval when heartbeats are stale (ms) */
const POLL_INTERVAL_MS = 3_000;

// ============================================================================
// Active Polling Trackers
// ============================================================================

/** Active polling intervals keyed by threadId */
const activePollers = new Map<string, ReturnType<typeof setInterval>>();

// ============================================================================
// Recovery Functions
// ============================================================================

/**
 * Recovers thread state from disk and emits it to the event bus.
 * This is the primary recovery mechanism — leverages the "disk as truth" pattern.
 *
 * @param threadId - Thread to recover state for
 */
export async function recoverStateFromDisk(threadId: string): Promise<void> {
  logger.info(`[state-recovery] Recovering state from disk for thread ${threadId}`);

  try {
    await threadService.loadThreadState(threadId);
    useHeartbeatStore.getState().incrementRecoveryCount(threadId);
    logger.info(`[state-recovery] Disk recovery successful for thread ${threadId}`);
  } catch (error) {
    logger.error(`[state-recovery] Disk recovery failed for thread ${threadId}:`, error);
  }
}

/**
 * Starts polling state.json from disk for a thread.
 * Used as fallback when heartbeats go stale — ensures the UI catches up
 * even if the event pipeline is completely broken.
 *
 * Safe to call multiple times for the same thread — existing poller is reused.
 *
 * @param threadId - Thread to start polling for
 */
export function startRecoveryPolling(threadId: string): void {
  if (activePollers.has(threadId)) {
    logger.debug(`[state-recovery] Polling already active for thread ${threadId}`);
    return;
  }

  logger.info(`[state-recovery] Starting recovery polling for thread ${threadId}`);

  const interval = setInterval(async () => {
    // Stop polling if heartbeats have resumed (healthy)
    const entry = useHeartbeatStore.getState().heartbeats[threadId];
    if (!entry || entry.status === "healthy") {
      stopRecoveryPolling(threadId);
      return;
    }

    await recoverStateFromDisk(threadId);
  }, POLL_INTERVAL_MS);

  activePollers.set(threadId, interval);
}

/**
 * Stops recovery polling for a specific thread.
 *
 * @param threadId - Thread to stop polling for
 */
export function stopRecoveryPolling(threadId: string): void {
  const interval = activePollers.get(threadId);
  if (interval) {
    clearInterval(interval);
    activePollers.delete(threadId);
    logger.info(`[state-recovery] Stopped recovery polling for thread ${threadId}`);
  }
}

/**
 * Stops all active recovery polling.
 * Call on app unmount or cleanup.
 */
export function stopAllRecoveryPolling(): void {
  for (const [, interval] of activePollers) {
    clearInterval(interval);
  }
  activePollers.clear();
}

/**
 * Handles a thread going stale — triggers immediate disk recovery
 * and starts polling fallback.
 *
 * @param threadId - Thread that has gone stale
 */
export async function handleStaleness(threadId: string): Promise<void> {
  logger.warn(`[state-recovery] Handling staleness for thread ${threadId}`);

  // Immediate disk recovery
  await recoverStateFromDisk(threadId);

  // Start polling fallback
  startRecoveryPolling(threadId);
}

// ============================================================================
// Cleanup on Agent Completion
// ============================================================================

/**
 * Sets up listeners to clean up recovery polling when agents complete.
 * Call once at app initialization.
 */
export function setupRecoveryCleanupListeners(): () => void {
  const handleCompleted = ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    stopRecoveryPolling(threadId);
  };

  const handleCancelled = ({ threadId }: EventPayloads[typeof EventName.AGENT_CANCELLED]) => {
    stopRecoveryPolling(threadId);
  };

  eventBus.on(EventName.AGENT_COMPLETED, handleCompleted);
  eventBus.on(EventName.AGENT_CANCELLED, handleCancelled);

  return () => {
    eventBus.off(EventName.AGENT_COMPLETED, handleCompleted);
    eventBus.off(EventName.AGENT_CANCELLED, handleCancelled);
  };
}
