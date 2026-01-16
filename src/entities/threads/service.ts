import { optimistic } from "@/lib/optimistic";
import { persistence } from "@/lib/persistence";
import { useThreadStore } from "./store";
import { useTaskStore } from "../tasks/store";
import { logger } from "@/lib/logger-client";
import {
  ThreadMetadataSchema,
  getThreadFolderName,
  type ThreadMetadata,
  type ThreadTurn,
  type CreateThreadInput,
  type UpdateThreadInput,
  type ThreadStatus,
} from "./types";
import { ThreadStateSchema } from "@/lib/types/agent-messages";

const TASKS_DIR = "tasks";

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Index: UUID → TaskId
// Rebuilt on hydration, updated on create, refreshed on cache miss
// ═══════════════════════════════════════════════════════════════════════════

let threadTaskIndex: Map<string, string> = new Map();

function getTaskIdForThread(threadId: string): string | undefined {
  return threadTaskIndex.get(threadId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets the task's slug (folder name) from the store.
 * Falls back to taskId if task not found (since slug now equals id for drafts).
 */
function getTaskSlug(taskId: string): string {
  const task = useTaskStore.getState().tasks[taskId];
  return task?.slug ?? taskId;
}

/**
 * Computes the path to a thread's folder.
 * Uses the task's slug (folder name) not taskId directly.
 */
function getThreadPath(taskId: string, agentType: string, threadId: string): string {
  const folderName = getThreadFolderName(agentType, threadId);
  const taskSlug = getTaskSlug(taskId);
  return `${TASKS_DIR}/${taskSlug}/threads/${folderName}`;
}

// Find thread path by UUID using glob-based discovery
// Used when we only have threadId and need the full path
async function findThreadPath(threadId: string): Promise<string | undefined> {
  const pattern = `${TASKS_DIR}/*/threads/*-${threadId}/metadata.json`;
  const matches = await persistence.glob(pattern);
  if (matches.length === 0) return undefined;
  // Return the directory (strip /metadata.json)
  return matches[0].replace(/\/metadata\.json$/, "");
}

// Refresh the thread index for a specific threadId.
// Returns the taskId if found, undefined otherwise.
async function refreshThreadIndex(threadId: string): Promise<string | undefined> {
  const path = await findThreadPath(threadId);
  if (!path) return undefined;
  // Extract taskId from path: tasks/{taskId}/threads/...
  const match = path.match(/^tasks\/([^/]+)\/threads\//);
  if (match) {
    threadTaskIndex.set(threadId, match[1]);
    return match[1];
  }
  return undefined;
}

export const threadService = {
  // Hydrates the thread store from disk.
  // Should be called once at app initialization.
  // Scans all task directories for threads
  async hydrate(): Promise<void> {
    const pattern = `${TASKS_DIR}/*/threads/*/metadata.json`;
    const metadataFiles = await persistence.glob(pattern);
    const threads: Record<string, ThreadMetadata> = {};
    threadTaskIndex.clear();

    await Promise.all(
      metadataFiles.map(async (filePath) => {
        const raw = await persistence.readJson(filePath);
        const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        if (result?.success) {
          const metadata = result.data;
          threads[metadata.id] = metadata;
          threadTaskIndex.set(metadata.id, metadata.taskId);
        }
      })
    );

    useThreadStore.getState().hydrate(threads);
  },

  /**
   * Gets a thread by ID from the store.
   */
  get(id: string): ThreadMetadata | undefined {
    return useThreadStore.getState().threads[id];
  },

  /**
   * Gets all threads from the store.
   */
  getAll(): ThreadMetadata[] {
    return useThreadStore.getState().getAllThreads();
  },

  /**
   * Gets threads for a specific task.
   */
  getByTask(taskId: string): ThreadMetadata[] {
    return useThreadStore.getState().getThreadsByTask(taskId);
  },

  /**
   * Refreshes a single thread from disk by ID.
   * Uses glob-based discovery to find the thread path.
   */
  async refreshById(threadId: string): Promise<void> {
    const path = await findThreadPath(threadId);
    if (!path) {
      // Thread not found on disk - remove from store if present
      const existing = useThreadStore.getState().threads[threadId];
      if (existing) {
        useThreadStore.getState()._applyDelete(threadId);
        threadTaskIndex.delete(threadId);
      }
      return;
    }

    const raw = await persistence.readJson(`${path}/metadata.json`);
    const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      const metadata = result.data;
      useThreadStore.getState()._applyUpdate(threadId, metadata);
      threadTaskIndex.set(threadId, metadata.taskId);
    }
  },

  /**
   * Refreshes all threads for a specific task from disk.
   * Uses glob-based discovery to find all threads belonging to the task.
   */
  async refreshByTask(taskId: string): Promise<void> {
    const taskSlug = getTaskSlug(taskId);
    const pattern = `${TASKS_DIR}/${taskSlug}/threads/*/metadata.json`;
    const metadataFiles = await persistence.glob(pattern);

    await Promise.all(
      metadataFiles.map(async (filePath) => {
        const raw = await persistence.readJson(filePath);
        const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        if (result?.success) {
          const metadata = result.data;
          useThreadStore.getState()._applyUpdate(metadata.id, metadata);
          threadTaskIndex.set(metadata.id, metadata.taskId);
        }
      })
    );
  },

  /**
   * Creates a new thread.
   * Thread is created directly inside its parent task's threads folder.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * If input.id is provided, uses that ID instead of generating a new one.
   * Creates the thread folder with metadata.json inside.
   *
   * @throws Error if taskId is not provided
   */
  async create(input: CreateThreadInput): Promise<ThreadMetadata> {
    if (!input.taskId) {
      throw new Error("taskId is required - every thread must belong to a task");
    }

    logger.info(`[threadService.create] Called with input:`, {
      inputId: input.id,
      taskId: input.taskId,
      agentType: input.agentType,
      workingDirectory: input.workingDirectory,
      promptLength: input.prompt?.length,
      promptPreview: input.prompt?.substring(0, 100),
    });

    const now = Date.now();
    const metadata: ThreadMetadata = {
      id: input.id ?? crypto.randomUUID(),
      taskId: input.taskId,
      agentType: input.agentType,
      workingDirectory: input.workingDirectory,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      git: input.git,
      isRead: true, // New threads start as read
      turns: [
        {
          index: 0,
          prompt: input.prompt,
          startedAt: now,
          completedAt: null,
        },
      ],
    };

    logger.info(`[threadService.create] Created metadata object:`, {
      threadId: metadata.id,
      taskId: metadata.taskId,
      agentType: metadata.agentType,
      status: metadata.status,
    });

    const threadPath = getThreadPath(input.taskId, metadata.agentType, metadata.id);

    logger.info(`[threadService.create] Calling optimistic update for thread ${metadata.id}`);
    await optimistic(
      metadata,
      (thread) => useThreadStore.getState()._applyCreate(thread),
      async (thread) => {
        // Create folder and write metadata.json
        logger.info(`[threadService.create] Persisting thread ${thread.id} to disk at ${threadPath}`);
        await persistence.ensureDir(threadPath);
        await persistence.writeJson(`${threadPath}/metadata.json`, thread);
        logger.info(`[threadService.create] Thread ${thread.id} persisted to disk`);
      }
    );

    // Update in-memory index
    threadTaskIndex.set(metadata.id, input.taskId);

    logger.info(`[threadService.create] Returning created thread:`, {
      threadId: metadata.id,
      taskId: metadata.taskId,
      agentType: metadata.agentType,
    });
    return metadata;
  },

  /**
   * Updates a thread.
   * Uses read-modify-write pattern to preserve fields written by the runner.
   * UI updates optimistically, rolls back on failure.
   */
  async update(
    id: string,
    updates: UpdateThreadInput
  ): Promise<ThreadMetadata> {
    const existing = useThreadStore.getState().threads[id];
    if (!existing) throw new Error(`Thread not found: ${id}`);

    const updated: ThreadMetadata = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Get thread path using the index or grep-based discovery
    let taskId = getTaskIdForThread(id);
    if (!taskId) {
      taskId = await refreshThreadIndex(id);
    }
    if (!taskId) {
      throw new Error(`Thread ${id} not found in index or on disk`);
    }

    const threadPath = getThreadPath(taskId, existing.agentType, id);

    await optimistic(
      updated,
      (thread) => useThreadStore.getState()._applyUpdate(id, thread),
      async (thread) => {
        // Read-modify-write: read current disk state, merge updates, write back
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await persistence.readJson(metadataPath);
        const diskResult = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        const diskState = diskResult?.success ? diskResult.data : null;
        const merged = diskState
          ? { ...diskState, ...thread, updatedAt: Date.now() }
          : thread;
        await persistence.writeJson(metadataPath, merged);
      }
    );

    return updated;
  },

  /**
   * Adds a new turn to a thread.
   * Uses read-modify-write pattern to preserve runner-written fields.
   */
  async addTurn(id: string, prompt: string): Promise<void> {
    const thread = useThreadStore.getState().threads[id];
    if (!thread) throw new Error(`Thread not found: ${id}`);

    const newTurn: ThreadTurn = {
      index: thread.turns.length,
      prompt,
      startedAt: Date.now(),
      completedAt: null,
    };

    const updated: ThreadMetadata = {
      ...thread,
      turns: [...thread.turns, newTurn],
      updatedAt: Date.now(),
    };

    // Get thread path
    let taskId = getTaskIdForThread(id);
    if (!taskId) {
      taskId = await refreshThreadIndex(id);
    }
    if (!taskId) {
      throw new Error(`Thread ${id} not found in index or on disk`);
    }

    const threadPath = getThreadPath(taskId, thread.agentType, id);

    await optimistic(
      updated,
      (t) => useThreadStore.getState()._applyUpdate(id, t),
      async (t) => {
        // Read-modify-write: preserve runner-written fields
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await persistence.readJson(metadataPath);
        const diskResult = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        const diskState = diskResult?.success ? diskResult.data : null;
        const merged = diskState
          ? { ...diskState, turns: t.turns, updatedAt: Date.now() }
          : t;
        await persistence.writeJson(metadataPath, merged);
      }
    );
  },

  /**
   * Completes the current turn in a thread.
   * Uses read-modify-write pattern to only update frontend-owned fields (exitCode, costUsd).
   */
  async completeTurn(
    id: string,
    exitCode: number,
    costUsd?: number
  ): Promise<void> {
    const thread = useThreadStore.getState().threads[id];
    if (!thread) throw new Error(`Thread not found: ${id}`);

    const turns = [...thread.turns];
    const lastTurn = turns[turns.length - 1];
    turns[turns.length - 1] = {
      ...lastTurn,
      completedAt: Date.now(),
      exitCode,
      costUsd,
    };

    const updated: ThreadMetadata = {
      ...thread,
      turns,
      updatedAt: Date.now(),
    };

    // Get thread path
    let taskId = getTaskIdForThread(id);
    if (!taskId) {
      taskId = await refreshThreadIndex(id);
    }
    if (!taskId) {
      throw new Error(`Thread ${id} not found in index or on disk`);
    }

    const threadPath = getThreadPath(taskId, thread.agentType, id);

    await optimistic(
      updated,
      (t) => useThreadStore.getState()._applyUpdate(id, t),
      async () => {
        // Read-modify-write: only update frontend-owned fields (exitCode, costUsd)
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await persistence.readJson(metadataPath);
        const diskResult = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        if (!diskResult?.success) throw new Error(`Thread ${id} not found on disk or invalid`);
        const diskState = diskResult.data;

        const turnIndex = diskState.turns.length - 1;
        diskState.turns[turnIndex] = {
          ...diskState.turns[turnIndex],
          completedAt: Date.now(),
          exitCode,
          costUsd,
        };
        diskState.updatedAt = Date.now();
        await persistence.writeJson(metadataPath, diskState);
      }
    );
  },

  /**
   * Sets the status of a thread.
   */
  async setStatus(id: string, status: ThreadStatus): Promise<void> {
    await this.update(id, { status });
  },

  /**
   * Marks a thread as running.
   */
  async markRunning(id: string): Promise<void> {
    logger.info(`[threadService.markRunning] Marking thread ${id} as running`);
    await this.setStatus(id, "running");
    logger.info(`[threadService.markRunning] Thread ${id} marked as running`);
  },

  /**
   * Marks a thread as completed.
   */
  async markCompleted(id: string): Promise<void> {
    await this.setStatus(id, "completed");
  },

  /**
   * Marks a thread as errored.
   */
  async markError(id: string): Promise<void> {
    await this.setStatus(id, "error");
  },

  /**
   * Marks a thread as cancelled.
   */
  async markCancelled(id: string): Promise<void> {
    await this.setStatus(id, "cancelled");
  },

  /**
   * Deletes a thread.
   * Removes the entire thread folder (metadata.json + state.json).
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   */
  async delete(id: string): Promise<void> {
    const thread = useThreadStore.getState().threads[id];
    if (!thread) return;

    // Get thread path
    let taskId = getTaskIdForThread(id);
    if (!taskId) {
      taskId = await refreshThreadIndex(id);
    }
    if (!taskId) {
      // Thread doesn't exist on disk, just remove from store
      useThreadStore.getState()._applyDelete(id);
      threadTaskIndex.delete(id);
      return;
    }

    const threadPath = getThreadPath(taskId, thread.agentType, id);

    // Optimistically remove from store, then delete folder
    const rollback = useThreadStore.getState()._applyDelete(id);
    try {
      await persistence.removeDir(threadPath);
      threadTaskIndex.delete(id);
    } catch (error) {
      rollback();
      throw error;
    }
  },

  // Gets the path to the state.json file for a thread.
  // Used by hooks that need to read thread state from disk.
  async getStatePath(threadId: string): Promise<string | undefined> {
    const thread = this.get(threadId);
    if (!thread) return undefined;

    let taskId = getTaskIdForThread(threadId);
    if (!taskId) {
      taskId = await refreshThreadIndex(threadId);
    }
    if (!taskId) return undefined;

    const threadPath = getThreadPath(taskId, thread.agentType, threadId);
    return `${threadPath}/state.json`;
  },

  // Gets the full path to a thread's directory.
  // Used by the runner and agent service for file operations.
  async getThreadPath(threadId: string): Promise<string | undefined> {
    const thread = this.get(threadId);
    if (!thread) return undefined;

    let taskId = getTaskIdForThread(threadId);
    if (!taskId) {
      taskId = await refreshThreadIndex(threadId);
    }
    if (!taskId) return undefined;

    return getThreadPath(taskId, thread.agentType, threadId);
  },

  /**
   * Creates an optimistic thread in the store without writing to disk.
   * Used for immediate UI feedback before the real thread is created.
   * The thread will be overwritten when disk refresh occurs.
   */
  createOptimistic(params: { id: string; taskId: string; status: ThreadStatus }): void {
    const now = Date.now();
    const optimisticThread: ThreadMetadata = {
      id: params.id,
      taskId: params.taskId,
      status: params.status,
      agentType: "", // Will be set on disk refresh
      workingDirectory: "", // Will be set on disk refresh
      createdAt: now,
      updatedAt: now,
      isRead: false, // Optimistic threads are unread until user views them
      turns: [],
    };

    useThreadStore.getState()._applyCreate(optimisticThread);
  },

  /**
   * Handles a thread created by Node orchestration.
   * Adds the thread to the store without writing to disk (Node already did that).
   * Used when receiving thread:created events from the agent service.
   */
  handleRemoteCreate(metadata: ThreadMetadata): void {
    logger.info(`[threadService.handleRemoteCreate] Adding thread from Node:`, {
      threadId: metadata.id,
      taskId: metadata.taskId,
      agentType: metadata.agentType,
    });

    // Add to store (no disk write - Node already created it)
    useThreadStore.getState()._applyCreate(metadata);

    // Update in-memory index
    threadTaskIndex.set(metadata.id, metadata.taskId);
  },

  /**
   * Loads thread state from disk into the consolidated store.
   * Called when active thread changes or when AGENT_STATE events are received.
   * State is stored keyed by threadId, so late-arriving updates don't affect active view.
   */
  async loadThreadState(threadId: string): Promise<void> {
    logger.info(`[threadService.loadThreadState] Starting load for ${threadId}`);
    const store = useThreadStore.getState();
    const hasCachedState = !!store.threadStates[threadId];
    logger.info(`[threadService.loadThreadState] Has cached state: ${hasCachedState}`);

    // Only show loading if we don't have cached state (stale-while-revalidate)
    if (!hasCachedState) {
      store.setActiveThreadLoading(true);
    }
    store.setThreadError(threadId, null); // Clear any previous error

    try {
      let thread = this.get(threadId);
      logger.info(`[threadService.loadThreadState] Thread metadata lookup result:`, {
        found: !!thread,
        threadId,
        storeThreadCount: Object.keys(store.threads).length,
      });

      // If thread metadata is not in store, try to refresh from disk
      // This handles the case where another window created the thread after this window hydrated
      if (!thread) {
        logger.info(`[threadService.loadThreadState] Thread ${threadId} not in store, refreshing from disk...`);
        await this.refreshById(threadId);
        thread = this.get(threadId);
        logger.info(`[threadService.loadThreadState] After refresh: found=${!!thread}`);
      }

      if (!thread) {
        logger.warn(`[threadService.loadThreadState] Thread ${threadId} not found even after disk refresh`);
        return;
      }

      // Get state.json path
      const statePath = await this.getStatePath(threadId);
      logger.info(`[threadService.loadThreadState] State path resolved:`, { statePath, threadId });
      if (!statePath) {
        logger.warn(`[threadService.loadThreadState] Could not resolve state path for ${threadId}`);
        return;
      }

      // Read state.json from disk
      const raw = await persistence.readJson(statePath);
      logger.info(`[threadService.loadThreadState] Read state.json result:`, {
        hasData: !!raw,
        threadId,
        statePath,
      });
      if (!raw) {
        // New thread - no state yet, that's OK
        logger.info(`[threadService.loadThreadState] No state.json for ${threadId} yet (new thread)`);
        return;
      }

      const result = ThreadStateSchema.safeParse(raw);
      if (!result.success) {
        logger.warn(`[threadService.loadThreadState] Invalid state.json for ${threadId}:`, result.error.message);
        return;
      }

      // Store state keyed by threadId - naturally handles race conditions
      logger.info(`[threadService.loadThreadState] Setting thread state for ${threadId}`, {
        messageCount: result.data.messages.length,
        fileChangeCount: result.data.fileChanges?.length ?? 0,
        status: result.data.status,
      });
      store.setThreadState(threadId, result.data);

      logger.info(`[threadService.loadThreadState] Successfully loaded state for ${threadId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`[threadService.loadThreadState] Failed to load thread state for ${threadId}:`, err);
      store.setThreadError(threadId, errorMessage);
    } finally {
      // Only clear loading if we're still the active thread (handles race condition)
      if (useThreadStore.getState().activeThreadId === threadId) {
        store.setActiveThreadLoading(false);
      }
    }
  },

  /**
   * Sets the active thread and loads its state.
   * Called when workspace activates a thread.
   */
  setActiveThread(threadId: string | null): void {
    logger.info(`[threadService.setActiveThread] Setting active thread: ${threadId}`);
    const store = useThreadStore.getState();
    store.setActiveThread(threadId);
    if (threadId) {
      logger.info(`[threadService.setActiveThread] Triggering loadThreadState for ${threadId}`);
      this.loadThreadState(threadId);
    }
  },

  /**
   * @deprecated Use loadThreadState instead. Kept for backwards compatibility during migration.
   */
  async refreshThreadState(threadId: string): Promise<void> {
    return this.loadThreadState(threadId);
  },
};
