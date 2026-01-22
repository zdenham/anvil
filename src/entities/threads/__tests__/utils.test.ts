/**
 * Thread Utils Tests
 *
 * Tests for deriveWorkingDirectory utility.
 */

import { describe, it, expect } from "vitest";
import { deriveWorkingDirectory } from "../utils";
import type { ThreadMetadata } from "../types";
import type { RepositorySettings } from "@core/types/repositories.js";

// Helper to create valid ThreadMetadata
function createThreadMetadata(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    status: "idle",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [
      {
        index: 0,
        prompt: "Test prompt",
        startedAt: now,
        completedAt: null,
      },
    ],
    ...overrides,
  };
}

// Helper to create valid RepositorySettings
function createRepositorySettings(overrides: Partial<RepositorySettings> = {}): RepositorySettings {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    name: "test-repo",
    originalUrl: null,
    sourcePath: "/path/to/main/repo",
    useWorktrees: true,
    defaultBranch: "main",
    createdAt: now,
    worktrees: [],
    threadBranches: {},
    lastUpdated: now,
    plansDirectory: "plans/",
    completedDirectory: "plans/completed/",
    ...overrides,
  };
}

describe("deriveWorkingDirectory", () => {
  it("returns worktree path when thread.worktreeId matches a worktree", () => {
    const worktreeId = crypto.randomUUID();
    const worktreePath = "/path/to/worktree";

    const thread = createThreadMetadata({ worktreeId });
    const repoSettings = createRepositorySettings({
      worktrees: [
        {
          id: worktreeId,
          path: worktreePath,
          name: "feature-branch",
          lastAccessedAt: Date.now(),
          currentBranch: "feature-branch",
        },
      ],
    });

    const result = deriveWorkingDirectory(thread, repoSettings);

    expect(result).toBe(worktreePath);
  });

  it("returns main repo sourcePath as fallback when worktree not found", () => {
    const nonExistentWorktreeId = crypto.randomUUID();
    const existingWorktreeId = crypto.randomUUID();
    const mainRepoPath = "/path/to/main/repo";

    const thread = createThreadMetadata({ worktreeId: nonExistentWorktreeId });
    const repoSettings = createRepositorySettings({
      sourcePath: mainRepoPath,
      worktrees: [
        {
          id: existingWorktreeId,
          path: "/path/to/other/worktree",
          name: "other-branch",
          lastAccessedAt: Date.now(),
          currentBranch: "other-branch",
        },
      ],
    });

    const result = deriveWorkingDirectory(thread, repoSettings);

    expect(result).toBe(mainRepoPath);
  });

  it("handles empty worktrees array by returning sourcePath", () => {
    const worktreeId = crypto.randomUUID();
    const mainRepoPath = "/path/to/main/repo";

    const thread = createThreadMetadata({ worktreeId });
    const repoSettings = createRepositorySettings({
      sourcePath: mainRepoPath,
      worktrees: [],
    });

    const result = deriveWorkingDirectory(thread, repoSettings);

    expect(result).toBe(mainRepoPath);
  });

  it("finds correct worktree when multiple worktrees exist", () => {
    const worktreeId1 = crypto.randomUUID();
    const worktreeId2 = crypto.randomUUID();
    const worktreeId3 = crypto.randomUUID();
    const targetPath = "/path/to/worktree2";

    const thread = createThreadMetadata({ worktreeId: worktreeId2 });
    const repoSettings = createRepositorySettings({
      worktrees: [
        {
          id: worktreeId1,
          path: "/path/to/worktree1",
          name: "branch1",
          lastAccessedAt: Date.now(),
          currentBranch: "branch1",
        },
        {
          id: worktreeId2,
          path: targetPath,
          name: "branch2",
          lastAccessedAt: Date.now(),
          currentBranch: "branch2",
        },
        {
          id: worktreeId3,
          path: "/path/to/worktree3",
          name: "branch3",
          lastAccessedAt: Date.now(),
          currentBranch: "branch3",
        },
      ],
    });

    const result = deriveWorkingDirectory(thread, repoSettings);

    expect(result).toBe(targetPath);
  });
});
