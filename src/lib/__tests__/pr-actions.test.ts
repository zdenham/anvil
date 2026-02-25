// @vitest-environment node
/**
 * PR Actions Tests
 *
 * Tests for handleCreatePr:
 * - Opens existing PR when one exists for the current branch
 * - Spawns create-pr agent thread when no PR exists
 * - Returns early when gh CLI is unavailable
 * - Creates PR entity for existing PR if not already in store
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockIsAvailable = vi.fn().mockResolvedValue(true);
const mockGetCurrentBranchPr = vi.fn().mockResolvedValue(null);
const mockGetRepoSlug = vi.fn().mockResolvedValue("owner/repo");

vi.mock("@/lib/gh-cli", () => ({
  GhCli: function GhCliMock() {
    return {
      isAvailable: (...args: unknown[]) => mockIsAvailable(...args),
      getCurrentBranchPr: (...args: unknown[]) => mockGetCurrentBranchPr(...args),
      getRepoSlug: (...args: unknown[]) => mockGetRepoSlug(...args),
    };
  },
}));

const mockGetByRepoAndNumber = vi.fn().mockReturnValue(undefined);
const mockCreatePr = vi.fn().mockImplementation(async (input: { prNumber: number }) => ({
  id: "new-pr-id",
  prNumber: input.prNumber,
  repoId: "repo-1",
  worktreeId: "wt-1",
  repoSlug: "owner/repo",
  headBranch: "feature/test",
  baseBranch: "main",
  autoAddressEnabled: false,
  gatewayChannelId: null,
  isViewed: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}));

vi.mock("@/entities/pull-requests", () => ({
  pullRequestService: {
    getByRepoAndNumber: (...args: unknown[]) => mockGetByRepoAndNumber(...args),
    create: (...args: unknown[]) => mockCreatePr(...args),
  },
}));

const mockCreateThread = vi.fn().mockResolvedValue({
  threadId: "thread-1",
  taskId: "task-1",
});

vi.mock("@/lib/thread-creation-service", () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
}));

const mockSetActivePaneView = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/content-panes", () => ({
  contentPanesService: {
    setActivePaneView: (...args: unknown[]) => mockSetActivePaneView(...args),
  },
}));

// Mock Tauri Command for getBranchInfo
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({
        stdout: "feature/test\n",
        stderr: "",
        code: 0,
      }),
    }),
  },
}));

describe("handleCreatePr", () => {
  let handleCreatePr: typeof import("../pr-actions").handleCreatePr;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    mockGetCurrentBranchPr.mockResolvedValue(null);
    mockGetByRepoAndNumber.mockReturnValue(undefined);

    const mod = await import("../pr-actions");
    handleCreatePr = mod.handleCreatePr;
  });

  it("returns early when gh CLI is not available", async () => {
    mockIsAvailable.mockResolvedValue(false);

    await handleCreatePr("repo-1", "wt-1", "/path/to/worktree");

    expect(mockGetCurrentBranchPr).not.toHaveBeenCalled();
    expect(mockCreateThread).not.toHaveBeenCalled();
    expect(mockSetActivePaneView).not.toHaveBeenCalled();
  });

  it("opens existing PR when one is found for the branch", async () => {
    mockGetCurrentBranchPr.mockResolvedValue(42);
    mockGetByRepoAndNumber.mockReturnValue({
      id: "existing-pr-id",
      prNumber: 42,
    });

    await handleCreatePr("repo-1", "wt-1", "/path/to/worktree");

    expect(mockSetActivePaneView).toHaveBeenCalledWith({
      type: "pull-request",
      prId: "existing-pr-id",
    });
    expect(mockCreateThread).not.toHaveBeenCalled();
  });

  it("creates PR entity for existing PR not yet in store", async () => {
    mockGetCurrentBranchPr.mockResolvedValue(42);
    mockGetByRepoAndNumber.mockReturnValue(undefined);

    await handleCreatePr("repo-1", "wt-1", "/path/to/worktree");

    expect(mockCreatePr).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 42,
        repoId: "repo-1",
        worktreeId: "wt-1",
        repoSlug: "owner/repo",
      }),
    );
    expect(mockSetActivePaneView).toHaveBeenCalledWith({
      type: "pull-request",
      prId: "new-pr-id",
    });
  });

  it("spawns create-pr agent when no PR exists", async () => {
    mockGetCurrentBranchPr.mockResolvedValue(null);

    await handleCreatePr("repo-1", "wt-1", "/path/to/worktree");

    expect(mockCreateThread).toHaveBeenCalledWith({
      prompt: "/mort:create-pr",
      repoId: "repo-1",
      worktreeId: "wt-1",
      worktreePath: "/path/to/worktree",
      permissionMode: "approve",
    });

    expect(mockSetActivePaneView).toHaveBeenCalledWith({
      type: "thread",
      threadId: "thread-1",
    });
  });
});
