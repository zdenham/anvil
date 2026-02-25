// @vitest-environment node
/**
 * PR Lifecycle Handler Tests
 *
 * Tests for handlePullRequestEvent including:
 * - PR entity creation from pull_request.opened webhook
 * - Idempotent creation (skip if PR already exists)
 * - Auto-address disable on pull_request.closed
 * - Display data refresh on close
 * - Skip when no local worktree matches the branch
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePullRequestStore } from "../store";
import type { PullRequestMetadata, CreatePullRequestInput } from "../types";

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

vi.mock("../../events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

const mockAppData = {
  glob: vi.fn().mockResolvedValue([]),
  readJson: vi.fn().mockResolvedValue(null),
  writeJson: vi.fn().mockResolvedValue(undefined),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  removeDir: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
};

vi.mock("@/lib/app-data-store", () => ({
  appData: mockAppData,
}));

const mockGetPrDetails = vi.fn().mockResolvedValue({
  title: "Test PR",
  state: "closed",
  body: "",
  author: "user",
  reviews: [],
  checks: [],
  reviewComments: [],
  labels: [],
  mergeableState: "clean",
  headBranch: "feature/test",
  baseBranch: "main",
  number: 42,
});

vi.mock("@/lib/gh-cli", () => ({
  GhCli: function GhCliMock() {
    return { getPrDetails: (...args: unknown[]) => mockGetPrDetails(...args) };
  },
}));

const mockGetWorktreePath = vi.fn().mockReturnValue("/path/to/worktree");

vi.mock("@/stores/repo-worktree-lookup-store", () => ({
  useRepoWorktreeLookupStore: {
    getState: () => ({
      getWorktreePath: (...args: unknown[]) => mockGetWorktreePath(...args),
    }),
  },
}));

const mockFindWorktreeByBranch = vi.fn();
vi.mock("../utils", () => ({
  findWorktreeByBranch: (...args: unknown[]) => mockFindWorktreeByBranch(...args),
}));

function createPrMetadata(
  overrides: Partial<PullRequestMetadata> = {},
): PullRequestMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    prNumber: 42,
    repoId: "repo-1",
    worktreeId: "wt-1",
    repoSlug: "owner/repo",
    headBranch: "feature/test",
    baseBranch: "main",
    autoAddressEnabled: false,
    gatewayChannelId: null,
    isViewed: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("handlePullRequestEvent", () => {
  let handlePullRequestEvent: typeof import("../pr-lifecycle-handler").handlePullRequestEvent;

  beforeEach(async () => {
    usePullRequestStore.setState({
      pullRequests: {},
      _prsArray: [],
      prDetails: {},
      prDetailsLoading: {},
      _hydrated: false,
    });
    vi.clearAllMocks();
    mockAppData.readJson.mockResolvedValue(null);
    mockAppData.writeJson.mockResolvedValue(undefined);
    mockAppData.ensureDir.mockResolvedValue(undefined);

    const mod = await import("../pr-lifecycle-handler");
    handlePullRequestEvent = mod.handlePullRequestEvent;
  });

  it("ignores events without a PR number", async () => {
    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "opened",
      pull_request: {},
    });

    // No PR created
    expect(Object.keys(usePullRequestStore.getState().pullRequests)).toHaveLength(0);
  });

  it("creates PR entity on pull_request.opened when worktree matches", async () => {
    mockFindWorktreeByBranch.mockResolvedValue({
      id: "wt-1",
      path: "/path/to/worktree",
      name: "main",
    });

    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "opened",
      pull_request: {
        number: 42,
        head: { ref: "feature/test" },
        base: { ref: "main" },
      },
      repository: { full_name: "owner/repo" },
    });

    const prs = usePullRequestStore.getState()._prsArray;
    expect(prs).toHaveLength(1);
    expect(prs[0].prNumber).toBe(42);
    expect(prs[0].isViewed).toBe(false); // Webhook-detected PRs start unviewed
    expect(prs[0].headBranch).toBe("feature/test");
    expect(prs[0].baseBranch).toBe("main");
  });

  it("skips PR creation when no local worktree matches branch", async () => {
    mockFindWorktreeByBranch.mockResolvedValue(null);

    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "opened",
      pull_request: {
        number: 42,
        head: { ref: "some-remote-branch" },
        base: { ref: "main" },
      },
      repository: { full_name: "owner/repo" },
    });

    expect(Object.keys(usePullRequestStore.getState().pullRequests)).toHaveLength(0);
  });

  it("is idempotent: skips if PR entity already exists", async () => {
    const existing = createPrMetadata({ prNumber: 42, repoId: "repo-1" });
    usePullRequestStore.getState()._applyCreate(existing);

    mockFindWorktreeByBranch.mockResolvedValue({
      id: "wt-1",
      path: "/path/to/worktree",
      name: "main",
    });

    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "opened",
      pull_request: {
        number: 42,
        head: { ref: "feature/test" },
        base: { ref: "main" },
      },
      repository: { full_name: "owner/repo" },
    });

    // Still only 1 PR (the existing one)
    expect(usePullRequestStore.getState()._prsArray).toHaveLength(1);
  });

  it("auto-disables auto-address on pull_request.closed", async () => {
    const pr = createPrMetadata({
      prNumber: 42,
      repoId: "repo-1",
      autoAddressEnabled: true,
      gatewayChannelId: "ch-1",
    });
    usePullRequestStore.getState()._applyCreate(pr);

    // Mock disk read for update read-modify-write
    mockAppData.readJson.mockResolvedValue(pr);

    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "closed",
      pull_request: { number: 42 },
    });

    const updated = usePullRequestStore.getState().pullRequests[pr.id];
    expect(updated.autoAddressEnabled).toBe(false);
    expect(updated.gatewayChannelId).toBeNull();
  });

  it("refreshes display data on pull_request.closed", async () => {
    const pr = createPrMetadata({
      prNumber: 42,
      repoId: "repo-1",
      autoAddressEnabled: false,
    });
    usePullRequestStore.getState()._applyCreate(pr);

    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "closed",
      pull_request: { number: 42 },
    });

    expect(mockGetPrDetails).toHaveBeenCalledWith(42);
  });

  it("does nothing for unrecognized actions", async () => {
    await handlePullRequestEvent("repo-1", "ch-1", {
      action: "labeled",
      pull_request: { number: 42 },
    });

    expect(Object.keys(usePullRequestStore.getState().pullRequests)).toHaveLength(0);
    expect(mockGetPrDetails).not.toHaveBeenCalled();
  });
});
