import { EventName, EventPayloads } from "@core/types/events.js";
// DiagnosticLoggingConfig used in staleness handler below
import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { useThreadStore } from "./store.js";
import { useStreamingStore } from "@/stores/streaming-store.js";
import { logger } from "@/lib/logger-client.js";
import { useHeartbeatStore, startHeartbeatMonitor } from "@/stores/heartbeat-store.js";
import { handleStaleness, setupRecoveryCleanupListeners } from "@/lib/state-recovery.js";
import { settingsService } from "../settings/service.js";
import { sendToAgent } from "@/lib/agent-service.js";

/**
 * Setup thread event listeners.
 */
export function setupThreadListeners(): void {
  // Optimistic thread creation - creates placeholder in store for immediate UI feedback
  // Will be overwritten by THREAD_CREATED when disk version is available
  eventBus.on(EventName.THREAD_OPTIMISTIC_CREATED, ({ threadId, repoId, worktreeId, prompt, status, permissionMode }: EventPayloads[typeof EventName.THREAD_OPTIMISTIC_CREATED]) => {
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
  });

  // Thread created on disk - refresh from disk (overwrites any optimistic version)
  eventBus.on(EventName.THREAD_CREATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_CREATED]) => {
    try {
      await threadService.refreshById(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh created thread ${threadId}:`, e);
    }
  });

  eventBus.on(EventName.THREAD_UPDATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_UPDATED]) => {
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
  });

  eventBus.on(EventName.THREAD_STATUS_CHANGED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
    try {
      await threadService.refreshById(threadId);

      // Mark thread as unread when it transitions to running status
      const thread = threadService.get(threadId);
      if (thread?.status === "running") {
        await useThreadStore.getState().markThreadAsUnread(threadId);
        logger.info(`[ThreadListener] Marked thread ${threadId} as unread (status: running)`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread status ${threadId}:`, e);
    }
  });

  // Agent state updates - refresh metadata (for usage) + state if active thread
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }: EventPayloads[typeof EventName.AGENT_STATE]) => {
    logger.info(`[FC-DEBUG] AGENT_STATE event received`, {
      threadId,
      activeThreadId: useThreadStore.getState().activeThreadId,
      isActiveThread: useThreadStore.getState().activeThreadId === threadId,
    });
    try {
      // Always refresh metadata (usage data lives there now)
      await threadService.refreshById(threadId);

      const store = useThreadStore.getState();
      if (store.activeThreadId === threadId) {
        logger.info(`[FC-DEBUG] Thread is active, calling loadThreadState`);
        await threadService.loadThreadState(threadId);
      } else {
        logger.info(`[FC-DEBUG] Thread is NOT active, skipping loadThreadState`);
      }

      // Clear streaming content AFTER replacement data is in the store
      useStreamingStore.getState().clearStream(threadId);

      // Cascade: refresh parent so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread state ${threadId}:`, e);
    }
  });

  // Agent completed - always refresh metadata, only refresh state if active
  eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    try {
      const store = useThreadStore.getState();
      // Always refresh metadata (lightweight)
      await threadService.refreshById(threadId);

      // Mark thread as unread when it completes (user needs to see the results)
      await store.markThreadAsUnread(threadId);
      logger.info(`[ThreadListener] Marked thread ${threadId} as unread (agent completed)`);

      // Only refresh state if this is the active thread
      if (store.activeThreadId === threadId) {
        await threadService.loadThreadState(threadId);
      }

      // Clear streaming content AFTER replacement data is in the store
      useStreamingStore.getState().clearStream(threadId);

      // Cascade: refresh parent so aggregate cost displays update
      const thread = threadService.get(threadId);
      if (thread?.parentThreadId) {
        await threadService.refreshById(thread.parentThreadId);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  });

  // Thread archived - remove from store
  eventBus.on(EventName.THREAD_ARCHIVED, ({ threadId }: EventPayloads[typeof EventName.THREAD_ARCHIVED]) => {
    try {
      const store = useThreadStore.getState();
      // Remove from store (disk already updated by archive operation)
      if (store.threads[threadId]) {
        store._applyDelete(threadId);
        logger.info(`[ThreadListener] Removed archived thread ${threadId} from store`);
      }
    } catch (e) {
      logger.error(`[ThreadListener] Failed to handle thread archive ${threadId}:`, e);
    }
  });

  // Thread name generated - refresh thread metadata to show new name
  eventBus.on(EventName.THREAD_NAME_GENERATED, async ({ threadId }: EventPayloads[typeof EventName.THREAD_NAME_GENERATED]) => {
    try {
      await threadService.refreshById(threadId);
      logger.info(`[ThreadListener] Refreshed thread ${threadId} after name generated`);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread after name generated ${threadId}:`, e);
    }
  });

  // Panel hidden - clear active thread to prevent marking threads as read when panel is not visible
  // This allows useMarkThreadAsRead to simply check if the thread is active rather than polling panel visibility
  eventBus.on("panel-hidden", () => {
    const store = useThreadStore.getState();
    if (store.activeThreadId) {
      logger.info(`[ThreadListener] Panel hidden, clearing active thread: ${store.activeThreadId}`);
      store.setActiveThread(null);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Heartbeat Monitoring & Recovery
  // ═══════════════════════════════════════════════════════════════════════════

  // Start heartbeat monitor with staleness handler
  startHeartbeatMonitor(async (threadId: string) => {
    // 1. Auto-enable all diagnostic modules
    const allEnabled = {
      pipeline: true,
      heartbeat: true,
      sequenceGaps: true,
      socketHealth: true,
    };
    try {
      await settingsService.set("diagnosticLogging", allEnabled);
      // Update Rust hub diagnostic state so pipeline logging activates there too
      await invoke("update_diagnostic_config", { config: allEnabled });
      logger.warn("[diagnostics] Auto-enabled all diagnostic modules due to heartbeat staleness");
    } catch (err) {
      logger.error("[diagnostics] Failed to auto-enable diagnostics:", err);
    }

    // 2. Relay diagnostic config to in-flight agents via hub
    // NOTE: type must be "diagnostic_config" (underscore) to match agent-side TauriToAgentMessage
    try {
      await sendToAgent(threadId, {
        type: "diagnostic_config",
        payload: allEnabled,
      });
    } catch (err) {
      // Agent may not be reachable — that's expected when pipeline is broken
      logger.debug("[diagnostics] Failed to relay diagnostic config to agent:", err);
    }

    // 3. Trigger disk recovery + polling fallback
    await handleStaleness(threadId);
  });

  // Clean up heartbeat tracking when agent finishes
  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }: EventPayloads[typeof EventName.AGENT_COMPLETED]) => {
    useHeartbeatStore.getState().removeThread(threadId);
  });

  eventBus.on(EventName.AGENT_CANCELLED, ({ threadId }: EventPayloads[typeof EventName.AGENT_CANCELLED]) => {
    useHeartbeatStore.getState().removeThread(threadId);
  });

  // Set up recovery polling cleanup (stops polling on agent complete/cancel)
  setupRecoveryCleanupListeners();
}
