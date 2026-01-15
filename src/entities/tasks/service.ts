import { optimistic } from "@/lib/optimistic";
import { persistence } from "@/lib/persistence";
import { slugify, resolveSlugConflict } from "@/lib/slug";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { useTaskStore } from "./store";
import {
  TaskMetadataSchema,
  generateTaskId,
  type TaskMetadata,
  type TaskStatus,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./types";
import { ThreadMetadataSchema, parseThreadFolderName, type ThreadMetadata } from "../threads/types";

/** Input for creating a draft task from spotlight */
interface CreateDraftInput {
  prompt: string;
  repositoryName: string;
}

const TASKS_DIR = "tasks";

export const taskService = {
  /**
   * Hydrates the task store from disk.
   * Should be called once at app initialization.
   * Reads from folder structure: tasks/{slug}/metadata.json
   */
  async hydrate(): Promise<void> {
    await persistence.ensureDir(TASKS_DIR);
    const entries = await persistence.listDirEntries(TASKS_DIR);
    logger.debug("[taskService.hydrate] entries:", entries.length);
    const tasks: Record<string, TaskMetadata> = {};

    for (const entry of entries) {
      logger.debug("[taskService.hydrate] entry:", entry.name, "isDirectory:", entry.isDirectory);
      if (entry.isDirectory) {
        const raw = await persistence.readJson(
          `${TASKS_DIR}/${entry.name}/metadata.json`
        );
        const result = raw ? TaskMetadataSchema.safeParse(raw) : null;
        logger.debug("[taskService.hydrate] metadata for", entry.name, ":", result?.success ? "loaded" : "invalid/null");
        if (result?.success) {
          tasks[result.data.id] = result.data;
        }
      }
    }

    logger.debug("[taskService.hydrate] total tasks loaded:", Object.keys(tasks).length);
    useTaskStore.getState().hydrate(tasks);
  },

  /**
   * Refreshes all tasks from disk.
   * Unlike hydrate(), this can be called at any time and replaces the entire task state.
   * Also refreshes all threads to ensure consistent state across the system.
   */
  async refresh(): Promise<void> {
    const entries = await persistence.listDirEntries(TASKS_DIR);
    const tasks: Record<string, TaskMetadata> = {};

    for (const entry of entries) {
      if (entry.isDirectory) {
        const raw = await persistence.readJson(
          `${TASKS_DIR}/${entry.name}/metadata.json`
        );
        const result = raw ? TaskMetadataSchema.safeParse(raw) : null;
        if (result?.success) {
          tasks[result.data.id] = result.data;
        }
      }
    }

    useTaskStore.setState({ tasks, _hydrated: true });

    // Also refresh all threads to ensure consistency
    const { threadService } = await import("../threads/service");
    await threadService.hydrate();
  },

  /**
   * Refreshes a single task from disk by slug.
   * Used when the agent CLI modifies a task - performs targeted update
   * rather than full refresh for efficiency.
   * NOTE: Takes slug (storage key), not taskId.
   */
  async refreshTaskBySlug(slug: string): Promise<void> {
    logger.debug(`[taskService.refreshTaskBySlug] Refreshing task: ${slug}`);
    const raw = await persistence.readJson(
      `${TASKS_DIR}/${slug}/metadata.json`
    );
    const result = raw ? TaskMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      const task = result.data;
      // Check if there are new pending reviews (emit event for immediate UI update)
      const existing = useTaskStore.getState().tasks[task.id];
      const oldUnaddressed = existing?.pendingReviews?.filter((r) => !r.isAddressed) ?? [];
      const newUnaddressed = task.pendingReviews?.filter((r) => !r.isAddressed) ?? [];

      // Use ID-based comparison to detect genuinely new reviews
      // (count comparison could miss cases where one review is replaced with another)
      const oldIds = new Set(oldUnaddressed.map((r) => r.id));
      const genuinelyNew = newUnaddressed.filter((r) => !oldIds.has(r.id));

      logger.debug(`[taskService.refreshTaskBySlug] Task ${slug}: oldUnaddressed=${oldUnaddressed.length}, newUnaddressed=${newUnaddressed.length}, genuinelyNew=${genuinelyNew.length}`);

      // Task exists on disk - upsert into store
      useTaskStore.getState()._applyUpdate(task.id, task);

      // Emit for the most recent genuinely new review
      if (genuinelyNew.length > 0) {
        const latest = genuinelyNew.sort((a, b) => b.requestedAt - a.requestedAt)[0];
        if (latest) {
          logger.debug(`[taskService.refreshTaskBySlug] Emitting action-requested for task ${task.id}`);
          eventBus.emit("action-requested", {
            taskId: task.id,
            markdown: latest.markdown,
            defaultResponse: latest.defaultResponse,
          });
        }
      }
    } else {
      // Task folder was deleted - remove from store by slug
      const existing = this.findBySlug(slug);
      if (existing) {
        useTaskStore.getState()._applyDelete(existing.id);
      }
    }
  },

  /**
   * Refreshes a single task from disk by ID.
   * Must scan all folders to find the task by ID.
   */
  async refreshTask(taskId: string): Promise<void> {
    logger.debug(`[taskService.refreshTask] Starting refresh for task: ${taskId}`);

    // Find task by scanning all folders
    const entries = await persistence.listDirEntries(TASKS_DIR);
    logger.debug(`[taskService.refreshTask] Found ${entries.length} entries in tasks directory`);

    for (const entry of entries) {
      if (entry.isDirectory) {
        const metadataPath = `${TASKS_DIR}/${entry.name}/metadata.json`;
        logger.debug(`[taskService.refreshTask] Checking ${metadataPath}`);

        const raw = await persistence.readJson(metadataPath);
        const result = raw ? TaskMetadataSchema.safeParse(raw) : null;

        if (result?.success && result.data.id === taskId) {
          logger.debug(`[taskService.refreshTask] Found task ${taskId} at slug: ${entry.name}, updating store`);
          useTaskStore.getState()._applyUpdate(taskId, result.data);
          logger.debug(`[taskService.refreshTask] Store update completed for task: ${taskId}`);
          return;
        } else if (result?.success) {
          logger.debug(`[taskService.refreshTask] Found valid task but different ID: ${result.data.id} (looking for ${taskId})`);
        } else {
          logger.debug(`[taskService.refreshTask] Invalid metadata at ${metadataPath}`);
        }
      }
    }

    // Task not found on disk - remove from store
    logger.debug(`[taskService.refreshTask] Task ${taskId} not found on disk, removing from store`);
    useTaskStore.getState()._applyDelete(taskId);
  },

  /**
   * Resolves the correct slug for a task, handling potential renames.
   *
   * When the agent renames a task (e.g., draft-123 → fix-auth-bug), the cached
   * slug in the store becomes stale. This helper:
   * 1. Checks if metadata.json exists at the cached slug
   * 2. If not, scans all task folders to find the task by ID
   * 3. Updates the store with the correct metadata
   *
   * Returns the correct slug, or null if task not found anywhere.
   */
  async resolveSlug(taskId: string): Promise<string | null> {
    const cachedTask = useTaskStore.getState().tasks[taskId];

    if (cachedTask) {
      // Check if metadata.json exists at the cached slug
      const metadataExists = await persistence.exists(
        `${TASKS_DIR}/${cachedTask.slug}/metadata.json`
      );
      if (metadataExists) {
        // Cached slug is still valid
        return cachedTask.slug;
      }
      // Cached slug is stale - fall through to scan
      logger.debug(`[taskService.resolveSlug] Stale slug detected for ${taskId}: ${cachedTask.slug}`);
    }

    // Scan all task directories to find the task by ID
    const entries = await persistence.listDirEntries(TASKS_DIR);
    for (const entry of entries) {
      if (entry.isDirectory) {
        const raw = await persistence.readJson(
          `${TASKS_DIR}/${entry.name}/metadata.json`
        );
        const result = raw ? TaskMetadataSchema.safeParse(raw) : null;
        if (result?.success && result.data.id === taskId) {
          logger.debug(`[taskService.resolveSlug] Found task ${taskId} at slug: ${entry.name}`);
          useTaskStore.getState()._applyUpdate(taskId, result.data);
          return entry.name;
        }
      }
    }

    // Task not found anywhere
    if (cachedTask) {
      // Remove stale entry from store
      logger.debug(`[taskService.resolveSlug] Task ${taskId} not found on disk, removing from store`);
      useTaskStore.getState()._applyDelete(taskId);
    }
    return null;
  },

  /**
   * Handles remote deletion of a task.
   * Called when the CLI deletes a task and we need to sync the store.
   */
  handleRemoteDelete(taskId: string): void {
    useTaskStore.getState()._applyDelete(taskId);
  },

  /**
   * Handles remote deletion of a task by slug.
   */
  handleRemoteDeleteBySlug(slug: string): void {
    const task = this.findBySlug(slug);
    if (task) {
      useTaskStore.getState()._applyDelete(task.id);
    }
  },

  /**
   * Gets a task by ID from the store.
   */
  get(id: string): TaskMetadata | undefined {
    return useTaskStore.getState().tasks[id];
  },

  /**
   * Gets all tasks from the store.
   */
  getAll(): TaskMetadata[] {
    return Object.values(useTaskStore.getState().tasks);
  },

  /**
   * Gets root tasks (tasks without parents).
   */
  getRootTasks(): TaskMetadata[] {
    return useTaskStore.getState().getRootTasks();
  },

  /**
   * Gets subtasks of a parent task.
   */
  getSubtasks(parentId: string): TaskMetadata[] {
    return useTaskStore.getState().getSubtasks(parentId);
  },

  /**
   * Creates a new task.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * Creates folder structure: tasks/{slug}/metadata.json
   */
  async create(input: CreateTaskInput): Promise<TaskMetadata> {
    const now = Date.now();

    // Generate slug from title
    const baseSlug = slugify(input.title);

    // Check for slug conflicts
    const existingSlugs = new Set(this.listSlugs());
    const slug = resolveSlugConflict(baseSlug, existingSlugs);

    // Generate branch name
    const branchName = `task/${slug}`;

    const metadata: TaskMetadata = {
      id: crypto.randomUUID(),
      slug,
      title: input.title,
      description: input.description,
      branchName,
      type: input.type ?? "work",
      subtasks: [],
      status: input.status ?? "todo",
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId ?? null,
      tags: input.tags ?? [],
      sortOrder: now,
      repositoryName: input.repositoryName,
      pendingReviews: [],
    };

    await optimistic(
      metadata,
      (task) => useTaskStore.getState()._applyCreate(task),
      async (task) => {
        // Create task folder, threads subdirectory, and write metadata.json
        await persistence.ensureDir(`${TASKS_DIR}/${task.slug}`);
        await persistence.ensureDir(`${TASKS_DIR}/${task.slug}/threads`);
        await persistence.writeJson(`${TASKS_DIR}/${task.slug}/metadata.json`, task);
      }
    );

    return metadata;
  },

  /**
   * Creates a draft task from spotlight.
   * Drafts are created immediately when user submits a prompt,
   * before the agent routes and determines the final task type.
   * Creates folder structure: tasks/draft-{id}/metadata.json
   */
  async createDraft(input: CreateDraftInput): Promise<TaskMetadata> {
    logger.debug(`[taskService.createDraft] Creating draft task for repo: ${input.repositoryName}`);
    logger.debug(`[taskService.createDraft] Prompt: ${input.prompt.slice(0, 100)}${input.prompt.length > 100 ? '...' : ''}`);

    const now = Date.now();
    const taskId = generateTaskId();

    // Truncate prompt for temporary title (first line, max 50 chars)
    const firstLine = input.prompt.split("\n")[0];
    const title =
      firstLine.length > 50 ? firstLine.slice(0, 47) + "..." : firstLine;

    // Use taskId as the slug - no prefix needed
    // This ensures id and slug match, simplifying path resolution
    const slug = taskId;

    const metadata: TaskMetadata = {
      id: taskId,
      slug,
      title,
      description: input.prompt,
      branchName: taskId,
      type: "work",
      subtasks: [],
      status: "backlog",  // New tasks start in backlog
      createdAt: now,
      updatedAt: now,
      parentId: null,
      tags: [],
      sortOrder: now,
      repositoryName: input.repositoryName,
      pendingReviews: [],
    };

    logger.debug(`[taskService.createDraft] Generated task metadata:`, {
      id: metadata.id,
      slug: metadata.slug,
      title: metadata.title,
      status: metadata.status,
      repositoryName: metadata.repositoryName
    });

    await optimistic(
      metadata,
      (task) => {
        logger.debug(`[taskService.createDraft] Optimistic store update - applying create for task: ${task.id}`);
        const rollback = useTaskStore.getState()._applyCreate(task);
        logger.debug(`[taskService.createDraft] Optimistic store update completed for task: ${task.id}`);
        return rollback;
      },
      async (task) => {
        logger.debug(`[taskService.createDraft] Writing task to disk: ${TASKS_DIR}/${task.slug}`);

        // Create task folder, threads subdirectory, and write metadata.json
        await persistence.ensureDir(`${TASKS_DIR}/${task.slug}`);
        await persistence.ensureDir(`${TASKS_DIR}/${task.slug}/threads`);
        await persistence.writeJson(`${TASKS_DIR}/${task.slug}/metadata.json`, task);

        logger.debug(`[taskService.createDraft] Successfully wrote task metadata to disk: ${task.id}`);
      }
    );

    logger.debug(`[taskService.createDraft] Draft task creation completed: ${taskId}`);
    return metadata;
  },

  /**
   * Gets all backlog tasks.
   * Used for cleanup purposes (previously called getDrafts).
   */
  getBacklogTasks(): TaskMetadata[] {
    return Object.values(useTaskStore.getState().tasks).filter(
      (t) => t.status === "backlog"
    );
  },

  /**
   * Updates a task.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * Writes to: tasks/{slug}/metadata.json
   */
  async update(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
    const existing = useTaskStore.getState().tasks[id];
    if (!existing) throw new Error(`Task not found: ${id}`);

    const updated: TaskMetadata = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    await optimistic(
      updated,
      (task) => useTaskStore.getState()._applyUpdate(id, task),
      (task) => persistence.writeJson(`${TASKS_DIR}/${task.slug}/metadata.json`, task)
    );

    // Emit status-changed event if status was updated (cross-concern notification)
    if (updates.status && updates.status !== existing.status) {
      eventBus.emit("task:status-changed", { taskId: id, status: updates.status });
    }

    return updated;
  },

  /**
   * Deletes a task and its content.
   * Also deletes any child subtasks recursively.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * Removes entire folder: tasks/{slug}/
   */
  async delete(id: string): Promise<void> {
    console.log(`[TaskService] delete() called for task ID: ${id}`);

    const task = useTaskStore.getState().tasks[id];
    if (!task) {
      console.log(`[TaskService] Task ${id} not found in store, nothing to delete`);
      return;
    }

    console.log(`[TaskService] Found task to delete:`, { id, slug: task.slug, title: task.title });

    // Delete subtasks first
    const subtasks = useTaskStore.getState().getSubtasks(id);
    console.log(`[TaskService] Found ${subtasks.length} subtasks to delete first`);
    for (const subtask of subtasks) {
      console.log(`[TaskService] Deleting subtask: ${subtask.id}`);
      await this.delete(subtask.id);
    }

    console.log(`[TaskService] All subtasks deleted, proceeding with main task deletion`);

    // Optimistically remove from store, then delete folder
    console.log(`[TaskService] Applying optimistic store update for: ${id}`);
    const rollback = useTaskStore.getState()._applyDelete(id);

    try {
      // Remove entire task folder
      const folderPath = `${TASKS_DIR}/${task.slug}`;
      console.log(`[TaskService] Removing task folder: ${folderPath}`);
      await persistence.removeDir(folderPath);
      console.log(`[TaskService] Successfully removed task folder: ${folderPath}`);

      // Emit event for cross-window synchronization
      eventBus.emit(EventName.TASK_DELETED, { taskId: id });
      console.log(`[TaskService] Emitted TASK_DELETED event for: ${id}`);
    } catch (error) {
      console.error(`[TaskService] Failed to remove task folder, rolling back store changes:`, error);
      rollback();
      throw error;
    }

    console.log(`[TaskService] Task deletion completed successfully for: ${id}`);
  },

  /**
   * Gets the content (markdown body) of a task.
   * Content is lazy-loaded and cached in the store.
   * Reads from: tasks/{slug}/content.md
   */
  async getContent(id: string): Promise<string> {
    const cached = useTaskStore.getState().taskContent[id];
    if (cached !== undefined) return cached;

    const task = useTaskStore.getState().tasks[id];
    if (!task) return "";

    const content = (await persistence.readText(`${TASKS_DIR}/${task.slug}/content.md`)) ?? "";
    useTaskStore.getState()._applyContentLoaded(id, content);
    return content;
  },

  /**
   * Refreshes content from disk, bypassing cache.
   * Use when agent may have written to content.md.
   * Handles task renames by resolving the correct slug first.
   */
  async refreshContent(id: string): Promise<string> {
    // Resolve the correct slug (handles renames)
    const slug = await this.resolveSlug(id);
    if (!slug) {
      logger.debug(`[taskService.refreshContent] Task not found: ${id}`);
      return "";
    }

    const path = `${TASKS_DIR}/${slug}/content.md`;
    logger.debug(`[taskService.refreshContent] Reading: ${path}`);
    const content = (await persistence.readText(path)) ?? "";
    logger.debug(`[taskService.refreshContent] Read ${content.length} chars from ${path}`);
    useTaskStore.getState()._applyContentLoaded(id, content);
    return content;
  },

  /**
   * Sets the content (markdown body) of a task.
   * Uses optimistic updates - UI updates immediately, rolls back on failure.
   * Writes to: tasks/{slug}/content.md
   */
  async setContent(id: string, content: string): Promise<void> {
    const task = useTaskStore.getState().tasks[id];
    if (!task) throw new Error(`Task not found: ${id}`);

    await optimistic(
      content,
      (c) => useTaskStore.getState()._applyContentLoaded(id, c),
      (c) => persistence.writeText(`${TASKS_DIR}/${task.slug}/content.md`, c)
    );
  },

  /**
   * Gets all threads for a task by scanning its threads directory.
   * Returns threads sorted by creation time (newest first).
   */
  async getThreads(taskId: string): Promise<ThreadMetadata[]> {
    const task = useTaskStore.getState().tasks[taskId];
    if (!task) return [];

    const threadsDir = `${TASKS_DIR}/${task.slug}/threads`;
    const entries = await persistence.listDirEntries(threadsDir);
    const threads: ThreadMetadata[] = [];

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory)
        .map(async (entry) => {
          const parsed = parseThreadFolderName(entry.name);
          if (!parsed) return; // Skip invalid folder names

          const raw = await persistence.readJson(
            `${threadsDir}/${entry.name}/metadata.json`
          );
          const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
          if (result?.success) threads.push(result.data);
        })
    );

    return threads.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace Management Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Updates a task's status.
   * Convenience method for workspace management.
   */
  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.update(taskId, { status });
  },

  /**
   * Lists tasks, optionally filtered by repository.
   * Excludes backlog tasks by default.
   * Returns tasks sorted by creation time (newest first).
   */
  listTasks(options?: {
    repositoryName?: string;
    includeBacklog?: boolean;
  }): TaskMetadata[] {
    const allTasks = Object.values(useTaskStore.getState().tasks);

    let filtered = allTasks;

    // Exclude backlog tasks unless explicitly requested
    if (!options?.includeBacklog) {
      filtered = filtered.filter((t) => t.status !== "backlog");
    }

    // Filter by repository if specified
    if (options?.repositoryName) {
      filtered = filtered.filter((t) => t.repositoryName === options.repositoryName);
    }

    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  },

  /**
   * Gets tasks for a specific repository.
   */
  getTasksByRepository(repositoryName: string): TaskMetadata[] {
    return this.listTasks({ repositoryName });
  },

  /**
   * Finds a task by its slug.
   */
  findBySlug(slug: string): TaskMetadata | undefined {
    return Object.values(useTaskStore.getState().tasks).find(
      (task) => task.slug === slug
    );
  },

  /**
   * Lists all slugs currently in use.
   * Used for conflict checking when creating new tasks.
   */
  listSlugs(): string[] {
    return Object.values(useTaskStore.getState().tasks).map((task) => task.slug);
  },
};
