// @vitest-environment node
/**
 * Pull Request Service Tests
 *
 * Tests for pullRequestService including:
 * - Hydration from disk
 * - Create with deduplication
 * - Update with read-modify-write
 * - Archive and delete operations
 * - Auto-address enable/disable
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

vi.mock("../events", () => ({
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

vi.mock("@/lib/gh-cli", () => ({
  GhCli: vi.fn(),
}));

vi.mock("@/stores/repo-worktree-lookup-store", () => ({
  useRepoWorktreeLookupStore: {
    getState: () => ({
      getWorktreePath: vi.fn().mockReturnValue("/path/to/worktree"),
    }),
  },
}));

function createInput(
  overrides: Partial<CreatePullRequestInput> = {},
): CreatePullRequestInput {
  return {
    prNumber: 42,
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
    repoSlug: "owner/repo",
    headBranch: "feature/test",
    baseBranch: "main",
    ...overrides,
  };
}

function createPrMetadata(
  overrides: Partial<PullRequestMetadata> = {},
): PullRequestMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    prNumber: 42,
    repoId: crypto.randomUUID(),
    worktreeId: crypto.randomUUID(),
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

describe("pullRequestService", () => {
  // Import service lazily to ensure mocks are set up first
  let pullRequestService: typeof import("../service").pullRequestService;

  beforeEach(async () => {
    // Reset store
    usePullRequestStore.setState({
      pullRequests: {},
      _prsArray: [],
      prDetails: {},
      prDetailsLoading: {},
      _hydrated: false,
    });

    // Reset mocks
    vi.clearAllMocks();
    mockAppData.glob.mockResolvedValue([]);
    mockAppData.readJson.mockResolvedValue(null);
    mockAppData.writeJson.mockResolvedValue(undefined);
    mockAppData.ensureDir.mockResolvedValue(undefined);
    mockAppData.removeDir.mockResolvedValue(undefined);

    // Re-import to get fresh service
    const mod = await import("../service");
    pullRequestService = mod.pullRequestService;
  });

  describe("hydrate", () => {
    it("loads PR metadata from disk into store", async () => {
      const prId = crypto.randomUUID();
      const pr = createPrMetadata({ id: prId });
      mockAppData.glob.mockResolvedValue([`pull-requests/${prId}/metadata.json`]);
      mockAppData.readJson.mockResolvedValue(pr);

      await pullRequestService.hydrate();

      expect(usePullRequestStore.getState().pullRequests[prId]).toBeDefined();
      expect(usePullRequestStore.getState()._hydrated).toBe(true);
    });

    it("skips invalid metadata files", async () => {
      mockAppData.glob.mockResolvedValue(["pull-requests/bad/metadata.json"]);
      mockAppData.readJson.mockResolvedValue({ invalid: "data" });

      await pullRequestService.hydrate();

      expect(Object.keys(usePullRequestStore.getState().pullRequests)).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates a new PR entity and writes to disk", async () => {
      const input = createInput();

      const result = await pullRequestService.create(input);

      expect(result.prNumber).toBe(42);
      expect(result.repoId).toBe(input.repoId);
      expect(result.worktreeId).toBe(input.worktreeId);
      expect(result.autoAddressEnabled).toBe(false);
      expect(result.isViewed).toBe(true);
      expect(mockAppData.ensureDir).toHaveBeenCalled();
      expect(mockAppData.writeJson).toHaveBeenCalled();
    });

    it("deduplicates by repoId + prNumber", async () => {
      const input = createInput({ prNumber: 99 });

      const first = await pullRequestService.create(input);
      const second = await pullRequestService.create(input);

      expect(first.id).toBe(second.id);
      // writeJson should only be called once (first create)
      expect(mockAppData.writeJson).toHaveBeenCalledTimes(1);
    });

    it("sets isViewed=false for webhook-detected PRs", async () => {
      const input = createInput();

      const result = await pullRequestService.create(input, { isViewed: false });

      expect(result.isViewed).toBe(false);
    });
  });

  describe("get / getByRepoAndNumber / getByWorktree", () => {
    it("get returns PR from store", async () => {
      const input = createInput();
      const pr = await pullRequestService.create(input);

      expect(pullRequestService.get(pr.id)).toEqual(pr);
    });

    it("getByRepoAndNumber finds matching PR", async () => {
      const input = createInput({ prNumber: 77 });
      const pr = await pullRequestService.create(input);

      const found = pullRequestService.getByRepoAndNumber(input.repoId, 77);
      expect(found?.id).toBe(pr.id);
    });

    it("getByWorktree returns matching PRs", async () => {
      const worktreeId = crypto.randomUUID();
      const input1 = createInput({ worktreeId, prNumber: 1, repoId: crypto.randomUUID() });
      const input2 = createInput({ worktreeId, prNumber: 2, repoId: crypto.randomUUID() });
      await pullRequestService.create(input1);
      await pullRequestService.create(input2);

      const result = pullRequestService.getByWorktree(worktreeId);
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates PR metadata and writes to disk", async () => {
      const input = createInput();
      const pr = await pullRequestService.create(input);

      // Mock readJson to return current disk state for read-modify-write
      mockAppData.readJson.mockResolvedValue(pr);

      const updated = await pullRequestService.update(pr.id, {
        isViewed: false,
      });

      expect(updated.isViewed).toBe(false);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(pr.updatedAt);
    });

    it("throws for non-existent PR", async () => {
      await expect(
        pullRequestService.update("nonexistent", { isViewed: true }),
      ).rejects.toThrow("PR not found: nonexistent");
    });
  });

  describe("disableAutoAddress", () => {
    it("sets autoAddressEnabled=false and clears channelId", async () => {
      const input = createInput();
      const pr = await pullRequestService.create(input);

      // First enable auto-address
      mockAppData.readJson.mockResolvedValue({
        ...pr,
        autoAddressEnabled: true,
        gatewayChannelId: crypto.randomUUID(),
      });
      await pullRequestService.enableAutoAddress(pr.id, crypto.randomUUID());

      // Then disable
      mockAppData.readJson.mockResolvedValue(
        usePullRequestStore.getState().pullRequests[pr.id],
      );
      await pullRequestService.disableAutoAddress(pr.id);

      const updated = usePullRequestStore.getState().pullRequests[pr.id];
      expect(updated.autoAddressEnabled).toBe(false);
      expect(updated.gatewayChannelId).toBeNull();
    });
  });

  describe("enableAutoAddress", () => {
    it("sets autoAddressEnabled=true and stores channelId", async () => {
      const input = createInput();
      const pr = await pullRequestService.create(input);
      const channelId = crypto.randomUUID();

      mockAppData.readJson.mockResolvedValue(pr);
      await pullRequestService.enableAutoAddress(pr.id, channelId);

      const updated = usePullRequestStore.getState().pullRequests[pr.id];
      expect(updated.autoAddressEnabled).toBe(true);
      expect(updated.gatewayChannelId).toBe(channelId);
    });
  });

  describe("refreshById", () => {
    it("updates store from disk", async () => {
      const prId = crypto.randomUUID();
      const pr = createPrMetadata({ id: prId, isViewed: false });
      usePullRequestStore.getState()._applyCreate(pr);

      const diskPr = { ...pr, isViewed: true };
      mockAppData.readJson.mockResolvedValue(diskPr);

      await pullRequestService.refreshById(prId);

      expect(
        usePullRequestStore.getState().pullRequests[prId].isViewed,
      ).toBe(true);
    });

    it("removes from store if not found on disk", async () => {
      const prId = crypto.randomUUID();
      const pr = createPrMetadata({ id: prId });
      usePullRequestStore.getState()._applyCreate(pr);
      mockAppData.readJson.mockResolvedValue(null);

      await pullRequestService.refreshById(prId);

      expect(
        usePullRequestStore.getState().pullRequests[prId],
      ).toBeUndefined();
    });
  });

  describe("archive", () => {
    it("moves PR to archive and removes from store", async () => {
      const input = createInput();
      const pr = await pullRequestService.create(input);

      mockAppData.readJson.mockResolvedValue(pr);

      await pullRequestService.archive(pr.id);

      expect(usePullRequestStore.getState().pullRequests[pr.id]).toBeUndefined();
      expect(mockAppData.ensureDir).toHaveBeenCalled();
      expect(mockAppData.writeJson).toHaveBeenCalled();
      expect(mockAppData.removeDir).toHaveBeenCalled();
    });

    it("does nothing for non-existent PR", async () => {
      await pullRequestService.archive("nonexistent");
      // Should not throw
    });
  });

  describe("archiveByWorktree", () => {
    it("archives all PRs for a worktree", async () => {
      const worktreeId = crypto.randomUUID();
      const input1 = createInput({ worktreeId, prNumber: 1, repoId: crypto.randomUUID() });
      const input2 = createInput({ worktreeId, prNumber: 2, repoId: crypto.randomUUID() });
      const pr1 = await pullRequestService.create(input1);
      const pr2 = await pullRequestService.create(input2);

      // Mock disk reads for archive
      mockAppData.readJson
        .mockResolvedValueOnce(pr1) // first archive reads metadata
        .mockResolvedValueOnce(pr2); // second archive reads metadata

      await pullRequestService.archiveByWorktree(worktreeId);

      expect(usePullRequestStore.getState().pullRequests[pr1.id]).toBeUndefined();
      expect(usePullRequestStore.getState().pullRequests[pr2.id]).toBeUndefined();
    });
  });
});
