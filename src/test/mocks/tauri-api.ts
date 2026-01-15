/**
 * Mock Tauri APIs for UI isolation testing.
 *
 * Provides in-memory implementations of:
 * - invoke() from @tauri-apps/api/core
 * - emit() and listen() from @tauri-apps/api/event
 *
 * Uses an in-memory Map as a virtual filesystem for fs_* commands.
 */

import { vi } from "vitest";

// ============================================================================
// Virtual Filesystem
// ============================================================================

/** In-memory filesystem state - path -> content */
export const mockFileSystem = new Map<string, string>();

/** Home directory for tests */
export const MOCK_HOME_DIR = "/Users/test";

/** Mort directory for tests */
export const MOCK_MORT_DIR = `${MOCK_HOME_DIR}/.mort`;

// ============================================================================
// Mock Git State
// ============================================================================

export interface MockWorktreeInfo {
  path: string;
  branch: string | null;
  isBare: boolean;
}

/** In-memory git state */
export const mockGitState = {
  branches: new Map<string, string>(), // branch name -> commit hash
  defaultBranch: "main",
  worktrees: [] as MockWorktreeInfo[],
};

// ============================================================================
// Mock Thread/Process State
// ============================================================================

export type MockThreadStatus = "running" | "completed" | "error" | "paused";

export interface MockThreadMetadata {
  id: string;
  taskId: string;
  status: MockThreadStatus;
}

export const mockThreadState = {
  threads: new Map<string, MockThreadMetadata>(),
  runningProcesses: new Set<string>(),
};

// ============================================================================
// Captured Logs
// ============================================================================

/** Captured log entries from web_log invocations */
export const capturedLogs: Array<{ level: string; message: string; timestamp: number }> = [];

// ============================================================================
// Mock Invoke
// ============================================================================

/**
 * Mock implementation of Tauri's invoke function.
 * Routes commands to in-memory state.
 */
export const mockInvoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    // Filesystem commands
    case "fs_exists":
      return mockFileSystem.has(args?.path as string);

    case "fs_read_file": {
      const content = mockFileSystem.get(args?.path as string);
      if (content === undefined) {
        throw new Error(`File not found: ${args?.path}`);
      }
      return content;
    }

    case "fs_write_file": {
      mockFileSystem.set(args?.path as string, args?.contents as string);
      return;
    }

    case "fs_list_dir_names": {
      const dirPath = args?.path as string;
      const normalizedDir = dirPath.endsWith("/") ? dirPath : dirPath + "/";
      const entries = new Set<string>();

      for (const key of mockFileSystem.keys()) {
        if (key.startsWith(normalizedDir)) {
          const rest = key.slice(normalizedDir.length);
          const firstPart = rest.split("/")[0];
          if (firstPart) entries.add(firstPart);
        }
      }

      return [...entries];
    }

    case "fs_remove":
      mockFileSystem.delete(args?.path as string);
      return;

    case "fs_get_home_dir":
      return MOCK_HOME_DIR;

    case "fs_get_repo_dir":
      return `${MOCK_MORT_DIR}/repositories/${args?.repoName}`;

    case "fs_get_repo_source_path":
      return `/Users/test/code/${args?.repoName}`;

    // Git commands
    case "git_get_default_branch":
      return mockGitState.defaultBranch;

    case "git_get_branch_commit": {
      const hash = mockGitState.branches.get(args?.branch as string);
      if (!hash) throw new Error(`Branch not found: ${args?.branch}`);
      return hash;
    }

    case "git_branch_exists":
      return mockGitState.branches.has(args?.branch as string);

    case "git_create_branch": {
      const { branchName } = args as { branchName: string };
      if (mockGitState.branches.has(branchName)) {
        throw new Error(`Branch already exists: ${branchName}`);
      }
      // Generate a fake commit hash
      mockGitState.branches.set(branchName, `mock-commit-${Date.now()}`);
      return;
    }

    case "git_delete_branch":
      mockGitState.branches.delete(args?.branch as string);
      return;

    case "git_list_mort_branches":
      return [...mockGitState.branches.keys()].filter((b) => b.startsWith("mort/"));

    case "git_list_worktrees":
      return mockGitState.worktrees;

    case "git_create_worktree": {
      const { worktreePath, branch } = args as { worktreePath: string; branch: string };
      mockGitState.worktrees.push({ path: worktreePath, branch, isBare: false });
      return;
    }

    case "git_remove_worktree": {
      const { worktreePath } = args as { worktreePath: string };
      mockGitState.worktrees = mockGitState.worktrees.filter((w) => w.path !== worktreePath);
      return;
    }

    case "git_checkout_branch":
    case "git_checkout_commit":
      // No-op in tests
      return;

    // Process commands
    case "get_runner_path":
      return "/mock/path/to/runner.js";

    case "spawn_agent_process": {
      const { threadId } = args as { threadId: string };
      mockThreadState.runningProcesses.add(threadId);
      return;
    }

    case "terminate_agent_process": {
      const { threadId } = args as { threadId: string };
      mockThreadState.runningProcesses.delete(threadId);
      return;
    }

    case "is_process_running":
      return mockThreadState.runningProcesses.has(args?.threadId as string);

    // Thread commands
    case "get_thread_status": {
      const thread = mockThreadState.threads.get(args?.threadId as string);
      return thread?.status ?? null;
    }

    case "get_thread": {
      return mockThreadState.threads.get(args?.threadId as string) ?? null;
    }

    // Lock commands
    case "lock_acquire_repo":
      return `mock-lock-${Date.now()}`;

    case "lock_release_repo":
      return;

    // Agent commands
    case "get_agent_types":
      return ["research", "execution", "review", "merge"];

    // Logging
    case "web_log":
      capturedLogs.push({
        level: args?.level as string,
        message: args?.message as string,
        timestamp: Date.now(),
      });
      return;

    default:
      throw new Error(`Unmocked Tauri command: ${cmd}`);
  }
});

// ============================================================================
// Mock Events
// ============================================================================

type EventCallback = (event: { payload: unknown }) => void;

/** Registered event listeners */
export const mockEventListeners = new Map<string, Set<EventCallback>>();

/**
 * Mock implementation of Tauri's emit function.
 * Notifies all registered listeners.
 */
export const mockEmit = vi.fn(async (eventName: string, payload?: unknown) => {
  const listeners = mockEventListeners.get(eventName);
  if (listeners) {
    for (const callback of listeners) {
      callback({ payload });
    }
  }
});

/**
 * Mock implementation of Tauri's listen function.
 * Returns an unlisten function.
 */
export const mockListen = vi.fn(
  async (eventName: string, callback: EventCallback): Promise<() => void> => {
    if (!mockEventListeners.has(eventName)) {
      mockEventListeners.set(eventName, new Set());
    }
    mockEventListeners.get(eventName)!.add(callback);

    // Return unlisten function
    return () => {
      mockEventListeners.get(eventName)?.delete(callback);
    };
  }
);

// ============================================================================
// Reset Functions
// ============================================================================

/**
 * Reset all mock state between tests.
 */
export function resetAllMocks() {
  mockFileSystem.clear();
  mockGitState.branches.clear();
  mockGitState.branches.set("main", "initial-commit-hash");
  mockGitState.defaultBranch = "main";
  mockGitState.worktrees = [];
  mockThreadState.threads.clear();
  mockThreadState.runningProcesses.clear();
  mockEventListeners.clear();
  capturedLogs.length = 0;
  vi.clearAllMocks();
}
