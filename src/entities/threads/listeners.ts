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
import { isAgentRunning, sendToAgent, resumeSimpleAgent } from "@/lib/agent-service.js";
import { treeMenuService } from "@/stores/tree-menu/service.js";
import { useQueuedMessagesStore } from "@/stores/queued-messages-store.js";
import { useRepoStore } from "../repositories/store.js";
import { loadSettings } from "@/lib/app-data-store.js";
import { deriveWorkingDirectory } from "./utils.js";
import type { ThreadMetadata } from "./types.js";

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
 * Reconcile pending queued messages after an agent exits.
 *
 * All pending messages are treated as undelivered — the 2-turn deferred ack
 * is the only reliable confirmation, and it didn't arrive before exit.
 * Messages may have been written to state.json by the agent's message stream
 * (for crash-recovery durability), so we scrub them before resending.
 */
async function reconcilePendingMessages(threadId: string): Promise<void> {
  const pendingMessages = useQueuedMessagesStore.getState().drainThread(threadId);
  if (pendingMessages.length === 0) return;

  logger.info(`[ThreadListener] Reconciling ${pendingMessages.length} unconfirmed message(s) for ${threadId}`);

  const thread = threadService.get(threadId) as ThreadMetadata | undefined;
  if (!thread) {
    logger.warn(`[ThreadListener] Cannot resend for ${threadId}: thread not found`);
    return;
  }

  const workingDirectory = await resolveWorkingDirectoryForThread(thread);
  if (!workingDirectory) {
    logger.warn(`[ThreadListener] Cannot resend for ${threadId}: no working directory`);
    return;
  }

  // Scrub unconfirmed messages from state.json before resending.
  // The agent writes queued messages to disk (message-stream.ts:72) for durability,
  // but reconciliation treats them as undelivered. Leaving the old copy would cause
  // the resent message to appear twice (old ID + new turn).
  const scrubIds = new Set(pendingMessages.map((m) => m.id));
  await threadService.scrubMessagesFromState(threadId, scrubIds);

  // Send first message as new turn, passing the original messageId so the
  // thread reducer's ID-based dedup can catch any remaining duplicates.
  const first = pendingMessages[0];
  try {
    logger.info(`[ThreadListener] Auto-resending message as new turn for ${threadId}`);
    await resumeSimpleAgent(threadId, first.content, workingDirectory, first.id);
  } catch (err) {
    logger.error(`[ThreadListener] Failed to resend queued message for ${threadId}:`, err);
  }
}

/** Resolve working directory for a thread from repo settings (non-hook). */
async function resolveWorkingDirectoryForThread(thread: ThreadMetadata): Promise<string | null> {
  const repoNames = useRepoStore.getState().getRepositoryNames();
  for (const name of repoNames) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    try {
      const settings = await loadSettings(slug);
      if (settings.id === thread.repoId) {
        return deriveWorkingDirectory(thread, settings);
      }
    } catch {
      continue;
    }
  }
  return null;
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
      if (source === "anvil-repl:child-spawn") {
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

  const handleStatusChanged = async ({ threadId, status }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
    try {
      // Write status to metadata.json so it persists (especially for TUI threads
      // where the sidecar only updates state.json, not metadata.json).
      await threadService.setStatus(threadId, status);

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

      // Reconcile any pending queued messages that may have been lost
      await reconcilePendingMessages(threadId);

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
