import crypto from "crypto";
import { z } from "zod";
import { slugify, resolveSlugConflict } from "./slug.js";
import {
  generateTaskId,
  TASK_STATUSES,
  SubtaskSchema,
  PendingReviewSchema,
  type CreateTaskInput,
  type PendingReview,
  type TaskMetadata,
  type TaskStatus,
  type UpdateTaskInput,
} from "./types.js";
import { logger } from "../lib/logger.js";

const TASKS_DIR = "tasks";

/** All valid statuses including cancelled (which isn't in TASK_STATUSES display array) */
const ALL_VALID_STATUSES = [...TASK_STATUSES, "cancelled"] as const;

/**
 * Validate that a status is a valid TaskStatus.
 * Throws if invalid.
 */
function validateTaskStatus(status: string): TaskStatus {
  if (!ALL_VALID_STATUSES.includes(status as TaskStatus)) {
    throw new Error(
      `Invalid task status "${status}". Valid values: ${ALL_VALID_STATUSES.join(", ")}`
    );
  }
  return status as TaskStatus;
}

/**
 * Legacy status migration map.
 * Maps old status values to current TaskStatus values.
 */
const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  "complete": "done",
  "completed": "done",
  "in_progress": "in-progress",
  "in_review": "in-review",
  "pending": "todo",
  "paused": "todo",
  "merged": "done",
};

/**
 * Schema for reading task metadata from disk with legacy migrations.
 *
 * This schema is more lenient than TaskMetadataSchema - it accepts legacy
 * status values and missing optional fields, transforming them to the
 * canonical format. Supports both regular tasks and simple tasks (which
 * have minimal metadata).
 */
const TaskMetadataOnDiskSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),                           // Optional for simple tasks
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string().nullable().optional(),          // Nullable and optional for simple tasks
  type: z.enum(["work", "investigate", "simple"]),
  subtasks: z.array(SubtaskSchema).optional().default([]),
  // Accept any string status, transform legacy values
  status: z.string().transform((status): TaskStatus => {
    if (status in LEGACY_STATUS_MAP) {
      return LEGACY_STATUS_MAP[status];
    }
    // Validate against known statuses
    if (ALL_VALID_STATUSES.includes(status as TaskStatus)) {
      return status as TaskStatus;
    }
    // Default to "todo" for unknown statuses
    return "todo";
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
  parentId: z.string().nullable().optional(),            // Optional for simple tasks
  tags: z.array(z.string()).optional().default([]),
  sortOrder: z.number().optional(),                      // Optional for simple tasks
  repositoryName: z.string().optional(),
  pendingReviews: z.array(PendingReviewSchema).optional().default([]),
  // Legacy field migration: pendingReview (singular) -> pendingReviews (array)
  pendingReview: z.object({
    markdown: z.string(),
    defaultResponse: z.string(),
    requestedAt: z.number(),
    onApprove: z.string(),
    onFeedback: z.string(),
  }).optional(),
  reviewApproved: z.boolean().optional(),
  prUrl: z.string().optional(),
  cwd: z.string().optional(),                            // Working directory for simple tasks
}).transform((data) => {
  // Migrate legacy pendingReview (singular) to pendingReviews (array)
  let pendingReviews = data.pendingReviews;
  if (data.pendingReview && pendingReviews.length === 0) {
    pendingReviews = [{
      ...data.pendingReview,
      id: crypto.randomUUID(),
      threadId: 'legacy',  // Sentinel value for pre-migration reviews
      isAddressed: false,
    }];
  }

  // Return canonical TaskMetadata with computed defaults (excludes legacy pendingReview field)
  const result: TaskMetadata = {
    id: data.id,
    slug: data.slug ?? data.id,                          // Default to id for simple tasks
    title: data.title,
    description: data.description,
    branchName: data.branchName ?? null,                 // Default to null for simple tasks
    type: data.type,
    subtasks: data.subtasks,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    parentId: data.parentId ?? null,                     // Default to null
    tags: data.tags,
    sortOrder: data.sortOrder ?? data.createdAt,         // Default to createdAt
    repositoryName: data.repositoryName,
    pendingReviews,
    reviewApproved: data.reviewApproved,
    prUrl: data.prUrl,
    cwd: data.cwd,                                       // Preserve cwd for simple tasks
  };
  return result;
});

/**
 * Parse and validate task metadata from disk.
 * Returns null if validation fails, logging the error.
 */
function parseTaskMetadata(raw: unknown, context: string): TaskMetadata | null {
  const result = TaskMetadataOnDiskSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  logger.error(`[persistence] Invalid task metadata in ${context}:`, result.error.format());
  return null;
}

/**
 * Abstract persistence class for .mort/ directory operations.
 * Implementations provide platform-specific I/O (Node.js fs, Tauri IPC, etc.)
 * while sharing all task operation logic.
 *
 * Tasks are stored as folders:
 *   .mort/tasks/{slug}/metadata.json  - TaskMetadata object
 *   .mort/tasks/{slug}/content.md     - Task content (optional)
 */
export abstract class MortPersistence {
  // ─────────────────────────────────────────────────────────────────────────
  // Abstract I/O methods - implemented by platform-specific adapters
  // ─────────────────────────────────────────────────────────────────────────

  abstract read<T>(path: string): Promise<T | null>;
  abstract write(path: string, data: unknown): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract list(dir: string): Promise<string[]>;
  abstract listDirs(dir: string): Promise<string[]>;
  abstract exists(path: string): Promise<boolean>;
  abstract mkdir(path: string): Promise<void>;
  abstract rmdir(path: string): Promise<void>;
  abstract writeText(path: string, content: string): Promise<void>;
  abstract readText(path: string): Promise<string | null>;
  abstract rename(oldPath: string, newPath: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // Shared task operations (same logic, different I/O)
  // Uses folder structure: tasks/{slug}/metadata.json + content.md
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new task with automatic slug generation and conflict resolution.
   * Creates folder: tasks/{slug}/metadata.json
   */
  async createTask(input: CreateTaskInput): Promise<TaskMetadata> {
    // Validate status if provided
    const status = input.status
      ? validateTaskStatus(input.status)
      : "todo";

    const existingSlugs = await this.listTaskSlugs();
    const slug = resolveSlugConflict(slugify(input.title), existingSlugs);
    const now = Date.now();

    const task: TaskMetadata = {
      id: generateTaskId(),
      slug,
      title: input.title,
      description: input.description,
      branchName: `task/${slug}`,
      type: input.type ?? "work",
      status,
      subtasks: [],
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId ?? null,
      tags: input.tags ?? [],
      sortOrder: now,
      repositoryName: input.repositoryName,
      pendingReviews: [],
    };

    // Create task folder and write metadata
    await this.mkdir(`${TASKS_DIR}/${slug}`);
    await this.write(`${TASKS_DIR}/${slug}/metadata.json`, task);
    await this.writeText(`${TASKS_DIR}/${slug}/content.md`, "");
    return task;
  }

  /**
   * Update an existing task by ID.
   * Finds task folder by scanning, then updates metadata.json.
   */
  async updateTask(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    // Validate status if provided
    if (updates.status) {
      validateTaskStatus(updates.status);
    }

    let pendingReviews = [...(task.pendingReviews ?? [])];

    // Handle addPendingReview operation
    if (updates.addPendingReview) {
      const newReview: PendingReview = {
        ...updates.addPendingReview,
        id: crypto.randomUUID(),
        isAddressed: false,  // Explicitly set to false for new reviews
      };
      pendingReviews.push(newReview);
    }

    // Handle addressPendingReview operation
    if (updates.addressPendingReview) {
      const reviewExists = pendingReviews.some(
        (r) => r.id === updates.addressPendingReview
      );

      if (!reviewExists) {
        // Log warning but don't throw - the review may have been deleted or ID is stale
        logger.warn(
          `[persistence] addressPendingReview: review ID not found: ${updates.addressPendingReview}`
        );
      }

      pendingReviews = pendingReviews.map((r) =>
        r.id === updates.addressPendingReview
          ? { ...r, isAddressed: true }
          : r
      );
    }

    // Remove the operation fields from updates spread
    const { addPendingReview, addressPendingReview, ...restUpdates } = updates;

    const updated: TaskMetadata = {
      ...task,
      ...restUpdates,
      pendingReviews,
      updatedAt: Date.now(),
    };

    await this.write(`${TASKS_DIR}/${task.slug}/metadata.json`, updated);
    return updated;
  }

  /**
   * Rename a task - updates title, regenerates slug, and renames folder.
   * This is the preferred way to change a task's title as it keeps slug in sync.
   */
  async renameTask(id: string, newTitle: string): Promise<TaskMetadata> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    const oldSlug = task.slug;
    const existingSlugs = await this.listTaskSlugs();
    // Remove old slug from conflicts so we don't get task-title-2 if title is same
    existingSlugs.delete(oldSlug);
    const newSlug = resolveSlugConflict(slugify(newTitle), existingSlugs);

    // If slug hasn't changed, just update the title
    if (newSlug === oldSlug) {
      const updated: TaskMetadata = {
        ...task,
        title: newTitle,
        updatedAt: Date.now(),
      };
      await this.write(`${TASKS_DIR}/${oldSlug}/metadata.json`, updated);
      return updated;
    }

    // Rename the folder
    await this.rename(`${TASKS_DIR}/${oldSlug}`, `${TASKS_DIR}/${newSlug}`);

    // Update metadata with new slug and branch name
    const updated: TaskMetadata = {
      ...task,
      title: newTitle,
      slug: newSlug,
      branchName: `task/${newSlug}`,
      updatedAt: Date.now(),
    };
    await this.write(`${TASKS_DIR}/${newSlug}/metadata.json`, updated);

    return updated;
  }

  /**
   * Delete a task by ID.
   * Removes the entire task folder.
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    const taskPath = `${TASKS_DIR}/${task.slug}`;

    // Delete content.md if it exists
    if (await this.exists(`${taskPath}/content.md`)) {
      await this.delete(`${taskPath}/content.md`);
    }
    // Delete metadata.json
    await this.delete(`${taskPath}/metadata.json`);
    // Remove the folder
    await this.rmdir(taskPath);
  }

  /**
   * Get a task by ID.
   * Must scan all task folders since storage is organized by slug.
   */
  async getTask(id: string): Promise<TaskMetadata | null> {
    const start = performance.now();
    const tasks = await this.listTasks();
    const result = tasks.find((t) => t.id === id) ?? null;
    logger.debug(`[persistence] getTask(id=${id}) scanned ${tasks.length} tasks in ${(performance.now() - start).toFixed(2)}ms`);
    return result;
  }

  /**
   * List all tasks, sorted by updatedAt (most recent first).
   * Reads metadata.json from each task folder with Zod validation.
   */
  async listTasks(): Promise<TaskMetadata[]> {
    const start = performance.now();
    const listDirsStart = performance.now();
    const dirs = await this.listDirs(TASKS_DIR);
    const listDirsTime = performance.now() - listDirsStart;

    const tasks: TaskMetadata[] = [];
    const readStart = performance.now();
    for (const dir of dirs) {
      const raw = await this.read<unknown>(`${TASKS_DIR}/${dir}/metadata.json`);
      if (raw) {
        const task = parseTaskMetadata(raw, dir);
        if (task) tasks.push(task);
      }
    }
    const readTime = performance.now() - readStart;

    const sorted = tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    logger.debug(`[persistence] listTasks: ${dirs.length} dirs, listDirs=${listDirsTime.toFixed(2)}ms, readAll=${readTime.toFixed(2)}ms, total=${(performance.now() - start).toFixed(2)}ms`);
    return sorted;
  }

  /**
   * Find a task by slug (direct lookup - O(1)).
   * Uses Zod validation with legacy migrations.
   */
  async findTaskBySlug(slug: string): Promise<TaskMetadata | null> {
    const raw = await this.read<unknown>(`${TASKS_DIR}/${slug}/metadata.json`);
    if (!raw) return null;
    return parseTaskMetadata(raw, slug);
  }

  /**
   * Get task content (markdown body).
   */
  async getTaskContent(taskId: string): Promise<string | null> {
    const start = performance.now();
    const task = await this.getTask(taskId);
    if (!task) return null;
    const content = await this.readText(`${TASKS_DIR}/${task.slug}/content.md`);
    logger.debug(`[persistence] getTaskContent(id=${taskId}) took ${(performance.now() - start).toFixed(2)}ms`);
    return content;
  }

  /**
   * Set task content (markdown body).
   */
  async setTaskContent(taskId: string, content: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    await this.writeText(`${TASKS_DIR}/${task.slug}/content.md`, content);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async listTaskSlugs(): Promise<Set<string>> {
    const dirs = await this.listDirs(TASKS_DIR);
    return new Set(dirs);
  }
}
