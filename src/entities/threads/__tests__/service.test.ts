/**
 * Thread Service Tests
 *
 * Tests for threadService including:
 * - Path resolution (new and legacy locations)
 * - Hydration from both storage structures
 * - CRUD operations
 * - Archive functionality
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ThreadMetadata } from "../types";

// Mock dependencies - must be declared before vi.mock calls due to hoisting
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

vi.mock("@/lib/persistence", () => ({
  persistence: {
    exists: vi.fn(),
    glob: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
    removeDir: vi.fn(),
  },
}));

// Import after mocks are set up
import { threadService } from "../service";
import { useThreadStore } from "../store";
import { persistence } from "@/lib/persistence";
import { eventBus } from "@/entities/events";

// Type assertion for mocked module using vi.mocked
const mockPersistence = vi.mocked(persistence);
const mockEventBus = vi.mocked(eventBus);

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

// Helper to setup default mock responses
function setupDefaultMocks() {
  mockPersistence.exists.mockResolvedValue(false);
  mockPersistence.glob.mockResolvedValue([]);
  mockPersistence.readJson.mockResolvedValue(null);
  mockPersistence.writeJson.mockResolvedValue(undefined);
  mockPersistence.ensureDir.mockResolvedValue(undefined);
  mockPersistence.removeDir.mockResolvedValue(undefined);
}

describe("threadService", () => {
  beforeEach(() => {
    // Clear mock call history but keep implementations
    vi.clearAllMocks();

    // Reset store to initial state
    useThreadStore.setState({
      threads: {},
      _threadsArray: [],
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Path Resolution Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("findThreadPath (via getThreadPath)", () => {
    it("returns new location when thread exists there", async () => {
      setupDefaultMocks();
      const threadId = "abc123";
      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });

      const result = await threadService.getThreadPath(threadId);
      expect(result).toBe(`threads/${threadId}`);
    });

    it("falls back to legacy location when not in new location", async () => {
      setupDefaultMocks();
      const threadId = "abc123";
      mockPersistence.exists.mockResolvedValue(false);
      mockPersistence.glob.mockResolvedValue([
        `tasks/my-task/threads/agent-${threadId}/metadata.json`,
      ]);

      const result = await threadService.getThreadPath(threadId);
      expect(result).toBe(`tasks/my-task/threads/agent-${threadId}`);
    });

    it("returns undefined when thread not found in either location", async () => {
      setupDefaultMocks();

      const result = await threadService.getThreadPath("nonexistent");
      expect(result).toBeUndefined();
    });

    it("prefers new location over legacy when both exist", async () => {
      setupDefaultMocks();
      const threadId = "abc123";
      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      // Even if glob would return something, exists check happens first
      mockPersistence.glob.mockResolvedValue([
        `tasks/my-task/threads/agent-${threadId}/metadata.json`,
      ]);

      const result = await threadService.getThreadPath(threadId);
      expect(result).toBe(`threads/${threadId}`);
      // glob should not be called since exists returned true
      expect(mockPersistence.glob).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydrate Tests
  // Note: These tests use mockResolvedValueOnce chaining which has issues with
  // Vitest's mock reset behavior. The hydrate functionality is tested indirectly
  // through other tests. TODO: Fix mock setup for these tests.
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("loads threads from new top-level structure", async () => {
      setupDefaultMocks();
      // Use valid RFC 4122 UUIDs (version 4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx)
      const thread1Id = "11111111-1111-4111-a111-111111111111";
      const thread2Id = "22222222-2222-4222-a222-222222222222";
      const thread1 = createThreadMetadata({ id: thread1Id });
      const thread2 = createThreadMetadata({ id: thread2Id });

      // Use mockImplementation with path-based logic for deterministic behavior
      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "threads/*/metadata.json") {
          return [`threads/${thread1Id}/metadata.json`, `threads/${thread2Id}/metadata.json`];
        }
        return []; // legacy returns empty
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${thread1Id}/metadata.json`) return thread1;
        if (path === `threads/${thread2Id}/metadata.json`) return thread2;
        return null;
      });

      await threadService.hydrate();

      expect(useThreadStore.getState().threads[thread1Id]).toEqual(thread1);
      expect(useThreadStore.getState().threads[thread2Id]).toEqual(thread2);
    });

    it("loads threads from legacy task-nested structure", async () => {
      setupDefaultMocks();
      const threadId = "33333333-3333-4333-a333-333333333333";
      const thread = createThreadMetadata({ id: threadId });

      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "threads/*/metadata.json") {
          return []; // new returns empty
        }
        if (pattern === "tasks/*/threads/*/metadata.json") {
          return [`tasks/task1/threads/agent-${threadId}/metadata.json`];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `tasks/task1/threads/agent-${threadId}/metadata.json`) return thread;
        return null;
      });

      await threadService.hydrate();

      expect(useThreadStore.getState().threads[threadId]).toEqual(thread);
    });

    it("loads threads from both locations simultaneously", async () => {
      setupDefaultMocks();
      const newThreadId = "44444444-4444-4444-a444-444444444444";
      const legacyThreadId = "55555555-5555-4555-a555-555555555555";
      const newThread = createThreadMetadata({ id: newThreadId });
      const legacyThread = createThreadMetadata({ id: legacyThreadId });

      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "threads/*/metadata.json") {
          return [`threads/${newThreadId}/metadata.json`];
        }
        if (pattern === "tasks/*/threads/*/metadata.json") {
          return [`tasks/task1/threads/agent-${legacyThreadId}/metadata.json`];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${newThreadId}/metadata.json`) return newThread;
        if (path === `tasks/task1/threads/agent-${legacyThreadId}/metadata.json`) return legacyThread;
        return null;
      });

      await threadService.hydrate();

      expect(useThreadStore.getState().threads[newThreadId]).toEqual(newThread);
      expect(useThreadStore.getState().threads[legacyThreadId]).toEqual(legacyThread);
    });

    it("skips invalid metadata files without crashing", async () => {
      setupDefaultMocks();
      const validThreadId = "66666666-6666-4666-a666-666666666666";
      const invalidThreadId = "77777777-7777-4777-a777-777777777777";
      const validThread = createThreadMetadata({ id: validThreadId });

      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "threads/*/metadata.json") {
          return [`threads/${validThreadId}/metadata.json`, `threads/${invalidThreadId}/metadata.json`];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${validThreadId}/metadata.json`) return validThread;
        if (path === `threads/${invalidThreadId}/metadata.json`) return { invalid: "data" }; // Missing required fields
        return null;
      });

      await threadService.hydrate();

      expect(useThreadStore.getState().threads[validThreadId]).toEqual(validThread);
      expect(useThreadStore.getState().threads[invalidThreadId]).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Create Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("create", () => {
    it("writes to new top-level location", async () => {
      const input = {
        repoId: crypto.randomUUID(),
        worktreeId: crypto.randomUUID(),
        prompt: "Test prompt",
      };

      const result = await threadService.create(input);

      expect(mockPersistence.ensureDir).toHaveBeenCalledWith(`threads/${result.id}`);
      expect(mockPersistence.writeJson).toHaveBeenCalledWith(
        `threads/${result.id}/metadata.json`,
        expect.objectContaining({
          id: result.id,
          repoId: input.repoId,
          worktreeId: input.worktreeId,
        })
      );
    });

    it("applies optimistic update to store", async () => {
      const input = {
        repoId: crypto.randomUUID(),
        worktreeId: crypto.randomUUID(),
        prompt: "Test prompt",
      };

      const result = await threadService.create(input);

      expect(useThreadStore.getState().threads[result.id]).toBeDefined();
      expect(useThreadStore.getState().threads[result.id].repoId).toBe(input.repoId);
    });

    it("rolls back on persistence failure", async () => {
      mockPersistence.writeJson.mockRejectedValue(new Error("Write failed"));

      const input = {
        repoId: crypto.randomUUID(),
        worktreeId: crypto.randomUUID(),
        prompt: "Test prompt",
      };

      await expect(threadService.create(input)).rejects.toThrow("Write failed");

      // Thread should not be in store after rollback
      const threads = Object.values(useThreadStore.getState().threads);
      expect(threads).toHaveLength(0);
    });

    it("throws error if repoId is missing", async () => {
      const input = {
        worktreeId: crypto.randomUUID(),
        prompt: "Test prompt",
      } as any;

      await expect(threadService.create(input)).rejects.toThrow("repoId is required");
    });

    it("throws error if worktreeId is missing", async () => {
      const input = {
        repoId: crypto.randomUUID(),
        prompt: "Test prompt",
      } as any;

      await expect(threadService.create(input)).rejects.toThrow("worktreeId is required");
    });

    it("uses provided id if given", async () => {
      setupDefaultMocks();
      const customId = crypto.randomUUID();
      const input = {
        id: customId,
        repoId: crypto.randomUUID(),
        worktreeId: crypto.randomUUID(),
        prompt: "Test prompt",
      };

      const result = await threadService.create(input);

      expect(result.id).toBe(customId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Archive Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("archive", () => {
    it("moves thread to archive directory", async () => {
      setupDefaultMocks();
      const threadId = "a1111111-1111-4111-a111-111111111111";
      const thread = createThreadMetadata({ id: threadId });

      // Add thread to store
      useThreadStore.getState()._applyCreate(thread);

      // Mock path resolution
      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${threadId}/metadata.json`) return thread;
        if (path === `threads/${threadId}/state.json`) return { messages: [] };
        return null;
      });

      await threadService.archive(threadId);

      // Should create archive directory
      expect(mockPersistence.ensureDir).toHaveBeenCalledWith("archive/threads");
      expect(mockPersistence.ensureDir).toHaveBeenCalledWith(`archive/threads/${threadId}`);

      // Should write to archive location
      expect(mockPersistence.writeJson).toHaveBeenCalledWith(
        `archive/threads/${threadId}/metadata.json`,
        thread
      );

      // Should remove original
      expect(mockPersistence.removeDir).toHaveBeenCalledWith(`threads/${threadId}`);
    });

    it("emits THREAD_ARCHIVED event after successful archive", async () => {
      setupDefaultMocks();
      const threadId = "a2222222-2222-4222-a222-222222222222";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      mockPersistence.readJson.mockResolvedValue(thread);

      await threadService.archive(threadId);

      expect(mockEventBus.emit).toHaveBeenCalledWith("thread:archived", { threadId });
    });

    it("removes thread from store after archive", async () => {
      setupDefaultMocks();
      const threadId = "a3333333-3333-4333-a333-333333333333";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);
      expect(useThreadStore.getState().threads[threadId]).toBeDefined();

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      mockPersistence.readJson.mockResolvedValue(thread);

      await threadService.archive(threadId);

      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();
    });

    it("rolls back on failure", async () => {
      setupDefaultMocks();
      const threadId = "a4444444-4444-4444-a444-444444444444";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      mockPersistence.readJson.mockResolvedValue(thread);
      mockPersistence.removeDir.mockRejectedValue(new Error("Remove failed"));

      await expect(threadService.archive(threadId)).rejects.toThrow("Remove failed");

      // Thread should still be in store after rollback
      expect(useThreadStore.getState().threads[threadId]).toBeDefined();
    });

    it("handles non-existent thread gracefully", async () => {
      setupDefaultMocks();
      // No thread in store, no error should be thrown
      await expect(threadService.archive("nonexistent")).resolves.toBeUndefined();
    });

    it("handles thread not found on disk gracefully", async () => {
      setupDefaultMocks();
      const threadId = "a5555555-5555-4555-a555-555555555555";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);
      mockPersistence.exists.mockResolvedValue(false);
      mockPersistence.glob.mockResolvedValue([]);

      // Should return early without error
      await expect(threadService.archive(threadId)).resolves.toBeUndefined();
    });

    it("works for threads in legacy location", async () => {
      setupDefaultMocks();
      const threadId = "a6666666-6666-4666-a666-666666666666";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);

      mockPersistence.exists.mockResolvedValue(false);
      mockPersistence.glob.mockResolvedValue([
        `tasks/task1/threads/agent-${threadId}/metadata.json`,
      ]);
      mockPersistence.readJson.mockResolvedValue(thread);

      await threadService.archive(threadId);

      // Should remove from legacy location
      expect(mockPersistence.removeDir).toHaveBeenCalledWith(
        `tasks/task1/threads/agent-${threadId}`
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ListArchived Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("listArchived", () => {
    it("returns all archived threads", async () => {
      setupDefaultMocks();
      const archived1Id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
      const archived2Id = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
      const thread1 = createThreadMetadata({ id: archived1Id });
      const thread2 = createThreadMetadata({ id: archived2Id });

      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "archive/threads/*/metadata.json") {
          return [
            `archive/threads/${archived1Id}/metadata.json`,
            `archive/threads/${archived2Id}/metadata.json`,
          ];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `archive/threads/${archived1Id}/metadata.json`) return thread1;
        if (path === `archive/threads/${archived2Id}/metadata.json`) return thread2;
        return null;
      });

      const result = await threadService.listArchived();

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(thread1);
      expect(result).toContainEqual(thread2);
    });

    it("returns empty array when no archived threads", async () => {
      setupDefaultMocks();

      const result = await threadService.listArchived();

      expect(result).toEqual([]);
    });

    it("skips invalid metadata files", async () => {
      setupDefaultMocks();
      const validArchivedId = "cccccccc-cccc-4ccc-accc-cccccccccccc";
      const invalidArchivedId = "dddddddd-dddd-4ddd-addd-dddddddddddd";
      const validThread = createThreadMetadata({ id: validArchivedId });

      mockPersistence.glob.mockImplementation(async (pattern: string) => {
        if (pattern === "archive/threads/*/metadata.json") {
          return [
            `archive/threads/${validArchivedId}/metadata.json`,
            `archive/threads/${invalidArchivedId}/metadata.json`,
          ];
        }
        return [];
      });

      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `archive/threads/${validArchivedId}/metadata.json`) return validThread;
        if (path === `archive/threads/${invalidArchivedId}/metadata.json`) return { broken: "data" };
        return null;
      });

      const result = await threadService.listArchived();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(validThread);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Update Tests
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // getByRepo / getByWorktree Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getByRepo", () => {
    it("returns all threads for that repo", () => {
      const repoId = crypto.randomUUID();
      const otherRepoId = crypto.randomUUID();
      const thread1 = createThreadMetadata({ id: "repo-thread-1", repoId });
      const thread2 = createThreadMetadata({ id: "repo-thread-2", repoId });
      const thread3 = createThreadMetadata({ id: "other-repo-thread", repoId: otherRepoId });

      useThreadStore.getState()._applyCreate(thread1);
      useThreadStore.getState()._applyCreate(thread2);
      useThreadStore.getState()._applyCreate(thread3);

      const result = threadService.getByRepo(repoId);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toContain("repo-thread-1");
      expect(result.map((t) => t.id)).toContain("repo-thread-2");
    });

    it("returns empty array when no matches exist", () => {
      const thread = createThreadMetadata({ id: "some-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const result = threadService.getByRepo("nonexistent-repo");

      expect(result).toEqual([]);
    });
  });

  describe("getByWorktree", () => {
    it("returns all threads for that worktree", () => {
      const worktreeId = crypto.randomUUID();
      const otherWorktreeId = crypto.randomUUID();
      const thread1 = createThreadMetadata({ id: "wt-thread-1", worktreeId });
      const thread2 = createThreadMetadata({ id: "wt-thread-2", worktreeId });
      const thread3 = createThreadMetadata({ id: "other-wt-thread", worktreeId: otherWorktreeId });

      useThreadStore.getState()._applyCreate(thread1);
      useThreadStore.getState()._applyCreate(thread2);
      useThreadStore.getState()._applyCreate(thread3);

      const result = threadService.getByWorktree(worktreeId);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toContain("wt-thread-1");
      expect(result.map((t) => t.id)).toContain("wt-thread-2");
    });

    it("returns empty array when no matches exist", () => {
      const thread = createThreadMetadata({ id: "some-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const result = threadService.getByWorktree("nonexistent-worktree");

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates thread in store and on disk", async () => {
      const threadId = "update-test";
      const thread = createThreadMetadata({ id: threadId, status: "idle" });

      useThreadStore.getState()._applyCreate(thread);

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      mockPersistence.readJson.mockResolvedValue(thread);

      await threadService.update(threadId, { status: "running" });

      // Store should be updated
      expect(useThreadStore.getState().threads[threadId].status).toBe("running");

      // Disk write should happen
      expect(mockPersistence.writeJson).toHaveBeenCalledWith(
        `threads/${threadId}/metadata.json`,
        expect.objectContaining({ status: "running" })
      );
    });

    it("throws error for non-existent thread", async () => {
      await expect(threadService.update("nonexistent", { status: "running" })).rejects.toThrow(
        "Thread not found"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Delete Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("delete", () => {
    it("removes thread from store and disk", async () => {
      const threadId = "delete-test";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });

      await threadService.delete(threadId);

      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();
      expect(mockPersistence.removeDir).toHaveBeenCalledWith(`threads/${threadId}`);
    });

    it("handles non-existent thread gracefully", async () => {
      await expect(threadService.delete("nonexistent")).resolves.toBeUndefined();
    });

    it("removes from store only if not on disk", async () => {
      const threadId = "store-only";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);
      mockPersistence.exists.mockResolvedValue(false);
      mockPersistence.glob.mockResolvedValue([]);

      await threadService.delete(threadId);

      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();
      expect(mockPersistence.removeDir).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RefreshById Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("refreshById", () => {
    it("updates store from disk", async () => {
      setupDefaultMocks();
      const threadId = "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee";
      const oldThread = createThreadMetadata({ id: threadId, status: "idle" });
      const newThread = { ...oldThread, status: "completed" as const, updatedAt: Date.now() };

      useThreadStore.getState()._applyCreate(oldThread);

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });
      mockPersistence.readJson.mockImplementation(async (path: string) => {
        if (path === `threads/${threadId}/metadata.json`) return newThread;
        return null;
      });

      await threadService.refreshById(threadId);

      expect(useThreadStore.getState().threads[threadId].status).toBe("completed");
    });

    it("removes from store if not found on disk", async () => {
      setupDefaultMocks();
      const threadId = "remove-refresh-test";
      const thread = createThreadMetadata({ id: threadId });

      useThreadStore.getState()._applyCreate(thread);

      await threadService.refreshById(threadId);

      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // State Path Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getStatePath", () => {
    it("returns state.json path for existing thread", async () => {
      const threadId = "state-path-test";

      mockPersistence.exists.mockImplementation(async (path: string) => {
        return path === `threads/${threadId}/metadata.json`;
      });

      const result = await threadService.getStatePath(threadId);

      expect(result).toBe(`threads/${threadId}/state.json`);
    });

    it("returns undefined for non-existent thread", async () => {
      mockPersistence.exists.mockResolvedValue(false);
      mockPersistence.glob.mockResolvedValue([]);

      const result = await threadService.getStatePath("nonexistent");

      expect(result).toBeUndefined();
    });
  });
});
