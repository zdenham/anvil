/**
 * use-tree-data Tests
 *
 * Tests for the tree data building logic, specifically around
 * nested plan ordering with threads.
 *
 * THESE TESTS INTENTIONALLY FAIL to verify the bug described in:
 * plans/nested-plan-ordering.md
 *
 * The bug: When sorting top-level items by createdAt, child plans (depth > 0)
 * get separated from their parent plans because the sort comparator returns 0
 * for items at different depths, leaving children stranded at the end.
 *
 * Once the fix is implemented, these tests should PASS.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTreeFromEntities } from "../use-tree-data";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";

// Mock the relationService - plans don't have running thread relations for this test
vi.mock("@/entities/relations/service", () => ({
  relationService: {
    getByPlan: vi.fn().mockReturnValue([]),
  },
}));

// Constants for test data
const REPO_ID = "repo-1";
const WORKTREE_ID = "worktree-1";
const SECTION_ID = `${REPO_ID}:${WORKTREE_ID}`;

// Helper to create thread metadata
function createThread(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: REPO_ID,
    worktreeId: WORKTREE_ID,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [{ index: 0, prompt: "Test", startedAt: now, completedAt: null }],
    ...overrides,
  };
}

// Helper to create plan metadata
function createPlan(overrides: Partial<PlanMetadata> = {}): PlanMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: REPO_ID,
    worktreeId: WORKTREE_ID,
    relativePath: "plan.md",
    isRead: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Test helpers for buildTreeFromEntities
const allRepos = [
  {
    repoId: REPO_ID,
    repoName: "Test Repo",
    worktrees: [{ worktreeId: WORKTREE_ID, name: "main", path: "/test/repo" }],
  },
];
const getRepoName = () => "Test Repo";
const getWorktreeName = () => "main";
const getWorktreePath = () => "/test/repo";

describe("buildTreeFromEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("nested plan ordering with threads", () => {
    /**
     * This test verifies the bug described in plans/nested-plan-ordering.md
     *
     * The bug occurs when a PARENT PLAN is NEWER than threads.
     *
     * Scenario:
     * - thread-1 created at T+1000 (oldest)
     * - thread-2 created at T+2000 (middle)
     * - parent plan created at T+3000 (newest)
     * - child plans created after parent
     *
     * INSERTION ORDER in buildSectionItems:
     * 1. thread-1 (depth 0)
     * 2. thread-2 (depth 0)
     * 3. parent plan (depth 0)
     * 4. child login (depth 1)
     * 5. child oauth (depth 1)
     *
     * AFTER SORT (depth 0 items sorted by createdAt descending):
     * The sort compares items at the SAME depth only. When a.depth !== b.depth,
     * it returns 0, which means "keep relative order" - but this is BROKEN
     * because sort is not guaranteed to be stable and the children get
     * separated from their parent.
     *
     * EXPECTED (correct):
     * 1. parent plan (newest depth-0, at T+3000)
     * 2. child login (depth 1, immediately after parent)
     * 3. child oauth (depth 1, immediately after sibling)
     * 4. thread-2 (middle depth-0, at T+2000)
     * 5. thread-1 (oldest depth-0, at T+1000)
     *
     * ACTUAL (buggy - children separated from parent):
     * 1. parent plan (depth 0)
     * 2. thread-2 (depth 0) <- WRONG! Thread between parent and children
     * 3. thread-1 (depth 0)
     * 4. child login (depth 1) <- Children are stranded at the end
     * 5. child oauth (depth 1)
     */
    it("should keep child plans immediately after parent when parent is NEWER than threads", () => {
      // Timestamps: threads are OLDER than the parent plan
      const BASE_TIME = 1700000000000;
      const THREAD_1_CREATED = BASE_TIME + 1000; // Oldest
      const THREAD_2_CREATED = BASE_TIME + 2000; // Middle
      const PARENT_PLAN_CREATED = BASE_TIME + 3000; // Newest - parent is most recent!

      const parentPlanId = crypto.randomUUID();
      const childPlan1Id = crypto.randomUUID();
      const childPlan2Id = crypto.randomUUID();

      // Parent plan is NEWEST (will be sorted to top among depth-0 items)
      const parentPlan = createPlan({
        id: parentPlanId,
        relativePath: "auth/readme.md",
        createdAt: PARENT_PLAN_CREATED,
        updatedAt: PARENT_PLAN_CREATED,
      });

      const childPlan1 = createPlan({
        id: childPlan1Id,
        relativePath: "auth/login.md",
        parentId: parentPlanId,
        createdAt: PARENT_PLAN_CREATED + 100,
        updatedAt: PARENT_PLAN_CREATED + 100,
      });

      const childPlan2 = createPlan({
        id: childPlan2Id,
        relativePath: "auth/oauth.md",
        parentId: parentPlanId,
        createdAt: PARENT_PLAN_CREATED + 200,
        updatedAt: PARENT_PLAN_CREATED + 200,
      });

      // Threads are OLDER than the parent plan
      const thread1 = createThread({
        id: "thread-1",
        name: "Thread 1",
        createdAt: THREAD_1_CREATED,
        updatedAt: THREAD_1_CREATED,
      });

      const thread2 = createThread({
        id: "thread-2",
        name: "Thread 2",
        createdAt: THREAD_2_CREATED,
        updatedAt: THREAD_2_CREATED,
      });

      const threads = [thread1, thread2];
      const plans = [parentPlan, childPlan1, childPlan2];

      // Build tree with all folders expanded
      const expandedSections: Record<string, boolean> = {
        [SECTION_ID]: true,
        [`plan:${parentPlanId}`]: true,
      };
      const runningThreadIds = new Set<string>();

      const sections = buildTreeFromEntities(
        threads,
        plans,
        expandedSections,
        runningThreadIds,
        allRepos,
        getRepoName,
        getWorktreeName,
        getWorktreePath
      );

      expect(sections).toHaveLength(1);
      const items = sections[0].items;

      // Log the actual order for debugging
      console.log(
        "Actual item order:",
        items.map((item) => `${item.type}:${item.title} (depth=${item.depth}, created=${item.createdAt})`)
      );

      // Find indices
      const parentIndex = items.findIndex((item) => item.id === parentPlanId);
      const child1Index = items.findIndex((item) => item.id === childPlan1Id);
      const child2Index = items.findIndex((item) => item.id === childPlan2Id);
      const thread1Index = items.findIndex((item) => item.id === "thread-1");
      const thread2Index = items.findIndex((item) => item.id === "thread-2");

      // Parent plan should be first (newest top-level item)
      expect(parentIndex).toBe(0);

      // CRITICAL: Children should IMMEDIATELY follow their parent
      // If the bug exists, threads will appear between parent and children
      expect(child1Index).toBe(parentIndex + 1);
      expect(child2Index).toBe(parentIndex + 2);

      // Threads should come after the parent and its children
      expect(thread2Index).toBe(3); // Second newest depth-0
      expect(thread1Index).toBe(4); // Oldest depth-0

      // Verify no threads between parent and children
      const itemsBetweenParentAndLastChild = items.slice(parentIndex + 1, child2Index);
      const threadsInBetween = itemsBetweenParentAndLastChild.filter(
        (item) => item.type === "thread"
      );
      expect(threadsInBetween).toHaveLength(0);
    });

    /**
     * Test for plan that comes in the MIDDLE of the sort order
     * This exercises a different code path where the parent plan is neither
     * first nor last among top-level items.
     */
    it("should keep children with parent when parent is in MIDDLE of createdAt order", () => {
      const BASE_TIME = 1700000000000;
      const THREAD_1_CREATED = BASE_TIME + 1000; // Oldest
      const PARENT_PLAN_CREATED = BASE_TIME + 2000; // Middle - plan in between threads
      const THREAD_2_CREATED = BASE_TIME + 3000; // Newest

      const parentPlanId = crypto.randomUUID();
      const childPlanId = crypto.randomUUID();

      const parentPlan = createPlan({
        id: parentPlanId,
        relativePath: "auth/readme.md",
        createdAt: PARENT_PLAN_CREATED,
        updatedAt: PARENT_PLAN_CREATED,
      });

      const childPlan = createPlan({
        id: childPlanId,
        relativePath: "auth/login.md",
        parentId: parentPlanId,
        createdAt: PARENT_PLAN_CREATED + 100,
        updatedAt: PARENT_PLAN_CREATED + 100,
      });

      const thread1 = createThread({
        id: "thread-1",
        name: "Thread 1",
        createdAt: THREAD_1_CREATED,
        updatedAt: THREAD_1_CREATED,
      });

      const thread2 = createThread({
        id: "thread-2",
        name: "Thread 2",
        createdAt: THREAD_2_CREATED,
        updatedAt: THREAD_2_CREATED,
      });

      const threads = [thread1, thread2];
      const plans = [parentPlan, childPlan];

      const expandedSections: Record<string, boolean> = {
        [SECTION_ID]: true,
        [`plan:${parentPlanId}`]: true,
      };
      const runningThreadIds = new Set<string>();

      const sections = buildTreeFromEntities(
        threads,
        plans,
        expandedSections,
        runningThreadIds,
        allRepos,
        getRepoName,
        getWorktreeName,
        getWorktreePath
      );

      const items = sections[0].items;

      console.log(
        "Actual item order (middle case):",
        items.map((item) => `${item.type}:${item.title} (depth=${item.depth}, created=${item.createdAt})`)
      );

      // Expected order by createdAt descending for depth-0:
      // 1. thread-2 (newest, T+3000)
      // 2. parent plan (middle, T+2000)
      // 3. child login (depth 1, immediately after parent)
      // 4. thread-1 (oldest, T+1000)

      const parentIndex = items.findIndex((item) => item.id === parentPlanId);
      const childIndex = items.findIndex((item) => item.id === childPlanId);
      const thread1Index = items.findIndex((item) => item.id === "thread-1");
      const thread2Index = items.findIndex((item) => item.id === "thread-2");

      // thread-2 should be first (newest)
      expect(thread2Index).toBe(0);

      // Parent plan should be second
      expect(parentIndex).toBe(1);

      // Child should IMMEDIATELY follow parent (this is the critical assertion)
      expect(childIndex).toBe(parentIndex + 1);

      // thread-1 should come after the child
      expect(thread1Index).toBe(3);
    });
  });
});
