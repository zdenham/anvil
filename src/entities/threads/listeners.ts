import { EventName, EventPayloads } from "@core/types/events.js";
import { invoke } from "@/lib/invoke";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { useThreadStore, clearMachineState } from "./store.js";
import { getVisibleThreadIds } from "@/stores/pane-layout/store.js";
import { logger } from "@/lib/logger-client.js";
import { useHeartbeatStore, startHeartbeatMonitor, stopHeartbeatMonitor } from "@/stores/heartbeat-store.js";
import { handleStaleness, setupRecoveryCleanupListeners } from "@/lib/state-recovery.js";
import { settingsService } from "../settings/service.js";
import { isAgentRunning, sendToAgent } from "@/lib/agent-service.js";
import { treeMenuService } from "@/stores/tree-menu/service.js";

/**
 * Clears chain state for a thread (e.g. on deactivation or panel hide).
 * Also destroys the machine so next activation triggers a full HYDRATE.
 */
export function clearChainState(threadId: string): void {
  clearMachineState(threadId);
}

/**
 * Syncs usage fields from ThreadState into thread metadata (in-memory only).
 * Replaces the disk read that refreshById() was doing during streaming.
 * The sidebar cost display reads from thread metadata, so we copy
 * cumulativeUsage and lastCallUsage from the applied ThreadState.
 */
function syncUsageFromState(threadId: string, store: ReturnType<typeof useThreadStore.getState>): void {
  const threadState = store.threadStates[threadId];
  if (!threadState) return;

  const thread = store.threads[threadId];
  if (!thread) return;

  const hasUsageChanged =
    threadState.cumulativeUsage !== thread.cumulativeUsage ||
    threadState.lastCallUsage !== thread.lastCallUsage;

  if (hasUsageChanged) {
    store._applyUpdate(threadId, {
      ...thread,
      cumulativeUsage: threadState.cumulativeUsage,
      lastCallUsage: threadState.lastCallUsage,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Setup thread event listeners.
 */
export function setupThreadListeners(): () => void {
  const handleOptimisticCreated = ({ threadId, repoId, worktreeId, prompt, status, permissionMode }: EventPayloads[typeof EventName.THREAD_OPTIMISTIC_CREATED]) => {
    const eventReceivedAt = Date.now();
    try {
      const existingThread = useThreadStore.getState().threads[threadId];
      if (existingThread) {
        logger.info(`[ThreadListener:TIMING] Thread ${threadId} already in store, skipping optimistic create`, {
          threadId,
          timestamp: new Date(eventReceivedAt).toISOString(),
        });
        return;
      }

      logger.info(`[ThreadListener:TIMING] Creating optimistic thread ${threadId}`, {
        threadId,
        hasPrompt: !!prompt,
        promptLength: prompt?.length ?? 0,
        timestamp: new Date(eventReceivedAt).toISOString(),
      });
      threadService.createOptimistic({
        id: threadId,
        repoId,
        worktreeId,
        status,
        prompt,
        permissionMode,
      });
      logger.info(`[ThreadListener:TIMING] Optimistic thread ${threadId} created in store`, {
        threadId,
        elapsedMs: Date.now() - eventReceivedAt,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.error(`[ThreadListener] Failed to create optimistic thread ${threadId}:`, e);
    }
  };

  const handleCreated = async ({ threadId, source }: EventPayloads[typeof EventName.THREAD_CREATED]) => {
    try {
      await threadService.refreshById(threadId);

      // Auto-expand parent when REPL spawns a child
      if (source === "mort-repl:child-spawn") {
        const thread = threadService.get(threadId);
        if (thread?.parentThreadId) {
          await treeMenuService.expandSection(`thread:${thread.parentThreadId}`);
        }
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
    }
  };

  const handleUpdated = async ({ threadId }: EventPayloads[typeof EventName.THREAD_UPDATED]) => {
    try {
      await threadService.refreshById(threadId);

      // Cascade: refresh ancestor chain so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh updated thread ${threadId}:`, e);
    }
  };

  const handleStatusChanged = async ({ threadId }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
    try {
      await threadService.refreshById(threadId);

      const thread = threadService.get(threadId);

      // Cascade: when parent is cancelled, optimistically cancel running children in store.
      // The agent already wrote cancelled status to disk (metadata.json) — this just
      // updates the in-memory store so the UI reflects the change immediately.
      if (thread?.status === "cancelled") {
        const store = useThreadStore.getState();
        const runningChildren = store._threadsArray
          .filter(t => t.parentThreadId === threadId && t.status === "running");
        for (const child of runningChildren) {
          store._applyOptimistic({ ...child, status: "cancelled" });
        }
      }

      // Mark thread as unread when it transitions to running status
      if (thread?.status === "running") {
        await useThreadStore.getState().markThreadAsUnread(threadId);
        logger.info(`[ThreadListener] Marked thread ${threadId} as unread (status: running)`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread status ${threadId}:`, e);
    }
  };

  const handleAction = ({ threadId, action }: EventPayloads[typeof EventName.THREAD_ACTION]) => {
    const store = useThreadStore.getState();
    store.dispatch(threadId, { type: "THREAD_ACTION", action });
    syncUsageFromState(threadId, useThreadStore.getState());
  };

  const handleStreamDelta = (payload: EventPayloads[typeof EventName.STREAM_DELTA]) => {
    if (!payload.messageId) {
      logger.warn("[ThreadListener] stream_delta missing messageId, skipping");
      return;
    }
    const store = useThreadStore.getState();
    store.dispatch(payload.threadId, {
      type: "THREAD_ACTION",
      action: { type: "STREAM_DELTA", payload: { anthropicMessageId: payload.messageId, deltas: payload.deltas } },
    });
  };

  const handleAgentCompleted = async ({ threadId, exitCode }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    try {
      const store = useThreadStore.getState();
      await threadService.refreshById(threadId);

      const freshThread = threadService.get(threadId);
      if (freshThread?.status === "running" && !isAgentRunning(threadId)) {
        logger.warn(`[ThreadListener] Thread ${threadId} still "running" after process exit (code=${exitCode}), forcing status`);
        const forcedStatus = exitCode === 130 ? "cancelled" : exitCode === 0 ? "completed" : "error";
        await threadService.setStatus(threadId, forcedStatus);
      }

      await store.markThreadAsUnread(threadId);
      logger.info(`[ThreadListener] Marked thread ${threadId} as unread (agent completed)`);

      const isVisible =
        store.activeThreadId === threadId ||
        getVisibleThreadIds().includes(threadId);
      if (isVisible) {
        await threadService.loadThreadState(threadId);
      }

      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  };

  const handleArchived = ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
    try {
      const store = useThreadStore.getState();
      if (store.threads[threadId]) {
        store._applyDelete(threadId);
        logger.info(`[ThreadListener] Removed archived thread ${threadId} from store`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to handle thread archive ${threadId}:`, e);
    }
  };

  const handleNameGenerated = async ({ threadId }: EventPayloads[typeof EventName.THREAD_NAME_GENERATED]) => {
    try {
      await threadService.refreshById(threadId);
      logger.info(`[ThreadListener] Refreshed thread ${threadId} after name generated`);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread after name generated ${threadId}:`, e);
    }
  };

  const handlePanelHidden = () => {
    const store = useThreadStore.getState();
    if (store.activeThreadId) {
      logger.info(`[ThreadListener] Panel hidden, clearing active thread: ${store.activeThreadId}`);
      clearChainState(store.activeThreadId);
      store.setActiveThread(null);
    }
  };

  const handleHeartbeatCompleted = ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    useHeartbeatStore.getState().removeThread(threadId);
    clearChainState(threadId);
  };

  const handleHeartbeatCancelled = ({ threadId }: EventPayloads[typeof EventName.AGENT_CANCELLED]) => {
    useHeartbeatStore.getState().removeThread(threadId);
    clearChainState(threadId);
  };

  // Register all handlers
  eventBus.on(EventName.THREAD_OPTIMISTIC_CREATED, handleOptimisticCreated);
  eventBus.on(EventName.THREAD_CREATED, handleCreated);
  eventBus.on(EventName.THREAD_UPDATED, handleUpdated);
  eventBus.on(EventName.THREAD_STATUS_CHANGED, handleStatusChanged);
  eventBus.on(EventName.THREAD_ACTION, handleAction);
  eventBus.on(EventName.STREAM_DELTA, handleStreamDelta);
  eventBus.on(EventName.AGENT_COMPLETED, handleAgentCompleted);
  eventBus.on(EventName.THREAD_ARCHIVED, handleArchived);
  eventBus.on(EventName.THREAD_NAME_GENERATED, handleNameGenerated);
  eventBus.on("panel-hidden", handlePanelHidden);

  // Heartbeat monitoring & recovery
  startHeartbeatMonitor(async (threadId: string) => {
    const allEnabled = {
      pipeline: true,
      heartbeat: true,
      sequenceGaps: true,
      socketHealth: true,
    };
    try {
      await settingsService.set("diagnosticLogging", allEnabled);
      await invoke("update_diagnostic_config", { config: allEnabled });
      logger.warn("[diagnostics] Auto-enabled all diagnostic modules due to heartbeat staleness");
    } catch (err) {
      logger.error("[diagnostics] Failed to auto-enable diagnostics:", err);
    }

    try {
      await sendToAgent(threadId, {
        type: "diagnostic_config",
        payload: allEnabled,
      });
    } catch (err) {
      logger.debug("[diagnostics] Failed to relay diagnostic config to agent:", err);
    }

    await handleStaleness(threadId);
  });

  eventBus.on(EventName.AGENT_COMPLETED, handleHeartbeatCompleted);
  eventBus.on(EventName.AGENT_CANCELLED, handleHeartbeatCancelled);

  // Recovery polling cleanup (stops polling on agent complete/cancel)
  const cleanupRecovery = setupRecoveryCleanupListeners();

  return () => {
    eventBus.off(EventName.THREAD_OPTIMISTIC_CREATED, handleOptimisticCreated);
    eventBus.off(EventName.THREAD_CREATED, handleCreated);
    eventBus.off(EventName.THREAD_UPDATED, handleUpdated);
    eventBus.off(EventName.THREAD_STATUS_CHANGED, handleStatusChanged);
    eventBus.off(EventName.THREAD_ACTION, handleAction);
    eventBus.off(EventName.STREAM_DELTA, handleStreamDelta);
    eventBus.off(EventName.AGENT_COMPLETED, handleAgentCompleted);
    eventBus.off(EventName.THREAD_ARCHIVED, handleArchived);
    eventBus.off(EventName.THREAD_NAME_GENERATED, handleNameGenerated);
    eventBus.off("panel-hidden", handlePanelHidden);
    eventBus.off(EventName.AGENT_COMPLETED, handleHeartbeatCompleted);
    eventBus.off(EventName.AGENT_CANCELLED, handleHeartbeatCancelled);
    stopHeartbeatMonitor();
    cleanupRecovery();
  };
}
