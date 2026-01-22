/**
 * Thread Store Tests
 *
 * Tests for useThreadStore including:
 * - Hydration
 * - Optimistic apply methods with rollback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useThreadStore } from "../store";
import type { ThreadMetadata } from "../types";

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

describe("useThreadStore", () => {
  beforeEach(() => {
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
  // Hydration Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("hydrate", () => {
    it("populates threads correctly", () => {
      const thread1 = createThreadMetadata({ id: "thread1" });
      const thread2 = createThreadMetadata({ id: "thread2" });

      useThreadStore.getState().hydrate({
        thread1: thread1,
        thread2: thread2,
      });

      expect(useThreadStore.getState().threads["thread1"]).toEqual(thread1);
      expect(useThreadStore.getState().threads["thread2"]).toEqual(thread2);
      expect(useThreadStore.getState()._hydrated).toBe(true);
    });

    it("updates _threadsArray cache", () => {
      const thread1 = createThreadMetadata({ id: "thread1" });
      const thread2 = createThreadMetadata({ id: "thread2" });

      useThreadStore.getState().hydrate({
        thread1: thread1,
        thread2: thread2,
      });

      const threadsArray = useThreadStore.getState()._threadsArray;
      expect(threadsArray).toHaveLength(2);
      expect(threadsArray).toContainEqual(thread1);
      expect(threadsArray).toContainEqual(thread2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyCreate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyCreate", () => {
    it("adds thread to store", () => {
      const thread = createThreadMetadata({ id: "new-thread" });

      useThreadStore.getState()._applyCreate(thread);

      expect(useThreadStore.getState().threads["new-thread"]).toEqual(thread);
    });

    it("returns rollback function that removes thread", () => {
      const thread = createThreadMetadata({ id: "rollback-thread" });

      const rollback = useThreadStore.getState()._applyCreate(thread);

      expect(useThreadStore.getState().threads["rollback-thread"]).toBeDefined();

      rollback();

      expect(useThreadStore.getState().threads["rollback-thread"]).toBeUndefined();
    });

    it("updates _threadsArray on create", () => {
      const thread = createThreadMetadata({ id: "array-thread" });

      useThreadStore.getState()._applyCreate(thread);

      const threadsArray = useThreadStore.getState()._threadsArray;
      expect(threadsArray).toContainEqual(thread);
    });

    it("rollback also updates _threadsArray", () => {
      const thread = createThreadMetadata({ id: "rollback-array-thread" });

      const rollback = useThreadStore.getState()._applyCreate(thread);
      expect(useThreadStore.getState()._threadsArray).toHaveLength(1);

      rollback();
      expect(useThreadStore.getState()._threadsArray).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyUpdate Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyUpdate", () => {
    it("updates thread in store", () => {
      const thread = createThreadMetadata({ id: "update-thread", status: "idle" });
      useThreadStore.getState()._applyCreate(thread);

      const updated = { ...thread, status: "running" as const };
      useThreadStore.getState()._applyUpdate("update-thread", updated);

      expect(useThreadStore.getState().threads["update-thread"].status).toBe("running");
    });

    it("returns rollback function that restores previous state", () => {
      const thread = createThreadMetadata({ id: "restore-thread", status: "idle" });
      useThreadStore.getState()._applyCreate(thread);

      const updated = { ...thread, status: "running" as const };
      const rollback = useThreadStore.getState()._applyUpdate("restore-thread", updated);

      expect(useThreadStore.getState().threads["restore-thread"].status).toBe("running");

      rollback();

      expect(useThreadStore.getState().threads["restore-thread"].status).toBe("idle");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // _applyDelete Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("_applyDelete", () => {
    it("removes thread from store", () => {
      const thread = createThreadMetadata({ id: "delete-thread" });
      useThreadStore.getState()._applyCreate(thread);

      useThreadStore.getState()._applyDelete("delete-thread");

      expect(useThreadStore.getState().threads["delete-thread"]).toBeUndefined();
    });

    it("returns rollback function that restores thread", () => {
      const thread = createThreadMetadata({ id: "restore-delete-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const rollback = useThreadStore.getState()._applyDelete("restore-delete-thread");

      expect(useThreadStore.getState().threads["restore-delete-thread"]).toBeUndefined();

      rollback();

      expect(useThreadStore.getState().threads["restore-delete-thread"]).toEqual(thread);
    });

    it("updates _threadsArray on delete", () => {
      const thread = createThreadMetadata({ id: "array-delete-thread" });
      useThreadStore.getState()._applyCreate(thread);
      expect(useThreadStore.getState()._threadsArray).toHaveLength(1);

      useThreadStore.getState()._applyDelete("array-delete-thread");

      expect(useThreadStore.getState()._threadsArray).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Selector Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("selectors", () => {
    it("getThread returns thread by id", () => {
      const thread = createThreadMetadata({ id: "get-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const result = useThreadStore.getState().getThread("get-thread");

      expect(result).toEqual(thread);
    });

    it("getThread returns undefined for non-existent thread", () => {
      const result = useThreadStore.getState().getThread("nonexistent");

      expect(result).toBeUndefined();
    });

    it("getAllThreads returns all threads", () => {
      const thread1 = createThreadMetadata({ id: "all1" });
      const thread2 = createThreadMetadata({ id: "all2" });
      useThreadStore.getState()._applyCreate(thread1);
      useThreadStore.getState()._applyCreate(thread2);

      const result = useThreadStore.getState().getAllThreads();

      expect(result).toHaveLength(2);
    });

    it("getThreadsByStatus filters correctly", () => {
      const idle = createThreadMetadata({ id: "idle", status: "idle" });
      const running = createThreadMetadata({ id: "running", status: "running" });
      const completed = createThreadMetadata({ id: "completed", status: "completed" });

      useThreadStore.getState()._applyCreate(idle);
      useThreadStore.getState()._applyCreate(running);
      useThreadStore.getState()._applyCreate(completed);

      const runningThreads = useThreadStore.getState().getThreadsByStatus("running");

      expect(runningThreads).toHaveLength(1);
      expect(runningThreads[0].id).toBe("running");
    });

    it("getRunningThreads returns only running threads", () => {
      const idle = createThreadMetadata({ id: "idle", status: "idle" });
      const running1 = createThreadMetadata({ id: "running1", status: "running" });
      const running2 = createThreadMetadata({ id: "running2", status: "running" });

      useThreadStore.getState()._applyCreate(idle);
      useThreadStore.getState()._applyCreate(running1);
      useThreadStore.getState()._applyCreate(running2);

      const runningThreads = useThreadStore.getState().getRunningThreads();

      expect(runningThreads).toHaveLength(2);
    });

    it("getUnreadThreads returns only unread threads", () => {
      const read = createThreadMetadata({ id: "read", isRead: true });
      const unread = createThreadMetadata({ id: "unread", isRead: false });

      useThreadStore.getState()._applyCreate(read);
      useThreadStore.getState()._applyCreate(unread);

      const unreadThreads = useThreadStore.getState().getUnreadThreads();

      expect(unreadThreads).toHaveLength(1);
      expect(unreadThreads[0].id).toBe("unread");
    });

    it("getThreadsByRepo returns only threads matching the given repoId", () => {
      const repoId1 = crypto.randomUUID();
      const repoId2 = crypto.randomUUID();
      const thread1 = createThreadMetadata({ id: "repo1-thread1", repoId: repoId1 });
      const thread2 = createThreadMetadata({ id: "repo1-thread2", repoId: repoId1 });
      const thread3 = createThreadMetadata({ id: "repo2-thread1", repoId: repoId2 });

      useThreadStore.getState()._applyCreate(thread1);
      useThreadStore.getState()._applyCreate(thread2);
      useThreadStore.getState()._applyCreate(thread3);

      const repo1Threads = useThreadStore.getState().getThreadsByRepo(repoId1);

      expect(repo1Threads).toHaveLength(2);
      expect(repo1Threads.map((t) => t.id)).toContain("repo1-thread1");
      expect(repo1Threads.map((t) => t.id)).toContain("repo1-thread2");
    });

    it("getThreadsByRepo returns empty array when no threads match", () => {
      const thread = createThreadMetadata({ id: "other-repo-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const result = useThreadStore.getState().getThreadsByRepo("nonexistent-repo-id");

      expect(result).toEqual([]);
    });

    it("getThreadsByWorktree returns only threads matching the given worktreeId", () => {
      const worktreeId1 = crypto.randomUUID();
      const worktreeId2 = crypto.randomUUID();
      const thread1 = createThreadMetadata({ id: "wt1-thread1", worktreeId: worktreeId1 });
      const thread2 = createThreadMetadata({ id: "wt1-thread2", worktreeId: worktreeId1 });
      const thread3 = createThreadMetadata({ id: "wt2-thread1", worktreeId: worktreeId2 });

      useThreadStore.getState()._applyCreate(thread1);
      useThreadStore.getState()._applyCreate(thread2);
      useThreadStore.getState()._applyCreate(thread3);

      const wt1Threads = useThreadStore.getState().getThreadsByWorktree(worktreeId1);

      expect(wt1Threads).toHaveLength(2);
      expect(wt1Threads.map((t) => t.id)).toContain("wt1-thread1");
      expect(wt1Threads.map((t) => t.id)).toContain("wt1-thread2");
    });

    it("getThreadsByWorktree returns empty array when no threads match", () => {
      const thread = createThreadMetadata({ id: "other-wt-thread" });
      useThreadStore.getState()._applyCreate(thread);

      const result = useThreadStore.getState().getThreadsByWorktree("nonexistent-worktree-id");

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Active Thread Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("active thread management", () => {
    it("setActiveThread updates activeThreadId", () => {
      useThreadStore.getState().setActiveThread("active-thread");

      expect(useThreadStore.getState().activeThreadId).toBe("active-thread");
    });

    it("setActiveThread can set to null", () => {
      useThreadStore.getState().setActiveThread("active-thread");
      useThreadStore.getState().setActiveThread(null);

      expect(useThreadStore.getState().activeThreadId).toBeNull();
    });

    it("setThreadState stores state keyed by threadId", () => {
      const state = {
        messages: [],
        fileChanges: [],
        workingDirectory: "/test",
        status: "running" as const,
        timestamp: Date.now(),
        toolStates: {},
      };

      useThreadStore.getState().setThreadState("state-thread", state);

      expect(useThreadStore.getState().threadStates["state-thread"]).toEqual(state);
    });

    it("setThreadState with null removes state", () => {
      const state = {
        messages: [],
        fileChanges: [],
        workingDirectory: "/test",
        status: "running" as const,
        timestamp: Date.now(),
        toolStates: {},
      };

      useThreadStore.getState().setThreadState("remove-state-thread", state);
      useThreadStore.getState().setThreadState("remove-state-thread", null);

      expect(useThreadStore.getState().threadStates["remove-state-thread"]).toBeUndefined();
    });

    it("getActiveThreadState returns state for active thread", () => {
      const state = {
        messages: [],
        fileChanges: [],
        workingDirectory: "/test",
        status: "running" as const,
        timestamp: Date.now(),
        toolStates: {},
      };

      useThreadStore.getState().setActiveThread("active-state-thread");
      useThreadStore.getState().setThreadState("active-state-thread", state);

      const result = useThreadStore.getState().getActiveThreadState();

      expect(result).toEqual(state);
    });

    it("getActiveThreadState returns undefined when no active thread", () => {
      useThreadStore.getState().setActiveThread(null);

      const result = useThreadStore.getState().getActiveThreadState();

      expect(result).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Loading and Error State Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("loading and error states", () => {
    it("setActiveThreadLoading updates loading state", () => {
      useThreadStore.getState().setActiveThreadLoading(true);

      expect(useThreadStore.getState().activeThreadLoading).toBe(true);
    });

    it("setThreadError stores error keyed by threadId", () => {
      useThreadStore.getState().setThreadError("error-thread", "Test error");

      expect(useThreadStore.getState().threadErrors["error-thread"]).toBe("Test error");
    });

    it("setThreadError with null removes error", () => {
      useThreadStore.getState().setThreadError("clear-error-thread", "Test error");
      useThreadStore.getState().setThreadError("clear-error-thread", null);

      expect(useThreadStore.getState().threadErrors["clear-error-thread"]).toBeUndefined();
    });
  });
});
