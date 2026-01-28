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

describe("useMarkThreadAsRead", () => {
  const mockThreadId = "test-thread-id";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

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
    vi.useRealTimers();
  });

  it("should not mark as read if thread is already read", () => {
    // Create a thread that's already marked as read
    const readThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "idle",
      isRead: true, // Already read
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store and set it as active
    useThreadStore.setState({
      threads: { [mockThreadId]: readThread },
      _threadsArray: [readThread],
      activeThreadId: mockThreadId,
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
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "idle",
      isRead: false, // Not read yet
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store and set it as active
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
      activeThreadId: mockThreadId,
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Should not be called immediately (1 second delay)
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();

    // Advance timer by 1 second
    vi.advanceTimersByTime(1000);

    // Should call markThreadAsRead once because thread is unread
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
    expect(markThreadAsReadSpy).toHaveBeenCalledWith(mockThreadId);
  });

  it("should not cause infinite loop when markThreadAsRead updates the thread", () => {
    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "idle",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store and set it as active
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
      activeThreadId: mockThreadId,
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

    // Advance timer by 1 second to trigger the delayed mark
    vi.advanceTimersByTime(1000);

    // First render should call markThreadAsRead
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);

    // Force a re-render to simulate React re-rendering after state update
    rerender();

    // Advance timer again
    vi.advanceTimersByTime(1000);

    // Should NOT call markThreadAsRead again because thread is now read
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
  });

  it("should mark as read when thread completes and is not already read", () => {
    // Create a completed but unread thread
    const unreadCompletedThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "completed",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store and set it as active
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadCompletedThread },
      _threadsArray: [unreadCompletedThread],
      activeThreadId: mockThreadId,
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: false,
        markOnComplete: true,
      })
    );

    // Should not be called immediately (1 second delay)
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();

    // Advance timer by 1 second
    vi.advanceTimersByTime(1000);

    // Should call markThreadAsRead because thread is completed and unread
    expect(markThreadAsReadSpy).toHaveBeenCalledTimes(1);
    expect(markThreadAsReadSpy).toHaveBeenCalledWith(mockThreadId);
  });

  it("should not mark as read when thread completes but is already read", () => {
    // Create a completed and already read thread
    const readCompletedThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "completed",
      isRead: true, // Already read
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store and set it as active
    useThreadStore.setState({
      threads: { [mockThreadId]: readCompletedThread },
      _threadsArray: [readCompletedThread],
      activeThreadId: mockThreadId,
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
    // Don't add any threads to store, but set activeThreadId
    useThreadStore.setState({
      activeThreadId: "non-existent-thread",
    });

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

  it("should not mark as read when thread is not the active thread", () => {
    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "idle",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store but set a different thread as active
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
      activeThreadId: "different-thread-id", // Not the thread we're testing
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Advance timer by 1 second
    vi.advanceTimersByTime(1000);

    // Should NOT call markThreadAsRead because thread is not active
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });

  it("should not mark as read when activeThreadId is null", () => {
    // Create a thread that's not marked as read
    const unreadThread: ThreadMetadata = {
      id: mockThreadId,
      repoId: "repo-1",
      worktreeId: "worktree-1",
      status: "idle",
      isRead: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
    };

    // Add thread to store but don't set any active thread
    useThreadStore.setState({
      threads: { [mockThreadId]: unreadThread },
      _threadsArray: [unreadThread],
      activeThreadId: null, // No active thread
    });

    // Spy on the store's markThreadAsRead function
    const markThreadAsReadSpy = vi.spyOn(useThreadStore.getState(), "markThreadAsRead");

    renderHook(() =>
      useMarkThreadAsRead(mockThreadId, {
        markOnView: true,
        markOnComplete: false,
      })
    );

    // Advance timer by 1 second
    vi.advanceTimersByTime(1000);

    // Should NOT call markThreadAsRead because no thread is active (panel hidden)
    expect(markThreadAsReadSpy).not.toHaveBeenCalled();
  });
});
