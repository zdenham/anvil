import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { ThreadMetadata, ThreadStatus } from "./types";
import type { ThreadState as DiskThreadState } from "@/lib/types/agent-messages";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "../../../core/types/events";

// Re-export types for consumers
export type { DiskThreadState as ThreadState, ThreadMetadata };

interface ThreadStoreState {
  // All thread metadata (always in memory, lightweight)
  threads: Record<string, ThreadMetadata>;

  // Cached array of all threads (to prevent Object.values() infinite loops)
  _threadsArray: ThreadMetadata[];

  // Currently active thread
  activeThreadId: string | null;

  // Lazily-loaded states keyed by threadId (from disk state.json)
  threadStates: Record<string, DiskThreadState>;

  // Loading state for the active thread
  activeThreadLoading: boolean;

  // Error state keyed by threadId (for load failures)
  threadErrors: Record<string, string>;

  _hydrated: boolean;
}

interface ThreadStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (threads: Record<string, ThreadMetadata>) => void;

  /** Selectors */
  getThread: (id: string) => ThreadMetadata | undefined;
  getAllThreads: () => ThreadMetadata[];
  getThreadsByStatus: (status: ThreadStatus) => ThreadMetadata[];
  getRunningThreads: () => ThreadMetadata[];
  getThreadsByRepo: (repoId: string) => ThreadMetadata[];
  getThreadsByWorktree: (worktreeId: string) => ThreadMetadata[];
  getChildThreadByParentToolUseId: (parentToolUseId: string) => ThreadMetadata | undefined;

  /** Active thread management */
  setActiveThread: (threadId: string | null) => void;
  setThreadState: (threadId: string, state: DiskThreadState | null) => void;
  setActiveThreadLoading: (loading: boolean) => void;
  setThreadError: (threadId: string, error: string | null) => void;

  /** Derived getter */
  getActiveThreadState: () => DiskThreadState | undefined;

  /** Read state management */
  markThreadAsRead: (threadId: string) => void;
  markThreadAsUnread: (threadId: string) => Promise<void>;
  getUnreadThreads: () => ThreadMetadata[];

  /** Optimistic apply methods - return rollback functions for use with optimistic() */
  _applyCreate: (thread: ThreadMetadata) => Rollback;
  _applyUpdate: (id: string, thread: ThreadMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;

  /** Simple in-memory update (no rollback, no disk write) */
  _applyOptimistic: (thread: ThreadMetadata) => void;
}

export const useThreadStore = create<
  ThreadStoreState & ThreadStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  threads: {},
  _threadsArray: [],
  activeThreadId: null,
  threadStates: {},
  activeThreadLoading: false,
  threadErrors: {},
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (threads) => {
    set({ threads, _threadsArray: Object.values(threads), _hydrated: true });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════════════════════════
  getThread: (id) => get().threads[id],
  getAllThreads: () => get()._threadsArray,
  getThreadsByStatus: (status) =>
    get()._threadsArray.filter((c) => c.status === status),
  getRunningThreads: () =>
    get()._threadsArray.filter((c) => c.status === "running"),
  getThreadsByRepo: (repoId) =>
    get()._threadsArray.filter((c) => c.repoId === repoId),
  getThreadsByWorktree: (worktreeId) =>
    get()._threadsArray.filter((c) => c.worktreeId === worktreeId),
  getChildThreadByParentToolUseId: (parentToolUseId) =>
    get()._threadsArray.find((c) => c.parentToolUseId === parentToolUseId),

  // ═══════════════════════════════════════════════════════════════════════════
  // Active Thread Management
  // ═══════════════════════════════════════════════════════════════════════════
  setActiveThread: (threadId) => {
    set({ activeThreadId: threadId });
  },

  setThreadState: (threadId, state) => {
    logger.info(`[ThreadStore] setThreadState called`, {
      threadId,
      hasState: !!state,
      messageCount: state?.messages?.length ?? 0,
      // DEBUG: Log tool states to diagnose spinner bug
      hasToolStates: !!state?.toolStates,
      toolStatesKeys: state?.toolStates ? Object.keys(state.toolStates) : [],
      toolStatesCount: state?.toolStates ? Object.keys(state.toolStates).length : 0,
    });
    set((prev) => {
      if (state) {
        return { threadStates: { ...prev.threadStates, [threadId]: state } };
      }
      // Remove thread state without lodash omit
      const { [threadId]: _, ...rest } = prev.threadStates;
      return { threadStates: rest };
    });
  },

  setActiveThreadLoading: (loading) => {
    set({ activeThreadLoading: loading });
  },

  setThreadError: (threadId, error) => {
    set((prev) => {
      if (error) {
        return { threadErrors: { ...prev.threadErrors, [threadId]: error } };
      }
      const { [threadId]: _, ...rest } = prev.threadErrors;
      return { threadErrors: rest };
    });
  },

  getActiveThreadState: () => {
    const state = get();
    return state.activeThreadId ? state.threadStates[state.activeThreadId] : undefined;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Read State Management
  // ═══════════════════════════════════════════════════════════════════════════
  markThreadAsRead: (threadId) => {
    const thread = get().threads[threadId];
    if (!thread) return;

    set((state) => {
      const newThreads = {
        ...state.threads,
        [threadId]: { ...thread, isRead: true, markedUnreadAt: undefined },
      };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
      };
    });

    // Emit event to notify other windows
    eventBus.emit(EventName.THREAD_UPDATED, { threadId });

    // Persist to disk - import threadService here to avoid circular dependency
    setTimeout(async () => {
      try {
        const { threadService } = await import("./service");
        await threadService.update(threadId, { isRead: true });
      } catch (error) {
        logger.warn(`Failed to persist isRead flag for thread ${threadId}:`, error);
      }
    }, 0);
  },

  markThreadAsUnread: async (threadId) => {
    const thread = get().threads[threadId];
    if (!thread) return;

    const markedUnreadAt = Date.now();
    set((state) => {
      const newThreads = {
        ...state.threads,
        [threadId]: { ...thread, isRead: false, markedUnreadAt },
      };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
      };
    });

    // Persist to disk FIRST - import threadService here to avoid circular dependency
    try {
      const { threadService } = await import("./service");
      await threadService.update(threadId, { isRead: false });
    } catch (error) {
      logger.warn(`Failed to persist isRead flag for thread ${threadId}:`, error);
    }

    // Only emit event AFTER disk write completes to avoid race condition
    eventBus.emit(EventName.THREAD_UPDATED, { threadId });
  },

  getUnreadThreads: () =>
    get()._threadsArray.filter((thread) => !thread.isRead),

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyCreate: (thread: ThreadMetadata): Rollback => {
    set((state) => {
      const newThreads = { ...state.threads, [thread.id]: thread };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
      };
    });
    return () =>
      set((state) => {
        const { [thread.id]: _, ...rest } = state.threads;
        return {
          threads: rest,
          _threadsArray: Object.values(rest),
        };
      });
  },

  _applyUpdate: (id: string, thread: ThreadMetadata): Rollback => {
    const prev = get().threads[id];
    set((state) => {
      const newThreads = { ...state.threads, [id]: thread };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
      };
    });
    return () =>
      set((state) => {
        const restoredThreads = prev
          ? { ...state.threads, [id]: prev }
          : state.threads;
        return {
          threads: restoredThreads,
          _threadsArray: Object.values(restoredThreads),
        };
      });
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().threads[id];
    set((state) => {
      const { [id]: _, ...rest } = state.threads;
      return {
        threads: rest,
        _threadsArray: Object.values(rest),
      };
    });
    return () =>
      set((state) => {
        const restoredThreads = prev
          ? { ...state.threads, [id]: prev }
          : state.threads;
        return {
          threads: restoredThreads,
          _threadsArray: Object.values(restoredThreads),
        };
      });
  },

  _applyOptimistic: (thread: ThreadMetadata) => {
    set((state) => {
      const newThreads = { ...state.threads, [thread.id]: thread };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
      };
    });
  },
}));
