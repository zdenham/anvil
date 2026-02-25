// @vitest-environment node
/**
 * Pull Request Store Tests
 *
 * Tests for usePullRequestStore including:
 * - Hydration
 * - Optimistic apply methods with rollback
 * - Selectors (getPrByRepoAndNumber, getPrsByWorktree, etc.)
 * - Display data cache management
 */

import { describe, it, expect, beforeEach } from "vitest";
import { usePullRequestStore } from "../store";
import type { PullRequestMetadata, PullRequestDetails } from "../types";

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

function createPrDetails(
  overrides: Partial<PullRequestDetails> = {},
): PullRequestDetails {
  return {
    title: "Test PR",
    body: "Test body",
    state: "OPEN",
    author: "testuser",
    url: "https://github.com/owner/repo/pull/42",
    isDraft: false,
    labels: [],
    reviewDecision: null,
    reviews: [],
    checks: [],
    reviewComments: [],
    ...overrides,
  };
}

describe("usePullRequestStore", () => {
  beforeEach(() => {
    usePullRequestStore.setState({
      pullRequests: {},
      _prsArray: [],
      prDetails: {},
      prDetailsLoading: {},
      _hydrated: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("populates pullRequests correctly", () => {
      const pr1 = createPrMetadata({ id: "pr1" });
      const pr2 = createPrMetadata({ id: "pr2" });

      usePullRequestStore.getState().hydrate({ pr1, pr2 });

      expect(usePullRequestStore.getState().pullRequests["pr1"]).toEqual(pr1);
      expect(usePullRequestStore.getState().pullRequests["pr2"]).toEqual(pr2);
      expect(usePullRequestStore.getState()._hydrated).toBe(true);
    });

    it("updates _prsArray cache", () => {
      const pr1 = createPrMetadata({ id: "pr1" });
      const pr2 = createPrMetadata({ id: "pr2" });

      usePullRequestStore.getState().hydrate({ pr1, pr2 });

      const arr = usePullRequestStore.getState()._prsArray;
      expect(arr).toHaveLength(2);
      expect(arr).toContainEqual(pr1);
      expect(arr).toContainEqual(pr2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyCreate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyCreate", () => {
    it("adds PR to store", () => {
      const pr = createPrMetadata({ id: "new-pr" });

      usePullRequestStore.getState()._applyCreate(pr);

      expect(usePullRequestStore.getState().pullRequests["new-pr"]).toEqual(pr);
    });

    it("returns rollback function that removes PR", () => {
      const pr = createPrMetadata({ id: "rollback-pr" });

      const rollback = usePullRequestStore.getState()._applyCreate(pr);
      expect(usePullRequestStore.getState().pullRequests["rollback-pr"]).toBeDefined();

      rollback();
      expect(usePullRequestStore.getState().pullRequests["rollback-pr"]).toBeUndefined();
    });

    it("updates _prsArray on create and rollback", () => {
      const pr = createPrMetadata({ id: "array-pr" });

      const rollback = usePullRequestStore.getState()._applyCreate(pr);
      expect(usePullRequestStore.getState()._prsArray).toHaveLength(1);

      rollback();
      expect(usePullRequestStore.getState()._prsArray).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyUpdate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyUpdate", () => {
    it("updates PR in store", () => {
      const pr = createPrMetadata({ id: "update-pr", isViewed: false });
      usePullRequestStore.getState()._applyCreate(pr);

      const updated = { ...pr, isViewed: true };
      usePullRequestStore.getState()._applyUpdate("update-pr", updated);

      expect(usePullRequestStore.getState().pullRequests["update-pr"].isViewed).toBe(true);
    });

    it("returns rollback function that restores previous state", () => {
      const pr = createPrMetadata({ id: "restore-pr", autoAddressEnabled: false });
      usePullRequestStore.getState()._applyCreate(pr);

      const updated = { ...pr, autoAddressEnabled: true };
      const rollback = usePullRequestStore.getState()._applyUpdate("restore-pr", updated);

      expect(usePullRequestStore.getState().pullRequests["restore-pr"].autoAddressEnabled).toBe(true);

      rollback();
      expect(usePullRequestStore.getState().pullRequests["restore-pr"].autoAddressEnabled).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyDelete Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyDelete", () => {
    it("removes PR from store", () => {
      const pr = createPrMetadata({ id: "delete-pr" });
      usePullRequestStore.getState()._applyCreate(pr);

      usePullRequestStore.getState()._applyDelete("delete-pr");

      expect(usePullRequestStore.getState().pullRequests["delete-pr"]).toBeUndefined();
    });

    it("returns rollback function that restores PR", () => {
      const pr = createPrMetadata({ id: "restore-delete-pr" });
      usePullRequestStore.getState()._applyCreate(pr);

      const rollback = usePullRequestStore.getState()._applyDelete("restore-delete-pr");
      expect(usePullRequestStore.getState().pullRequests["restore-delete-pr"]).toBeUndefined();

      rollback();
      expect(usePullRequestStore.getState().pullRequests["restore-delete-pr"]).toEqual(pr);
    });

    it("cleans up prDetails and prDetailsLoading on delete", () => {
      const pr = createPrMetadata({ id: "cleanup-pr" });
      usePullRequestStore.getState()._applyCreate(pr);
      usePullRequestStore.getState().setPrDetails("cleanup-pr", createPrDetails());
      usePullRequestStore.getState().setPrDetailsLoading("cleanup-pr", true);

      usePullRequestStore.getState()._applyDelete("cleanup-pr");

      expect(usePullRequestStore.getState().prDetails["cleanup-pr"]).toBeUndefined();
      expect(usePullRequestStore.getState().prDetailsLoading["cleanup-pr"]).toBeUndefined();
    });

    it("rollback restores prDetails and prDetailsLoading", () => {
      const pr = createPrMetadata({ id: "restore-details-pr" });
      const details = createPrDetails();
      usePullRequestStore.getState()._applyCreate(pr);
      usePullRequestStore.getState().setPrDetails("restore-details-pr", details);
      usePullRequestStore.getState().setPrDetailsLoading("restore-details-pr", true);

      const rollback = usePullRequestStore.getState()._applyDelete("restore-details-pr");
      rollback();

      expect(usePullRequestStore.getState().prDetails["restore-details-pr"]).toEqual(details);
      expect(usePullRequestStore.getState().prDetailsLoading["restore-details-pr"]).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Selector Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("selectors", () => {
    it("getPr returns PR by id", () => {
      const pr = createPrMetadata({ id: "get-pr" });
      usePullRequestStore.getState()._applyCreate(pr);

      expect(usePullRequestStore.getState().getPr("get-pr")).toEqual(pr);
    });

    it("getPr returns undefined for non-existent PR", () => {
      expect(usePullRequestStore.getState().getPr("nonexistent")).toBeUndefined();
    });

    it("getPrByRepoAndNumber finds matching PR", () => {
      const repoId = crypto.randomUUID();
      const pr = createPrMetadata({ id: "dedup-pr", repoId, prNumber: 99 });
      usePullRequestStore.getState()._applyCreate(pr);

      const found = usePullRequestStore.getState().getPrByRepoAndNumber(repoId, 99);
      expect(found).toEqual(pr);
    });

    it("getPrByRepoAndNumber returns undefined when no match", () => {
      const pr = createPrMetadata({ prNumber: 99 });
      usePullRequestStore.getState()._applyCreate(pr);

      expect(
        usePullRequestStore.getState().getPrByRepoAndNumber("other-repo", 99),
      ).toBeUndefined();
    });

    it("getPrsByWorktree returns matching PRs", () => {
      const worktreeId = crypto.randomUUID();
      const pr1 = createPrMetadata({ id: "wt-pr1", worktreeId });
      const pr2 = createPrMetadata({ id: "wt-pr2", worktreeId });
      const pr3 = createPrMetadata({ id: "other-pr" });
      usePullRequestStore.getState()._applyCreate(pr1);
      usePullRequestStore.getState()._applyCreate(pr2);
      usePullRequestStore.getState()._applyCreate(pr3);

      const result = usePullRequestStore.getState().getPrsByWorktree(worktreeId);
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toContain("wt-pr1");
      expect(result.map((p) => p.id)).toContain("wt-pr2");
    });

    it("getPrsByRepo returns matching PRs", () => {
      const repoId = crypto.randomUUID();
      const pr1 = createPrMetadata({ id: "repo-pr1", repoId });
      const pr2 = createPrMetadata({ id: "repo-pr2", repoId });
      const pr3 = createPrMetadata({ id: "other-repo-pr" });
      usePullRequestStore.getState()._applyCreate(pr1);
      usePullRequestStore.getState()._applyCreate(pr2);
      usePullRequestStore.getState()._applyCreate(pr3);

      const result = usePullRequestStore.getState().getPrsByRepo(repoId);
      expect(result).toHaveLength(2);
    });

    it("getPrDetails returns cached details", () => {
      const details = createPrDetails({ title: "Cached PR" });
      usePullRequestStore.getState().setPrDetails("pr-with-details", details);

      expect(usePullRequestStore.getState().getPrDetails("pr-with-details")).toEqual(details);
    });

    it("getPrDetails returns undefined when no cache", () => {
      expect(usePullRequestStore.getState().getPrDetails("no-cache")).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Display Data Management Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("display data management", () => {
    it("setPrDetails stores details keyed by PR id", () => {
      const details = createPrDetails({ title: "Test" });
      usePullRequestStore.getState().setPrDetails("pr1", details);

      expect(usePullRequestStore.getState().prDetails["pr1"]).toEqual(details);
    });

    it("setPrDetailsLoading stores loading state", () => {
      usePullRequestStore.getState().setPrDetailsLoading("pr1", true);
      expect(usePullRequestStore.getState().prDetailsLoading["pr1"]).toBe(true);

      usePullRequestStore.getState().setPrDetailsLoading("pr1", false);
      expect(usePullRequestStore.getState().prDetailsLoading["pr1"]).toBe(false);
    });

    it("clearPrDetails removes cached details", () => {
      const details = createPrDetails();
      usePullRequestStore.getState().setPrDetails("pr1", details);

      usePullRequestStore.getState().clearPrDetails("pr1");

      expect(usePullRequestStore.getState().prDetails["pr1"]).toBeUndefined();
    });
  });
});
