// @vitest-environment node
/**
 * Reconcile Queued Messages Tests
 *
 * Tests that pending queued messages are correctly reconciled when
 * an agent process exits (AGENT_COMPLETED event).
 *
 * With the pinned message flow, queued messages are never appended to
 * state.json — they live exclusively in the queued store until ACK.
 * On exit, pending messages are drained and resent as a new turn.
 *
 * - All pending messages → drained + resent as new turn (no scrub needed)
 * - drainThread is atomic (second call returns empty)
 * - No pending messages → no-op
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ThreadMetadata } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// Mocks — must be declared before vi.mock calls due to hoisting
// ═══════════════════════════════════════════════════════════════════════════

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
    off: vi.fn(),
  },
}));

vi.mock("../service", () => ({
  threadService: {
    refreshById: vi.fn(),
    get: vi.fn(),
    loadThreadState: vi.fn(),
    setStatus: vi.fn(),
    markCancelled: vi.fn(),
  },
}));

vi.mock("@/stores/tree-menu/service", () => ({
  treeMenuService: {
    expandSection: vi.fn(),
  },
}));

const { mockResumeSimpleAgent } = vi.hoisted(() => ({
  mockResumeSimpleAgent: vi.fn(),
}));

vi.mock("@/lib/agent-service", () => ({
  isAgentRunning: vi.fn(() => false),
  sendToAgent: vi.fn(),
  resumeSimpleAgent: mockResumeSimpleAgent,
}));

vi.mock("@/entities/repositories/store", () => ({
  useRepoStore: {
    getState: vi.fn(() => ({
      getRepositoryNames: vi.fn(() => ["test-repo"]),
    })),
  },
}));

vi.mock("@/lib/app-data-store", () => ({
  loadSettings: vi.fn(async () => ({
    id: "repo-1",
    sourcePath: "/projects/test",
    worktrees: [
      { id: "wt-1", path: "/projects/test" },
    ],
  })),
}));

vi.mock("@/entities/threads/utils", () => ({
  deriveWorkingDirectory: vi.fn(() => "/projects/test"),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Imports (after mocks)
// ═══════════════════════════════════════════════════════════════════════════

import { useThreadStore } from "../store";
import { threadService } from "../service";
import { setupThreadListeners } from "../listeners";
import { EventName } from "@core/types/events.js";
import { useQueuedMessagesStore } from "@/stores/queued-messages-store";

function createThreadMetadata(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    repoId: "repo-1",
    worktreeId: "wt-1",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [{ index: 0, prompt: "Test", startedAt: now, completedAt: null }],
    ...overrides,
  };
}

function triggerEvent(eventName: string, payload: any) {
  const handlers = eventHandlers[eventName];
  if (handlers) {
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

describe("reconcile queued messages on AGENT_COMPLETED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }

    // Reset stores
    useThreadStore.setState({
      threads: {},
      _threadsArray: [],
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });
    useQueuedMessagesStore.setState({ messages: {} });

    setupThreadListeners();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("no-ops when there are no pending messages", async () => {
    const threadId = "thread-no-pending";

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockResumeSimpleAgent).not.toHaveBeenCalled();
  });

  it("drains and resends pending message as new turn", async () => {
    const threadId = "thread-in-state";
    const messageId = "msg-pending";
    const thread = createThreadMetadata({ id: threadId });

    // Add pending queued message
    useQueuedMessagesStore.getState().addMessage(threadId, messageId, "Hello");
    expect(useQueuedMessagesStore.getState().isMessagePending(messageId)).toBe(true);

    useThreadStore.setState({
      ...useThreadStore.getState(),
      activeThreadId: threadId,
      threadStates: {
        [threadId]: {
          messages: [],
          fileChanges: [],
          workingDirectory: "/projects/test",
          status: "completed",
          timestamp: Date.now(),
          toolStates: {},
        },
      },
    });

    vi.mocked(threadService.get).mockReturnValue(thread);

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Message should be drained (removed from store)
    expect(useQueuedMessagesStore.getState().isMessagePending(messageId)).toBe(false);
    // Should resend as new turn (no scrub needed — message was never in state.json)
    expect(mockResumeSimpleAgent).toHaveBeenCalledWith(
      threadId,
      "Hello",
      "/projects/test",
    );
  });

  it("resends message not in state.json as new turn", async () => {
    const threadId = "thread-lost-msg";
    const messageId = "msg-not-in-state";
    const thread = createThreadMetadata({ id: threadId });

    // Add pending queued message
    useQueuedMessagesStore.getState().addMessage(threadId, messageId, "Lost message");

    // Thread state has no messages (message was never written to disk)
    useThreadStore.setState({
      ...useThreadStore.getState(),
      activeThreadId: threadId,
      threadStates: {
        [threadId]: {
          messages: [],
          fileChanges: [],
          workingDirectory: "/projects/test",
          status: "completed",
          timestamp: Date.now(),
          toolStates: {},
        },
      },
    });

    vi.mocked(threadService.get).mockReturnValue(thread);

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Message should be removed from store
    expect(useQueuedMessagesStore.getState().isMessagePending(messageId)).toBe(false);
    // Should resend as new turn (no scrub needed)
    expect(mockResumeSimpleAgent).toHaveBeenCalledWith(
      threadId,
      "Lost message",
      "/projects/test",
    );
  });

  it("resends first message in timestamp order when multiple are pending", async () => {
    const threadId = "thread-multi";
    const thread = createThreadMetadata({ id: threadId });

    // Add messages with specific timestamps (out of order)
    useQueuedMessagesStore.setState({
      messages: {
        "msg-2": { id: "msg-2", threadId, content: "Second", timestamp: 2000 },
        "msg-1": { id: "msg-1", threadId, content: "First", timestamp: 1000 },
        "msg-3": { id: "msg-3", threadId, content: "Third", timestamp: 3000 },
      },
    });

    useThreadStore.setState({
      ...useThreadStore.getState(),
      activeThreadId: threadId,
      threadStates: {
        [threadId]: {
          messages: [{ id: "msg-1", role: "user", content: "First" }],
          fileChanges: [],
          workingDirectory: "/projects/test",
          status: "completed",
          timestamp: Date.now(),
          toolStates: {},
        },
      },
    });

    vi.mocked(threadService.get).mockReturnValue(thread);

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // All messages should be drained
    expect(useQueuedMessagesStore.getState().getMessagesForThread(threadId)).toHaveLength(0);

    // Should resend first message by timestamp order (msg-1)
    expect(mockResumeSimpleAgent).toHaveBeenCalledWith(
      threadId,
      "First",
      "/projects/test",
    );
  });

  it("drainThread is atomic — second AGENT_COMPLETED is a no-op", async () => {
    const threadId = "thread-double-fire";
    const thread = createThreadMetadata({ id: threadId });

    useQueuedMessagesStore.getState().addMessage(threadId, "msg-1", "Hello");

    useThreadStore.setState({
      ...useThreadStore.getState(),
      activeThreadId: threadId,
      threadStates: {
        [threadId]: {
          messages: [],
          fileChanges: [],
          workingDirectory: "/projects/test",
          status: "completed",
          timestamp: Date.now(),
          toolStates: {},
        },
      },
    });

    vi.mocked(threadService.get).mockReturnValue(thread);

    // Fire AGENT_COMPLETED twice
    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // resumeSimpleAgent should only be called once (second drain returns empty)
    expect(mockResumeSimpleAgent).toHaveBeenCalledTimes(1);
  });
});
