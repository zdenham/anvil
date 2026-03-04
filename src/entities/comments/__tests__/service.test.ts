// @vitest-environment node
/**
 * Comment Service Tests
 *
 * Tests for commentService including:
 * - loadForWorktree (disk read, Zod validation, archiving, hydration)
 * - create, resolve, _resolveFromEvent, delete
 * - Rollback on disk write failure
 * - clearWorktree
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCommentStore } from "../store";
import type { InlineComment } from "@core/types/comments.js";

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

vi.mock("@/entities/events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("@/lib/app-data-store", () => ({
  appData: {
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import { commentService } from "../service";
import { eventBus } from "@/entities/events";
import { logger } from "@/lib/logger-client";
import { appData } from "@/lib/app-data-store";
import { EventName } from "@core/types/events.js";

const mockAppData = appData as unknown as {
  readJson: ReturnType<typeof vi.fn>;
  writeJson: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
};

// Fixed valid UUIDs for test assertions
const WT1 = "00000000-0000-4000-a000-000000000001";
const TH1 = "00000000-0000-4000-a000-000000000002";
const C1 = "00000000-0000-4000-a000-000000000010";
const C_STALE = "00000000-0000-4000-a000-000000000011";
const C_ACTIVE = "00000000-0000-4000-a000-000000000012";
const C_RECENT = "00000000-0000-4000-a000-000000000013";

function makeUUID(n: number): string {
  return `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
}

function createComment(overrides: Partial<InlineComment> = {}): InlineComment {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    worktreeId: WT1,
    threadId: TH1,
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

describe("commentService", () => {
  beforeEach(() => {
    useCommentStore.setState({
      comments: {},
      _hydratedWorktrees: new Set(),
    });
    vi.clearAllMocks();
  });

  // =========================================================================
  // loadForWorktree
  // =========================================================================

  describe("loadForWorktree", () => {
    it("should read from disk, validate with Zod, and hydrate store", async () => {
      const c1 = createComment({ id: C1 });
      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [c1],
      });

      await commentService.loadForWorktree(WT1);

      expect(mockAppData.readJson).toHaveBeenCalledWith(`comments/${WT1}.json`);
      expect(useCommentStore.getState().isHydrated(WT1)).toBe(true);
      expect(useCommentStore.getState().comments[C1]).toEqual(c1);
    });

    it("should handle missing file with empty hydration", async () => {
      mockAppData.readJson.mockResolvedValueOnce(null);

      await commentService.loadForWorktree(WT1);

      expect(useCommentStore.getState().isHydrated(WT1)).toBe(true);
      expect(Object.keys(useCommentStore.getState().comments)).toHaveLength(0);
    });

    it("should handle corrupted file with warning and empty hydration", async () => {
      mockAppData.readJson.mockResolvedValueOnce({ garbage: true });

      await commentService.loadForWorktree(WT1);

      expect(logger.warn).toHaveBeenCalledWith(
        "[CommentService] Invalid comments file, resetting",
        expect.objectContaining({ worktreeId: WT1 }),
      );
      expect(useCommentStore.getState().isHydrated(WT1)).toBe(true);
      expect(Object.keys(useCommentStore.getState().comments)).toHaveLength(0);
    });

    it("should no-op if already hydrated", async () => {
      useCommentStore.getState().hydrate(WT1, []);

      await commentService.loadForWorktree(WT1);

      expect(mockAppData.readJson).not.toHaveBeenCalled();
    });

    it("should archive resolved comments older than 7 days", async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const staleComment = createComment({
        id: C_STALE,
        resolved: true,
        resolvedAt: eightDaysAgo,
        createdAt: eightDaysAgo,
        updatedAt: eightDaysAgo,
      });
      const activeComment = createComment({ id: C_ACTIVE, resolved: false });

      mockAppData.readJson
        .mockResolvedValueOnce({
          version: 1,
          comments: [staleComment, activeComment],
        })
        // Archive file read
        .mockResolvedValueOnce(null);

      await commentService.loadForWorktree(WT1);

      // Archive file written with stale comment
      expect(mockAppData.writeJson).toHaveBeenCalledWith(
        `comments/${WT1}.archive.json`,
        expect.objectContaining({
          version: 1,
          comments: [staleComment],
        }),
      );

      // Active file rewritten without stale comment
      expect(mockAppData.writeJson).toHaveBeenCalledWith(
        `comments/${WT1}.json`,
        expect.objectContaining({
          version: 1,
          comments: [activeComment],
        }),
      );

      // Store only has active comment
      expect(useCommentStore.getState().comments[C_STALE]).toBeUndefined();
      expect(useCommentStore.getState().comments[C_ACTIVE]).toEqual(activeComment);
    });

    it("should preserve recently resolved comments (< 7 days old)", async () => {
      const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
      const recentResolved = createComment({
        id: C_RECENT,
        resolved: true,
        resolvedAt: oneDayAgo,
      });

      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [recentResolved],
      });

      await commentService.loadForWorktree(WT1);

      // No archive write since nothing is stale
      expect(mockAppData.writeJson).not.toHaveBeenCalledWith(
        `comments/${WT1}.archive.json`,
        expect.anything(),
      );

      expect(useCommentStore.getState().comments[C_RECENT]).toEqual(recentResolved);
    });

    it("should log warning when unresolved count >= 200", async () => {
      const comments = Array.from({ length: 200 }, (_, i) =>
        createComment({ id: makeUUID(1000 + i), resolved: false }),
      );

      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments,
      });

      await commentService.loadForWorktree(WT1);

      expect(logger.warn).toHaveBeenCalledWith(
        "[CommentService] High unresolved comment count",
        expect.objectContaining({ unresolvedCount: 200 }),
      );
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe("create", () => {
    it("should write to disk, update store, and emit event", async () => {
      useCommentStore.getState().hydrate(WT1, []);
      mockAppData.readJson.mockResolvedValueOnce(null);

      const result = await commentService.create({
        worktreeId: WT1,
        filePath: "src/foo.ts",
        lineNumber: 42,
        lineType: "addition",
        content: "Fix this",
        threadId: TH1,
      });

      expect(result.content).toBe("Fix this");
      expect(result.filePath).toBe("src/foo.ts");
      expect(result.lineNumber).toBe(42);
      expect(result.resolved).toBe(false);

      expect(mockAppData.writeJson).toHaveBeenCalledWith(
        `comments/${WT1}.json`,
        expect.objectContaining({ version: 1 }),
      );

      expect(eventBus.emit).toHaveBeenCalledWith(
        EventName.COMMENT_ADDED,
        expect.objectContaining({ worktreeId: WT1, commentId: result.id }),
      );

      expect(useCommentStore.getState().comments[result.id]).toBeDefined();
    });
  });

  // =========================================================================
  // resolve
  // =========================================================================

  describe("resolve", () => {
    it("should set resolved fields, persist, and emit event", async () => {
      const comment = createComment({ id: C1 });
      useCommentStore.getState().hydrate(WT1, [comment]);
      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [comment],
      });

      await commentService.resolve(WT1, C1);

      expect(useCommentStore.getState().comments[C1].resolved).toBe(true);
      expect(useCommentStore.getState().comments[C1].resolvedAt).toBeGreaterThan(0);

      expect(eventBus.emit).toHaveBeenCalledWith(
        EventName.COMMENT_RESOLVED,
        expect.objectContaining({ worktreeId: WT1, commentId: C1 }),
      );
    });
  });

  // =========================================================================
  // _resolveFromEvent
  // =========================================================================

  describe("_resolveFromEvent", () => {
    it("should set resolved fields and persist but NOT emit event", async () => {
      const comment = createComment({ id: C1 });
      useCommentStore.getState().hydrate(WT1, [comment]);
      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [comment],
      });

      await commentService._resolveFromEvent(WT1, C1);

      expect(useCommentStore.getState().comments[C1].resolved).toBe(true);

      // Should NOT emit any event (avoids circular loop)
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe("delete", () => {
    it("should remove from disk and store, and emit event", async () => {
      const comment = createComment({ id: C1 });
      useCommentStore.getState().hydrate(WT1, [comment]);
      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [comment],
      });

      await commentService.delete(WT1, C1);

      expect(useCommentStore.getState().comments[C1]).toBeUndefined();

      expect(eventBus.emit).toHaveBeenCalledWith(
        EventName.COMMENT_DELETED,
        expect.objectContaining({ worktreeId: WT1, commentId: C1 }),
      );
    });
  });

  // =========================================================================
  // Rollback on failure
  // =========================================================================

  describe("rollback on disk write failure", () => {
    it("should restore previous store state when create fails", async () => {
      useCommentStore.getState().hydrate(WT1, []);
      mockAppData.readJson.mockResolvedValueOnce(null);
      mockAppData.writeJson.mockRejectedValueOnce(new Error("disk error"));

      await expect(
        commentService.create({
          worktreeId: WT1,
          filePath: "src/foo.ts",
          lineNumber: 1,
          lineType: "addition",
          content: "test",
        }),
      ).rejects.toThrow("disk error");

      // Comment should have been rolled back
      expect(Object.keys(useCommentStore.getState().comments)).toHaveLength(0);
    });

    it("should restore previous store state when resolve fails", async () => {
      const comment = createComment({ id: C1, resolved: false });
      useCommentStore.getState().hydrate(WT1, [comment]);
      mockAppData.readJson.mockResolvedValueOnce({
        version: 1,
        comments: [comment],
      });
      mockAppData.writeJson.mockRejectedValueOnce(new Error("disk error"));

      await expect(commentService.resolve(WT1, C1)).rejects.toThrow("disk error");

      // Should have rolled back to unresolved
      expect(useCommentStore.getState().comments[C1].resolved).toBe(false);
    });
  });

  // =========================================================================
  // clearWorktree
  // =========================================================================

  describe("clearWorktree", () => {
    it("should delete both active and archive files", async () => {
      const comment = createComment({ id: C1 });
      useCommentStore.getState().hydrate(WT1, [comment]);

      await commentService.clearWorktree(WT1);

      expect(useCommentStore.getState().comments[C1]).toBeUndefined();
      expect(useCommentStore.getState().isHydrated(WT1)).toBe(false);
      expect(mockAppData.deleteFile).toHaveBeenCalledWith(`comments/${WT1}.json`);
      expect(mockAppData.deleteFile).toHaveBeenCalledWith(`comments/${WT1}.archive.json`);
    });
  });
});
