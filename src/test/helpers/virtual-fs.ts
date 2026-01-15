/**
 * Virtual filesystem helper for UI isolation tests.
 *
 * Provides utilities to seed the in-memory filesystem with test data,
 * simulating disk state without touching the real filesystem.
 */

import type { TaskMetadata, TaskStatus } from "@core/types/tasks";
import type { ThreadState } from "@core/types/events";
import { mockFileSystem, MOCK_MORT_DIR, mockThreadState, type MockThreadMetadata } from "../mocks/tauri-api";

// ============================================================================
// Types
// ============================================================================

export interface SeedTaskOptions {
  id?: string;
  slug?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  type?: "work" | "investigate" | "simple";
  repositoryName?: string;
  branchName?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SeedThreadOptions {
  taskId?: string;
  status?: "idle" | "running" | "completed" | "error" | "paused";
  messages?: ThreadState["messages"];
  fileChanges?: ThreadState["fileChanges"];
  workingDirectory?: string;
}

// ============================================================================
// VirtualFS Class
// ============================================================================

export class VirtualFS {
  /**
   * Seed the filesystem with arbitrary files.
   *
   * @example
   * VirtualFS.seed({
   *   "/Users/test/.mort/settings.json": { theme: "dark" },
   *   "/Users/test/code/my-repo/README.md": "# My Repo",
   * });
   */
  static seed(files: Record<string, string | object>): void {
    for (const [path, content] of Object.entries(files)) {
      const data = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      mockFileSystem.set(path, data);
    }
  }

  /**
   * Get the current contents of a file in the virtual filesystem.
   */
  static get(path: string): string | undefined {
    return mockFileSystem.get(path);
  }

  /**
   * Check if a path exists in the virtual filesystem.
   */
  static exists(path: string): boolean {
    return mockFileSystem.has(path);
  }

  /**
   * Clear all files from the virtual filesystem.
   */
  static clear(): void {
    mockFileSystem.clear();
  }

  /**
   * Get all paths in the virtual filesystem.
   */
  static allPaths(): string[] {
    return [...mockFileSystem.keys()];
  }

  // ==========================================================================
  // Task Helpers
  // ==========================================================================

  /**
   * Seed a task with metadata file on disk.
   *
   * @example
   * VirtualFS.seedTask("fix-bug", { status: "in-progress", title: "Fix the bug" });
   */
  static seedTask(taskSlug: string, options: SeedTaskOptions = {}): TaskMetadata {
    const now = Date.now();
    const id = options.id ?? `task-${taskSlug}-${now.toString(36)}`;

    const metadata: TaskMetadata = {
      id,
      slug: options.slug ?? taskSlug,
      title: options.title ?? `Test Task: ${taskSlug}`,
      description: options.description,
      status: options.status ?? "todo",
      type: options.type ?? "work",
      branchName: options.branchName ?? `mort/${taskSlug}`,
      repositoryName: options.repositoryName,
      subtasks: [],
      tags: options.tags ?? [],
      sortOrder: 0,
      parentId: null,
      pendingReviews: [],
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
    };

    const taskDir = `${MOCK_MORT_DIR}/tasks/${taskSlug}`;
    mockFileSystem.set(`${taskDir}/metadata.json`, JSON.stringify(metadata, null, 2));

    return metadata;
  }

  /**
   * Seed multiple tasks at once.
   *
   * @example
   * VirtualFS.seedTasks([
   *   { slug: "task-1", status: "todo" },
   *   { slug: "task-2", status: "in-progress" },
   * ]);
   */
  static seedTasks(tasks: Array<{ slug: string } & SeedTaskOptions>): TaskMetadata[] {
    return tasks.map((task) => this.seedTask(task.slug, task));
  }

  /**
   * Update an existing task's metadata.
   */
  static updateTask(taskSlug: string, updates: Partial<TaskMetadata>): TaskMetadata | null {
    const taskDir = `${MOCK_MORT_DIR}/tasks/${taskSlug}`;
    const existing = mockFileSystem.get(`${taskDir}/metadata.json`);
    if (!existing) return null;

    const metadata = JSON.parse(existing) as TaskMetadata;
    const updated = { ...metadata, ...updates, updatedAt: Date.now() };
    mockFileSystem.set(`${taskDir}/metadata.json`, JSON.stringify(updated, null, 2));

    return updated;
  }

  /**
   * Get task metadata from the virtual filesystem.
   */
  static getTask(taskSlug: string): TaskMetadata | null {
    const taskDir = `${MOCK_MORT_DIR}/tasks/${taskSlug}`;
    const content = mockFileSystem.get(`${taskDir}/metadata.json`);
    return content ? JSON.parse(content) : null;
  }

  // ==========================================================================
  // Thread Helpers
  // ==========================================================================

  /**
   * Seed a thread with state files on disk.
   *
   * @example
   * VirtualFS.seedThread("fix-bug", "thread-123", { status: "running" });
   */
  static seedThread(taskSlug: string, threadId: string, options: SeedThreadOptions = {}): void {
    const taskDir = `${MOCK_MORT_DIR}/tasks/${taskSlug}`;
    const threadDir = `${taskDir}/threads/${threadId}`;

    // Create thread metadata for Tauri command mocks
    const threadMeta: MockThreadMetadata = {
      id: threadId,
      taskId: options.taskId ?? `task-${taskSlug}`,
      status:
        options.status === "idle" ? "paused" : options.status === "completed" ? "completed" : options.status ?? "running",
    };
    mockThreadState.threads.set(threadId, threadMeta);

    // Create thread state file
    const state: ThreadState = {
      messages: options.messages ?? [],
      fileChanges: options.fileChanges ?? [],
      workingDirectory: options.workingDirectory ?? `/Users/test/code/worktrees/${taskSlug}`,
      status: options.status === "completed" ? "complete" : options.status === "error" ? "error" : "running",
      timestamp: Date.now(),
      toolStates: {},
    };

    mockFileSystem.set(`${threadDir}/state.json`, JSON.stringify(state, null, 2));
    mockFileSystem.set(
      `${threadDir}/metadata.json`,
      JSON.stringify({
        id: threadId,
        taskId: options.taskId ?? `task-${taskSlug}`,
        status: options.status ?? "running",
        createdAt: Date.now(),
      })
    );
  }

  /**
   * Update thread state.
   */
  static updateThreadState(taskSlug: string, threadId: string, state: Partial<ThreadState>): void {
    const threadDir = `${MOCK_MORT_DIR}/tasks/${taskSlug}/threads/${threadId}`;
    const existing = mockFileSystem.get(`${threadDir}/state.json`);
    const current = existing ? JSON.parse(existing) : {};
    const updated = { ...current, ...state, timestamp: Date.now() };
    mockFileSystem.set(`${threadDir}/state.json`, JSON.stringify(updated, null, 2));
  }

  // ==========================================================================
  // Repository Helpers
  // ==========================================================================

  /**
   * Seed a repository configuration.
   */
  static seedRepository(name: string, sourcePath: string): void {
    const repoDir = `${MOCK_MORT_DIR}/repositories/${name}`;
    mockFileSystem.set(
      `${repoDir}/config.json`,
      JSON.stringify({
        name,
        sourcePath,
        createdAt: Date.now(),
      })
    );
  }

  // ==========================================================================
  // Settings Helpers
  // ==========================================================================

  /**
   * Seed application settings.
   */
  static seedSettings(settings: Record<string, unknown>): void {
    mockFileSystem.set(`${MOCK_MORT_DIR}/settings.json`, JSON.stringify(settings, null, 2));
  }
}
