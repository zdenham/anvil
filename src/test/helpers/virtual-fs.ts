/**
 * Virtual filesystem helper for UI isolation tests.
 *
 * Provides utilities to seed the in-memory filesystem with test data,
 * simulating disk state without touching the real filesystem.
 */

import type { ThreadState } from "@core/types/events";
import { mockFileSystem, MOCK_MORT_DIR, mockThreadState, type MockThreadMetadata } from "../mocks/tauri-api";

// ============================================================================
// Types
// ============================================================================

export interface SeedThreadOptions {
  repoId?: string;
  worktreeId?: string;
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
  // Thread Helpers
  // ==========================================================================

  /**
   * Seed a thread with state files on disk.
   *
   * @example
   * VirtualFS.seedThread("thread-123", { status: "running" });
   */
  static seedThread(threadId: string, options: SeedThreadOptions = {}): void {
    const threadDir = `${MOCK_MORT_DIR}/threads/${threadId}`;

    // Create thread metadata for Tauri command mocks
    const threadMeta: MockThreadMetadata = {
      id: threadId,
      repoId: options.repoId ?? "repo-123",
      status:
        options.status === "idle" ? "paused" : options.status === "completed" ? "completed" : options.status ?? "running",
    };
    mockThreadState.threads.set(threadId, threadMeta);

    // Create thread state file
    const state: ThreadState = {
      messages: options.messages ?? [],
      fileChanges: options.fileChanges ?? [],
      workingDirectory: options.workingDirectory ?? `/Users/test/code/worktrees/thread-${threadId.slice(0, 8)}`,
      status: options.status === "completed" ? "complete" : options.status === "error" ? "error" : "running",
      timestamp: Date.now(),
      toolStates: {},
    };

    mockFileSystem.set(`${threadDir}/state.json`, JSON.stringify(state, null, 2));
    mockFileSystem.set(
      `${threadDir}/metadata.json`,
      JSON.stringify({
        id: threadId,
        repoId: options.repoId ?? "repo-123",
        worktreeId: options.worktreeId ?? "worktree-123",
        status: options.status ?? "running",
        createdAt: Date.now(),
      })
    );
  }

  /**
   * Update thread state.
   */
  static updateThreadState(threadId: string, state: Partial<ThreadState>): void {
    const threadDir = `${MOCK_MORT_DIR}/threads/${threadId}`;
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
