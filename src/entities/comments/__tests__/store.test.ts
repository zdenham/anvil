// @vitest-environment node
/**
 * Comment Store Tests
 *
 * Tests all store operations including:
 * - Hydration and hydration flag
 * - Selectors (getByWorktree, getByThread, getByFile, getUnresolved)
 * - Optimistic mutations with rollback
 * - Clear worktree
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useCommentStore } from "../store";
import type { InlineComment } from "@core/types/comments.js";

function createComment(overrides: Partial<InlineComment> = {}): InlineComment {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    worktreeId: "wt-1",
    threadId: "th-1",
    filePath: "src/foo.ts",
    lineNumber: 10,
    lineType: "addition",
    content: "Test comment",
    resolved: false,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("useCommentStore", () => {
  beforeEach(() => {
    useCommentStore.setState({
      comments: {},
      _hydratedWorktrees: new Set(),
    });
  });

  // =========================================================================
  // Hydration
  // =========================================================================

  describe("hydrate", () => {
    it("should load comments and set hydration flag", () => {
      const c1 = createComment({ id: "c1" });
      const c2 = createComment({ id: "c2" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      expect(useCommentStore.getState().comments["c1"]).toEqual(c1);
      expect(useCommentStore.getState().comments["c2"]).toEqual(c2);
      expect(useCommentStore.getState().isHydrated("wt-1")).toBe(true);
    });

    it("should replace existing comments for a worktree", () => {
      const old = createComment({ id: "old", content: "old" });
      const replacement = createComment({ id: "new", content: "new" });

      useCommentStore.getState().hydrate("wt-1", [old]);
      expect(useCommentStore.getState().comments["old"]).toBeDefined();

      useCommentStore.getState().hydrate("wt-1", [replacement]);
      expect(useCommentStore.getState().comments["old"]).toBeUndefined();
      expect(useCommentStore.getState().comments["new"]).toEqual(replacement);
    });

    it("should not affect comments from other worktrees", () => {
      const wt1Comment = createComment({ id: "c1", worktreeId: "wt-1" });
      const wt2Comment = createComment({ id: "c2", worktreeId: "wt-2" });

      useCommentStore.getState().hydrate("wt-1", [wt1Comment]);
      useCommentStore.getState().hydrate("wt-2", [wt2Comment]);

      // Re-hydrate wt-1 with empty
      useCommentStore.getState().hydrate("wt-1", []);

      expect(useCommentStore.getState().comments["c1"]).toBeUndefined();
      expect(useCommentStore.getState().comments["c2"]).toEqual(wt2Comment);
    });
  });

  // =========================================================================
  // Selectors
  // =========================================================================

  describe("getByWorktree", () => {
    it("should filter by worktreeId", () => {
      const c1 = createComment({ id: "c1", worktreeId: "wt-1" });
      const c2 = createComment({ id: "c2", worktreeId: "wt-2" });

      useCommentStore.getState().hydrate("wt-1", [c1]);
      useCommentStore.getState().hydrate("wt-2", [c2]);

      expect(useCommentStore.getState().getByWorktree("wt-1")).toEqual([c1]);
      expect(useCommentStore.getState().getByWorktree("wt-2")).toEqual([c2]);
    });
  });

  describe("getByThread", () => {
    it("should filter by worktreeId and threadId", () => {
      const c1 = createComment({ id: "c1", threadId: "th-1" });
      const c2 = createComment({ id: "c2", threadId: "th-2" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      const result = useCommentStore.getState().getByThread("wt-1", "th-1");
      expect(result).toEqual([c1]);
    });
  });

  describe("getByFile", () => {
    it("should filter by file path", () => {
      const c1 = createComment({ id: "c1", filePath: "src/foo.ts" });
      const c2 = createComment({ id: "c2", filePath: "src/bar.ts" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      const result = useCommentStore.getState().getByFile("wt-1", "src/foo.ts");
      expect(result).toEqual([c1]);
    });

    it("should filter by threadId when provided", () => {
      const c1 = createComment({ id: "c1", filePath: "src/foo.ts", threadId: "th-1" });
      const c2 = createComment({ id: "c2", filePath: "src/foo.ts", threadId: "th-2" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      const result = useCommentStore.getState().getByFile("wt-1", "src/foo.ts", "th-1");
      expect(result).toEqual([c1]);
    });

    it("should return all comments for file when threadId is undefined", () => {
      const c1 = createComment({ id: "c1", filePath: "src/foo.ts", threadId: "th-1" });
      const c2 = createComment({ id: "c2", filePath: "src/foo.ts", threadId: "th-2" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      const result = useCommentStore.getState().getByFile("wt-1", "src/foo.ts");
      expect(result).toHaveLength(2);
    });
  });

  describe("getUnresolved", () => {
    it("should exclude resolved comments", () => {
      const c1 = createComment({ id: "c1", resolved: false });
      const c2 = createComment({ id: "c2", resolved: true, resolvedAt: Date.now() });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      expect(useCommentStore.getState().getUnresolved("wt-1")).toEqual([c1]);
    });

    it("should filter by threadId when provided", () => {
      const c1 = createComment({ id: "c1", resolved: false, threadId: "th-1" });
      const c2 = createComment({ id: "c2", resolved: false, threadId: "th-2" });

      useCommentStore.getState().hydrate("wt-1", [c1, c2]);

      expect(useCommentStore.getState().getUnresolved("wt-1", "th-1")).toEqual([c1]);
    });

    it("should return count via getUnresolvedCount", () => {
      const c1 = createComment({ id: "c1", resolved: false });
      const c2 = createComment({ id: "c2", resolved: false });
      const c3 = createComment({ id: "c3", resolved: true, resolvedAt: Date.now() });

      useCommentStore.getState().hydrate("wt-1", [c1, c2, c3]);

      expect(useCommentStore.getState().getUnresolvedCount("wt-1")).toBe(2);
    });
  });

  // =========================================================================
  // Optimistic Mutations
  // =========================================================================

  describe("_applyAdd", () => {
    it("should add comment and return working rollback", () => {
      const comment = createComment({ id: "c1" });

      const rollback = useCommentStore.getState()._applyAdd(comment);
      expect(useCommentStore.getState().comments["c1"]).toEqual(comment);

      rollback();
      expect(useCommentStore.getState().comments["c1"]).toBeUndefined();
    });
  });

  describe("_applyUpdate", () => {
    it("should update fields and return working rollback", () => {
      const comment = createComment({ id: "c1", content: "original" });
      useCommentStore.getState().hydrate("wt-1", [comment]);

      const rollback = useCommentStore.getState()._applyUpdate("c1", { content: "updated" });
      expect(useCommentStore.getState().comments["c1"].content).toBe("updated");

      rollback();
      expect(useCommentStore.getState().comments["c1"].content).toBe("original");
    });

    it("should return no-op rollback for non-existent comment", () => {
      const rollback = useCommentStore.getState()._applyUpdate("nonexistent", { content: "x" });
      rollback(); // should not throw
    });
  });

  describe("_applyDelete", () => {
    it("should remove comment and return working rollback", () => {
      const comment = createComment({ id: "c1" });
      useCommentStore.getState().hydrate("wt-1", [comment]);

      const rollback = useCommentStore.getState()._applyDelete("c1");
      expect(useCommentStore.getState().comments["c1"]).toBeUndefined();

      rollback();
      expect(useCommentStore.getState().comments["c1"]).toEqual(comment);
    });
  });

  describe("_applyClearWorktree", () => {
    it("should remove all comments for a worktree and reset hydration", () => {
      const c1 = createComment({ id: "c1", worktreeId: "wt-1" });
      const c2 = createComment({ id: "c2", worktreeId: "wt-2" });

      useCommentStore.getState().hydrate("wt-1", [c1]);
      useCommentStore.getState().hydrate("wt-2", [c2]);

      useCommentStore.getState()._applyClearWorktree("wt-1");

      expect(useCommentStore.getState().comments["c1"]).toBeUndefined();
      expect(useCommentStore.getState().comments["c2"]).toEqual(c2);
      expect(useCommentStore.getState().isHydrated("wt-1")).toBe(false);
      expect(useCommentStore.getState().isHydrated("wt-2")).toBe(true);
    });
  });
});
