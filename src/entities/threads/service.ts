import { optimistic } from "@/lib/optimistic";
import { appData } from "@/lib/app-data-store";
import { useThreadStore } from "./store";
import { logger } from "@/lib/logger-client";
import {
  ThreadMetadataSchema,
  type ThreadMetadata,
  type ThreadTurn,
  type CreateThreadInput,
  type UpdateThreadInput,
  type ThreadStatus,
} from "./types";
import { ThreadStateSchema } from "@/lib/types/agent-messages";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import type { PermissionModeId } from "@core/types/permissions.js";
import type { PlanMetadata } from "../plans/types";

// ═══════════════════════════════════════════════════════════════════════════
// Directory Constants
// ═══════════════════════════════════════════════════════════════════════════

const THREADS_DIR = "threads";           // New top-level structure
const LEGACY_TASKS_DIR = "tasks";        // Legacy task-nested structure
const ARCHIVE_THREADS_DIR = "archive/threads";

// ═══════════════════════════════════════════════════════════════════════════
// Path Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets the path for a thread in the new top-level structure.
 * Thread folders are stored at ~/.mort/threads/{threadId}/
 */
function getStandaloneThreadPath(threadId: string): string {
  return `${THREADS_DIR}/${threadId}`;
}

/** Cache of threadId → resolved directory path. Stable except on archive/delete. */
const threadPathCache = new Map<string, string>();

/**
 * Finds the path to a thread by its UUID.
 * Checks new top-level location first, falls back to legacy task-nested location.
 * Returns the directory path (not including /metadata.json).
 * Results are cached — invalidate via invalidateThreadPathCache() on archive/delete.
 */
async function findThreadPath(threadId: string): Promise<string | undefined> {
  const cached = threadPathCache.get(threadId);
  if (cached !== undefined) return cached;

  // Check new location first
  const newPath = `${THREADS_DIR}/${threadId}/metadata.json`;
  if (await appData.exists(newPath)) {
    const result = `${THREADS_DIR}/${threadId}`;
    threadPathCache.set(threadId, result);
    return result;
  }

  // Fall back to legacy task-nested location
  const legacyPattern = `${LEGACY_TASKS_DIR}/*/threads/*-${threadId}/metadata.json`;
  const matches = await appData.glob(legacyPattern);
  if (matches.length > 0) {
    const result = matches[0].replace(/\/metadata\.json$/, "");
    threadPathCache.set(threadId, result);
    return result;
  }

  return undefined;
}

function invalidateThreadPathCache(threadId: string): void {
  threadPathCache.delete(threadId);
}

export const threadService = {
  /**
   * Hydrates the thread store from disk.
   * Should be called once at app initialization.
   * Loads threads from both new top-level structure and legacy task-nested structure.
   */
  async hydrate(): Promise<void> {
    const threads: Record<string, ThreadMetadata> = {};

    // Load from new top-level structure: ~/.mort/threads/*/metadata.json
    const newPattern = `${THREADS_DIR}/*/metadata.json`;
    const newFiles = await appData.glob(newPattern);

    // Load from legacy task-nested structure: ~/.mort/tasks/*/threads/*/metadata.json
    const legacyPattern = `${LEGACY_TASKS_DIR}/*/threads/*/metadata.json`;
    const legacyFiles = await appData.glob(legacyPattern);

    const allFiles = [...newFiles, ...legacyFiles];

    await Promise.all(
      allFiles.map(async (filePath) => {
        const raw = await appData.readJson(filePath);
        const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        if (result?.success) {
          const metadata = result.data;
          threads[metadata.id] = metadata;
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
   * Gets all threads for a specific repository.
   */
  getByRepo(repoId: string): ThreadMetadata[] {
    return useThreadStore.getState().getThreadsByRepo(repoId);
  },

  /**
   * Gets all threads for a specific worktree.
   */
  getByWorktree(worktreeId: string): ThreadMetadata[] {
    return useThreadStore.getState().getThreadsByWorktree(worktreeId);
  },

  /**
   * Refreshes a single thread from disk by ID.
   * Uses findThreadPath to locate the thread in either new or legacy locations.
   */
  async refreshById(threadId: string): Promise<void> {
    const path = await findThreadPath(threadId);
    if (!path) {
      // Thread not found on disk - remove from store if present
      const existing = useThreadStore.getState().threads[threadId];
      if (existing) {
        useThreadStore.getState()._applyDelete(threadId);
      }
      return;
    }

    const raw = await appData.readJson(`${path}/metadata.json`);
    const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      const diskMetadata = result.data;
      const existingThread = useThreadStore.getState().threads[threadId];

      // If existing thread was optimistic, preserve the prompt if disk doesn't have it
      // This prevents flash-to-empty-state when disk refresh races with optimistic creation
      if (existingThread?._isOptimistic) {
        const optimisticPrompt = existingThread.turns[0]?.prompt;
        const diskHasPrompt = diskMetadata.turns[0]?.prompt;

        if (optimisticPrompt && !diskHasPrompt) {
          // Merge: use disk metadata but preserve optimistic prompt
          diskMetadata.turns = existingThread.turns;
        }

        // Clear the optimistic flag since we now have disk confirmation
        delete diskMetadata._isOptimistic;
      }

      useThreadStore.getState()._applyUpdate(threadId, diskMetadata);
    }
  },

  /**
   * Creates a new thread.
   * Threads are stored at top-level: ~/.mort/threads/{threadId}/
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * If input.id is provided, uses that ID instead of generating a new one.
   *
   * @throws Error if repoId or worktreeId is not provided
   */
  async create(input: CreateThreadInput): Promise<ThreadMetadata> {
    if (!input.repoId) {
      throw new Error("repoId is required - every thread must belong to a repository");
    }
    if (!input.worktreeId) {
      throw new Error("worktreeId is required - every thread must have a worktree");
    }

    logger.info(`[threadService.create] Called with input:`, {
      inputId: input.id,
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      promptLength: input.prompt?.length,
      promptPreview: input.prompt?.substring(0, 100),
    });

    const now = Date.now();
    const metadata: ThreadMetadata = {
      id: input.id ?? crypto.randomUUID(),
      repoId: input.repoId,
      worktreeId: input.worktreeId,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      git: input.git,
      isRead: true, // New threads start as read
      permissionMode: "implement",
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
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
      status: metadata.status,
    });

    // All threads go to new top-level structure
    const threadPath = getStandaloneThreadPath(metadata.id);

    logger.info(`[threadService.create] Calling optimistic update for thread ${metadata.id}`);
    await optimistic(
      metadata,
      (thread) => useThreadStore.getState()._applyCreate(thread),
      async (thread) => {
        // Create folder and write metadata.json
        logger.info(`[threadService.create] Persisting thread ${thread.id} to disk at ${threadPath}`);
        await appData.ensureDir(threadPath);
        await appData.writeJson(`${threadPath}/metadata.json`, thread);
        logger.info(`[threadService.create] Thread ${thread.id} persisted to disk`);
      }
    );

    logger.info(`[threadService.create] Returning created thread:`, {
      threadId: metadata.id,
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
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

    // Find thread path (supports both new and legacy locations)
    const threadPath = await findThreadPath(id);
    if (!threadPath) {
      throw new Error(`Thread ${id} not found on disk`);
    }

    await optimistic(
      updated,
      (thread) => useThreadStore.getState()._applyUpdate(id, thread),
      async (thread) => {
        // Read-modify-write: read current disk state, merge updates, write back
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
        const diskResult = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        const diskState = diskResult?.success ? diskResult.data : null;
        const merged = diskState
          ? { ...diskState, ...thread, updatedAt: Date.now() }
          : thread;
        await appData.writeJson(metadataPath, merged);
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

    // Find thread path (supports both new and legacy locations)
    const threadPath = await findThreadPath(id);
    if (!threadPath) {
      throw new Error(`Thread ${id} not found on disk`);
    }

    await optimistic(
      updated,
      (t) => useThreadStore.getState()._applyUpdate(id, t),
      async (t) => {
        // Read-modify-write: preserve runner-written fields
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
        const diskResult = raw ? ThreadMetadataSchema.safeParse(raw) : null;
        const diskState = diskResult?.success ? diskResult.data : null;
        const merged = diskState
          ? { ...diskState, turns: t.turns, updatedAt: Date.now() }
          : t;
        await appData.writeJson(metadataPath, merged);
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

    // Find thread path (supports both new and legacy locations)
    const threadPath = await findThreadPath(id);
    if (!threadPath) {
      throw new Error(`Thread ${id} not found on disk`);
    }

    await optimistic(
      updated,
      (t) => useThreadStore.getState()._applyUpdate(id, t),
      async () => {
        // Read-modify-write: only update frontend-owned fields (exitCode, costUsd)
        const metadataPath = `${threadPath}/metadata.json`;
        const raw = await appData.readJson(metadataPath);
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
        await appData.writeJson(metadataPath, diskState);
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

    invalidateThreadPathCache(id);

    // Find thread path (supports both new and legacy locations)
    const threadPath = await findThreadPath(id);
    if (!threadPath) {
      // Thread doesn't exist on disk, just remove from store
      useThreadStore.getState()._applyDelete(id);
      return;
    }

    // Optimistically remove from store, then delete folder
    const rollback = useThreadStore.getState()._applyDelete(id);
    try {
      await appData.removeDir(threadPath);
    } catch (error) {
      rollback();
      throw error;
    }
  },

  /**
   * Gets the path to the state.json file for a thread.
   * Used by hooks that need to read thread state from disk.
   */
  async getStatePath(threadId: string): Promise<string | undefined> {
    const threadPath = await findThreadPath(threadId);
    if (!threadPath) return undefined;
    return `${threadPath}/state.json`;
  },

  /**
   * Gets the full path to a thread's directory.
   * Used by the runner and agent service for file operations.
   */
  async getThreadPath(threadId: string): Promise<string | undefined> {
    return findThreadPath(threadId);
  },

  /**
   * Creates an optimistic thread in the store without writing to disk.
   * Used for immediate UI feedback before the real thread is created.
   * The thread will be overwritten when disk refresh occurs.
   *
   * @param params.id - Thread UUID
   * @param params.repoId - Repository UUID
   * @param params.worktreeId - Worktree UUID
   * @param params.status - Initial status
   * @param params.prompt - Optional first message prompt (for immediate display)
   */
  createOptimistic(params: {
    id: string;
    repoId: string;
    worktreeId: string;
    status: ThreadStatus;
    prompt?: string;
    permissionMode?: PermissionModeId;
  }): void {
    const now = Date.now();
    const optimisticThread: ThreadMetadata = {
      id: params.id,
      repoId: params.repoId,
      worktreeId: params.worktreeId,
      status: params.status,
      createdAt: now,
      updatedAt: now,
      isRead: true, // New threads start as read (user just created it)
      _isOptimistic: true, // Mark as optimistic until disk confirmation
      permissionMode: params.permissionMode ?? "implement",
      turns: params.prompt
        ? [{
            index: 0,
            prompt: params.prompt,
            startedAt: now,
            completedAt: null,
          }]
        : [],
    };

    logger.info(`[threadService.createOptimistic] Creating optimistic thread:`, {
      threadId: params.id,
      repoId: params.repoId,
      worktreeId: params.worktreeId,
      hasPrompt: !!params.prompt,
    });

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
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
    });

    // Add to store (no disk write - Node already created it)
    useThreadStore.getState()._applyCreate(metadata);
  },

  /**
   * Loads thread state from disk into the consolidated store.
   * Called when active thread changes or when AGENT_STATE events are received.
   * State is stored keyed by threadId, so late-arriving updates don't affect active view.
   */
  async loadThreadState(threadId: string): Promise<void> {
    logger.info(`[FC-DEBUG] loadThreadState starting`, { threadId });
    logger.info(`[threadService.loadThreadState] Starting load for ${threadId}`);
    const store = useThreadStore.getState();
    const hasCachedState = !!store.threadStates[threadId];
    logger.info(`[FC-DEBUG] loadThreadState cache check`, { threadId, hasCachedState });
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
      const raw = await appData.readJson(statePath);
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
      logger.info(`[FC-DEBUG] loadThreadState parsed state successfully`, {
        threadId,
        fileChangesCount: result.data.fileChanges?.length ?? 0,
        fileChangePaths: result.data.fileChanges?.map((c) => c.path) ?? [],
      });
      logger.info(`[threadService.loadThreadState] Setting thread state for ${threadId}`, {
        messageCount: result.data.messages.length,
        fileChangeCount: result.data.fileChanges?.length ?? 0,
        status: result.data.status,
        // DEBUG: Log tool states being loaded
        hasToolStates: !!result.data.toolStates,
        toolStatesKeys: result.data.toolStates ? Object.keys(result.data.toolStates) : [],
        toolStatesCount: result.data.toolStates ? Object.keys(result.data.toolStates).length : 0,
      });
      store.setThreadState(threadId, result.data);
      logger.info(`[FC-DEBUG] loadThreadState stored state in zustand store`);

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

  /**
   * Gets all descendant thread IDs for a given thread (recursive).
   * Finds all threads where parentThreadId matches the given threadId,
   * then recursively finds their children.
   */
  getDescendantThreadIds(threadId: string): string[] {
    const allThreads = this.getAll();
    const children = allThreads.filter(t => t.parentThreadId === threadId);
    const descendants: string[] = [];

    for (const child of children) {
      descendants.push(child.id);
      descendants.push(...this.getDescendantThreadIds(child.id));
    }

    return descendants;
  },

  /**
   * Get total cumulative usage for a thread and all its descendants.
   * Since usage is now in metadata, this works without loading any state files.
   */
  getAggregateUsage(threadId: string): { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number } | undefined {
    const thread = this.get(threadId);
    if (!thread?.cumulativeUsage) return undefined;

    const descendantIds = this.getDescendantThreadIds(threadId);
    const allUsages = [thread.cumulativeUsage];

    for (const id of descendantIds) {
      const desc = this.get(id);
      if (desc?.cumulativeUsage) allUsages.push(desc.cumulativeUsage);
    }

    return {
      inputTokens: allUsages.reduce((s, u) => s + u.inputTokens, 0),
      outputTokens: allUsages.reduce((s, u) => s + u.outputTokens, 0),
      cacheCreationTokens: allUsages.reduce((s, u) => s + u.cacheCreationTokens, 0),
      cacheReadTokens: allUsages.reduce((s, u) => s + u.cacheReadTokens, 0),
    };
  },

  /**
   * Archives a thread.
   * Moves the thread folder from its current location to archive/threads/.
   * Cascades to all descendant threads (children, grandchildren, etc.).
   * Emits THREAD_ARCHIVED event so relation service can archive associated relations.
   * Uses optimistic update - removes from store immediately, rolls back on failure.
   *
   * @param threadId - The thread ID to archive
   * @param originInstanceId - Optional instance ID of the window that initiated the archive
   */
  async archive(threadId: string, originInstanceId?: string | null): Promise<void> {
    const thread = this.get(threadId);
    if (!thread) return;

    // Get all descendant threads for cascaded archival
    const descendantIds = this.getDescendantThreadIds(threadId);
    const allThreadIds = [threadId, ...descendantIds];

    logger.info(`[threadService.archive] Archiving thread ${threadId} with ${descendantIds.length} descendants`);

    // Collect all rollbacks for potential failure recovery
    const rollbacks: Array<() => void> = [];

    try {
      // Ensure archive directory exists
      await appData.ensureDir(ARCHIVE_THREADS_DIR);

      // Archive each thread (parent + all descendants)
      for (const id of allThreadIds) {
        invalidateThreadPathCache(id);
        const sourcePath = await findThreadPath(id);
        if (!sourcePath) {
          logger.warn(`[threadService.archive] Thread ${id} not found on disk, skipping`);
          continue;
        }

        const archivePath = `${ARCHIVE_THREADS_DIR}/${id}`;

        // Optimistically remove from store
        const rollback = useThreadStore.getState()._applyDelete(id);
        rollbacks.push(rollback);

        // Copy metadata and state to archive
        const metadata = await appData.readJson(`${sourcePath}/metadata.json`);
        const state = await appData.readJson(`${sourcePath}/state.json`);

        await appData.ensureDir(archivePath);
        if (metadata) await appData.writeJson(`${archivePath}/metadata.json`, metadata);
        if (state) await appData.writeJson(`${archivePath}/state.json`, state);

        // Remove original directory
        await appData.removeDir(sourcePath);

        // Emit event so relation service can archive associated relations
        // Include originInstanceId so standalone windows can close themselves
        eventBus.emit(EventName.THREAD_ARCHIVED, { threadId: id, originInstanceId });

        logger.info(`[threadService.archive] Archived thread ${id}`);
      }
    } catch (error) {
      // Roll back all optimistic deletes on failure
      for (const rollback of rollbacks) {
        rollback();
      }
      throw error;
    }
  },

  /**
   * Lists all archived threads.
   * Returns ThreadMetadata for threads in archive/threads/ directory.
   */
  async listArchived(): Promise<ThreadMetadata[]> {
    const pattern = `${ARCHIVE_THREADS_DIR}/*/metadata.json`;
    const files = await appData.glob(pattern);
    const threads: ThreadMetadata[] = [];

    for (const filePath of files) {
      const raw = await appData.readJson(filePath);
      const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
      if (result?.success) {
        threads.push(result.data);
      }
    }

    return threads;
  },

  /**
   * Unarchives a thread.
   * Moves the thread folder from archive/threads/ back to threads/.
   * Adds the thread back to the Zustand store and emits THREAD_CREATED.
   */
  async unarchive(threadId: string): Promise<void> {
    invalidateThreadPathCache(threadId);
    const archivePath = `${ARCHIVE_THREADS_DIR}/${threadId}`;
    const metadataPath = `${archivePath}/metadata.json`;

    const raw = await appData.readJson(metadataPath);
    const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
    if (!result?.success) {
      logger.warn(`[threadService.unarchive] Thread ${threadId} not found in archive`);
      return;
    }

    const metadata = result.data;
    const destPath = getStandaloneThreadPath(threadId);

    // Copy files back to active threads directory
    await appData.ensureDir(destPath);

    await appData.writeJson(`${destPath}/metadata.json`, metadata);
    const state = await appData.readJson(`${archivePath}/state.json`);
    if (state) {
      await appData.writeJson(`${destPath}/state.json`, state);
    }

    // Remove from archive
    await appData.removeDir(archivePath);

    // Add back to store
    useThreadStore.getState()._applyCreate(metadata);

    // Emit event so tree menu and other listeners can react
    eventBus.emit(EventName.THREAD_CREATED, {
      threadId,
      repoId: metadata.repoId,
      worktreeId: metadata.worktreeId,
    });

    logger.info(`[threadService.unarchive] Unarchived thread ${threadId}`);
  },

  /**
   * Get plans related to a thread.
   * Uses the relation service to find associated plans.
   */
  getRelatedPlans(threadId: string): PlanMetadata[] {
    // Lazy import to avoid circular dependency
    const { relationService } = require("../relations/service");
    const { usePlanStore } = require("../plans/store");
    const relations = relationService.getByThread(threadId);
    const planStore = usePlanStore.getState();
    return relations
      .map((r: { planId: string }) => planStore.getPlan(r.planId))
      .filter((p: PlanMetadata | undefined): p is PlanMetadata => p !== undefined);
  },
};
