// @vitest-environment node
/**
 * Thread Listeners Tests
 *
 * Tests for setupThreadListeners including:
 * - Disk-as-truth pattern (refresh on events)
 * - THREAD_ARCHIVED handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// Create mock event handlers storage
const eventHandlers: Record<string, ((...args: any[]) => void)[]> = {};

vi.mock("@/entities/events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn((eventName: string, handler: (...args: any[]) => void) => {
      if (!eventHandlers[eventName]) {
        eventHandlers[eventName] = [];
      }
      eventHandlers[eventName].push(handler);
    }),
  },
}));

vi.mock("../service", () => ({
  threadService: {
    refreshById: vi.fn(),
    get: vi.fn(),
    loadThreadState: vi.fn(),
  },
}));

vi.mock("@/stores/tree-menu/service", () => ({
  treeMenuService: {
    expandSection: vi.fn(),
  },
}));

// Import after mocks are set up
import { useThreadStore } from "../store";
import { threadService } from "../service";
import { treeMenuService } from "@/stores/tree-menu/service";
import { eventBus } from "@/entities/events";
import { setupThreadListeners } from "../listeners";
import { EventName } from "@core/types/events.js";

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

// Helper to trigger an event handler
function triggerEvent(eventName: string, payload: any) {
  const handlers = eventHandlers[eventName];
  if (handlers) {
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

describe("setupThreadListeners", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clear event handlers
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }

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

    // Setup listeners
    setupThreadListeners();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Disk-as-truth pattern tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("disk-as-truth pattern", () => {
    it("THREAD_CREATED event triggers refresh of thread from disk", async () => {
      const threadId = "created-thread";

      triggerEvent(EventName.THREAD_CREATED, { threadId, repoId: "repo-1", worktreeId: "wt-1" });

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
    });

    it("THREAD_UPDATED event triggers refresh of thread from disk", async () => {
      const threadId = "updated-thread";

      triggerEvent(EventName.THREAD_UPDATED, { threadId });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
    });

    it("THREAD_STATUS_CHANGED event triggers refresh of thread from disk", async () => {
      const threadId = "status-changed-thread";

      // Mock threadService.get to return a non-running thread
      vi.mocked(threadService.get).mockReturnValue(
        createThreadMetadata({ id: threadId, status: "completed" })
      );

      triggerEvent(EventName.THREAD_STATUS_CHANGED, { threadId, status: "completed" });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD_ARCHIVED handler tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THREAD_ARCHIVED event", () => {
    it("removes thread from store", () => {
      const threadId = "archived-thread";
      const thread = createThreadMetadata({ id: threadId });

      // Add thread to store first
      useThreadStore.getState()._applyCreate(thread);
      expect(useThreadStore.getState().threads[threadId]).toBeDefined();

      // Trigger archive event
      triggerEvent(EventName.THREAD_ARCHIVED, { threadId });

      // Thread should be removed from store
      expect(useThreadStore.getState().threads[threadId]).toBeUndefined();
    });

    it("handles non-existent thread gracefully", () => {
      const threadId = "nonexistent-thread";

      // Should not throw
      expect(() => {
        triggerEvent(EventName.THREAD_ARCHIVED, { threadId });
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // THREAD_ACTION event tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("THREAD_ACTION event", () => {
    it("dispatches action to thread store", () => {
      const threadId = "action-thread";
      useThreadStore.getState().setActiveThread(threadId);

      triggerEvent(EventName.THREAD_ACTION, {
        threadId,
        action: { type: "INIT", payload: { workingDirectory: "/project" } },
      });

      const state = useThreadStore.getState().threadStates[threadId];
      expect(state).toBeDefined();
      expect(state?.status).toBe("running");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT_COMPLETED event tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AGENT_COMPLETED event", () => {
    it("always refreshes metadata", async () => {
      const threadId = "completed-thread";

      triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
    });

    it("refreshes state only if thread is active", async () => {
      const threadId = "completed-active-thread";

      // Set as active thread
      useThreadStore.getState().setActiveThread(threadId);

      triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.loadThreadState).toHaveBeenCalledWith(threadId);
    });

    it("does not refresh state if thread is not active", async () => {
      const threadId = "completed-inactive-thread";
      const otherThreadId = "other-thread";

      // Set different thread as active
      useThreadStore.getState().setActiveThread(otherThreadId);

      triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // refreshById is always called
      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
      // but loadThreadState should not be called for inactive thread
      expect(threadService.loadThreadState).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // No disk reads during streaming
  // ═══════════════════════════════════════════════════════════════════════════

  describe("no disk reads during streaming", () => {
    it("THREAD_ACTION does not call refreshById or loadThreadState", () => {
      const threadId = "streaming-thread";
      useThreadStore.getState().setActiveThread(threadId);

      triggerEvent(EventName.THREAD_ACTION, {
        threadId,
        action: { type: "INIT", payload: { workingDirectory: "/tmp" } },
      });

      expect(threadService.refreshById).not.toHaveBeenCalled();
      expect(threadService.loadThreadState).not.toHaveBeenCalled();
    });

    it("AGENT_COMPLETED still reads from disk", async () => {
      const threadId = "completed-disk-thread";
      useThreadStore.getState().setActiveThread(threadId);

      triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
      expect(threadService.loadThreadState).toHaveBeenCalledWith(threadId);
    });

    it("syncs usage from ThreadState into metadata store via THREAD_ACTION", () => {
      const threadId = "usage-sync-thread";
      const thread = createThreadMetadata({ id: threadId });
      useThreadStore.getState()._applyCreate(thread);
      useThreadStore.getState().setActiveThread(threadId);

      // Dispatch INIT followed by UPDATE_USAGE
      triggerEvent(EventName.THREAD_ACTION, {
        threadId,
        action: { type: "INIT", payload: { workingDirectory: "/tmp" } },
      });

      triggerEvent(EventName.THREAD_ACTION, {
        threadId,
        action: {
          type: "UPDATE_USAGE",
          payload: {
            usage: {
              inputTokens: 1000,
              outputTokens: 500,
              cacheCreationTokens: 0,
              cacheReadTokens: 200,
            },
          },
        },
      });

      // Usage should be synced to thread metadata (not via disk read)
      const updatedThread = useThreadStore.getState().threads[threadId];
      expect(updatedThread.cumulativeUsage).toBeDefined();
      expect(updatedThread.cumulativeUsage?.inputTokens).toBe(1000);
      expect(threadService.refreshById).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REPL child auto-expand tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("REPL child auto-expand", () => {
    it("expands parent sidebar item when REPL child is spawned", async () => {
      const childId = "child-thread";
      const parentId = "parent-thread";

      vi.mocked(threadService.get).mockReturnValue(
        createThreadMetadata({ id: childId, parentThreadId: parentId }),
      );

      triggerEvent(EventName.THREAD_CREATED, {
        threadId: childId,
        repoId: "repo-1",
        worktreeId: "wt-1",
        source: "anvil-repl:child-spawn",
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(childId);
      expect(treeMenuService.expandSection).toHaveBeenCalledWith(`thread:${parentId}`);
    });

    it("does not expand when source is not anvil-repl:child-spawn", async () => {
      const childId = "child-thread-2";

      triggerEvent(EventName.THREAD_CREATED, {
        threadId: childId,
        repoId: "repo-1",
        worktreeId: "wt-1",
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(threadService.refreshById).toHaveBeenCalledWith(childId);
      expect(treeMenuService.expandSection).not.toHaveBeenCalled();
    });

    it("does not expand when thread has no parentThreadId", async () => {
      const childId = "orphan-thread";

      vi.mocked(threadService.get).mockReturnValue(
        createThreadMetadata({ id: childId }),
      );

      triggerEvent(EventName.THREAD_CREATED, {
        threadId: childId,
        repoId: "repo-1",
        worktreeId: "wt-1",
        source: "anvil-repl:child-spawn",
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(treeMenuService.expandSection).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Removal verification tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe("removal verification", () => {
    it("no listeners reference task-related events", () => {
      // Get all registered event names
      const registeredEvents = Object.keys(eventHandlers);

      // None should contain "task"
      const taskEvents = registeredEvents.filter((name) =>
        name.toLowerCase().includes("task")
      );

      expect(taskEvents).toEqual([]);
    });
  });
});
