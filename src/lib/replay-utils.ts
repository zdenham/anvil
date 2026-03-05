import { clearChainState } from "@/entities/threads/listeners";
import { useThreadStore } from "@/entities/threads/store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { cleanupSeqTracking } from "@/lib/agent-service";
import { diskReadStats } from "@/stores/disk-read-stats";
import { stopRecoveryPolling } from "@/lib/state-recovery";
import { logger } from "@/lib/logger-client";

/**
 * Clears all runtime state for a thread to prepare for replay.
 *
 * Clears threadStates[threadId] (render state) but NOT threads[threadId] (metadata).
 * The thread still exists in the sidebar — we only wipe its runtime state.
 */
export function clearThreadStateForReplay(threadId: string): void {
  logger.info(`[replay-utils] Clearing thread state for replay: ${threadId}`);

  // 1. Clear chain tracking + destroy ThreadStateMachine
  clearChainState(threadId);

  // 2. Clear Zustand render state (also destroys machine — redundant but safe)
  useThreadStore.getState().setThreadState(threadId, null);

  // 3. Clear heartbeat tracking
  useHeartbeatStore.getState().removeThread(threadId);

  // 4. Clear pipeline sequence tracking
  cleanupSeqTracking(threadId);

  // 5. Clear disk read stats
  diskReadStats.clear(threadId);

  // 6. Stop any active recovery polling
  stopRecoveryPolling(threadId);
}
