import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarkThreadAsRead } from "./use-mark-thread-as-read";
import { useThreadStore } from "@/entities/threads/store";
import type { ThreadMetadata } from "@/entities/threads/types";

// Mock the logger to avoid console noise
vi.mock("@/lib/logger-client", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the thread service to avoid circular dependencies
vi.mock("@/entities/threads/service", () => ({
  threadService: {
    update: vi.fn(),
  },
}));

// Mock the panel visibility hook to return true by default
vi.mock("./use-panel-visibility", () => ({
  usePanelVisibility: vi.fn(() => true),
}));

describe("useMarkThreadAsRead", () => {
  const mockThreadId = "test-thread-id";

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the store state
    useThreadStore.setState({
      threads: {},
      _threadsArray: [],
      threadStates: {},
      activeThreadId: null,
      activeThreadLoading: false,
      threadErrors: {},
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("should not mark as read if thread is already read", () => {
    // Create a thread that's already marked as read
    const readThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "idle",
      isRead: true, // Already read
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: readThread },
      _threadsArray: [readThread],
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Should NOT call markThreadAsRead because thread is already read
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });

  it("should mark as read when thread is viewed and not already read", () => {
    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "idle",
      isRead: false, // Not read yet
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Should call markThreadAsRead once because thread is unread
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
    expect(markThreadAsReadSpy).toHaveBeenCalledWith(mockThreadId);
  });

  it("should not cause infinite loop when markThreadAsRead updates the thread", () => {
    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "idle",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
    });

    // Spy on the store's markThreadAsRead function and simulate state update
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");
    markThreadAsReadSpy.mockImplementation((threadId: string) => {
      // Simulate what the real markThreadAsRead does - update the thread state
      const currentState = useThreadStore.getState();
      const thread = currentState.threads[threadId];
      if (thread) {
        const updatedThread = { ...thread, isRead: true };
        useThreadStore.setState({
          threads: {
            ...currentState.threads,
            [threadId]: updatedThread,
          },
          _threadsArray: Object.values({
            ...currentState.threads,
            [threadId]: updatedThread,
          }),
        });
      }
    });

    const { rerender } = renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // First render should call markThreadAsRead
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);

    // Force a re-render to simulate React re-rendering after state update
    rerender();

    // Should NOT call markThreadAsRead again because thread is now read
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
  });

  it("should mark as read when thread completes and is not already read", () => {
    // Create a completed but unread thread
    const unreadCompletedThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "completed",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadCompletedThread },
      _threadsArray: [unreadCompletedThread],
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: false,
        markOnComplete: true,
      })
    );

    // Should call markThreadAsRead because thread is completed and unread
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
    expect(markThreadAsReadSpy).toHaveBeenCalledWith(mockThreadId);
  });

  it("should not mark as read when thread completes but is already read", () => {
    // Create a completed and already read thread
    const readCompletedThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "completed",
      isRead: true, // Already read
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: readCompletedThread },
      _threadsArray: [readCompletedThread],
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: false,
        markOnComplete: true,
      })
    );

    // Should NOT call markThreadAsRead because thread is already read
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });

  it("should not mark as read when threadId is null", () => {
    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(null, {
        markOnView: true,
        markOnComplete: true,
      })
    );

    // Should NOT call markThreadAsRead when threadId is null
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });

  it("should not mark as read when thread does not exist in store", () => {
    // Don't add any threads to store

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead("non-existent-thread", {
        markOnView: true,
        markOnComplete: true,
      })
    );

    // Should NOT call markThreadAsRead when thread doesn't exist
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });

  it("should not mark as read when no panel is visible", async () => {
    const { usePanelVisibility } = await import("./use-panel-visibility");
    // Mock panel visibility to return false
    vi.mocked(usePanelVisibility).mockReturnValue(false);

    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      taskId: "task-1",
      agentType: "simple",
      status: "idle",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory: "/test",
      turns: [],
    };

    // Add thread to store
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Should NOT call markThreadAsRead because no panel is visible
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });
});