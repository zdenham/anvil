// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { usePermissionStore } from "./store";
import { setupPermissionListeners } from "./listeners";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

describe("Permission Listeners", () => {
  beforeEach(() => {
    // Reset store state
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });

    // Clear all event listeners
    eventBus.all.clear();

    // Setup listeners
    setupPermissionListeners();
  });

  describe("PERMISSION_REQUEST", () => {
    it("adds valid permission request to store", () => {
      const request = {
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        timestamp: Date.now(),
      };

      eventBus.emit(EventName.PERMISSION_REQUEST, request);

      const stored = usePermissionStore.getState().requests["req-1"];
      expect(stored).toBeDefined();
      expect(stored.status).toBe("pending");
      expect(stored.toolName).toBe("Bash");
      expect(stored.threadId).toBe("thread-1");
    });

    it("ignores invalid permission requests", () => {
      const invalidRequest = {
        // Missing required fields
        requestId: "req-1",
      };

      eventBus.emit(EventName.PERMISSION_REQUEST, invalidRequest as any);

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });

    it("handles multiple requests for same thread", () => {
      const now = Date.now();

      eventBus.emit(EventName.PERMISSION_REQUEST, {
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        timestamp: now,
      });

      eventBus.emit(EventName.PERMISSION_REQUEST, {
        requestId: "req-2",
        threadId: "thread-1",
        toolName: "Write",
        toolInput: { file_path: "/tmp/test.txt" },
        timestamp: now + 100,
      });

      const requests = usePermissionStore.getState().requests;
      expect(Object.keys(requests)).toHaveLength(2);
      expect(requests["req-1"]).toBeDefined();
      expect(requests["req-2"]).toBeDefined();
    });
  });

  describe("AGENT_COMPLETED", () => {
    it("clears all requests for completed thread", () => {
      // Add requests for two different threads
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "thread-2",
        toolName: "Read",
        toolInput: {},
        timestamp: 2,
      });

      // Agent for thread-1 completes
      eventBus.emit(EventName.AGENT_COMPLETED, {
        threadId: "thread-1",
        exitCode: 0,
      });

      // thread-1 requests cleared, thread-2 preserved
      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
      expect(usePermissionStore.getState().requests["req-2"]).toBeDefined();
    });
  });

  describe("AGENT_ERROR", () => {
    it("clears all requests for errored thread", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      eventBus.emit(EventName.AGENT_ERROR, {
        threadId: "thread-1",
        error: "Something went wrong",
      });

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });
  });

  describe("Event Flow Integration", () => {
    it("handles full permission lifecycle", () => {
      const threadId = "thread-1";

      // 1. Agent spawned - no requests yet
      expect(
        usePermissionStore.getState().getRequestsByThread(threadId)
      ).toHaveLength(0);

      // 2. Agent requests permission
      eventBus.emit(EventName.PERMISSION_REQUEST, {
        requestId: "req-1",
        threadId,
        toolName: "Bash",
        toolInput: { command: "rm -rf /" },
        timestamp: Date.now(),
      });

      // 3. Request is pending
      const pendingRequests = usePermissionStore
        .getState()
        .getRequestsByThread(threadId);
      expect(pendingRequests).toHaveLength(1);
      expect(pendingRequests[0].status).toBe("pending");

      // 4. Agent completes
      eventBus.emit(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

      // 5. All requests cleared
      expect(
        usePermissionStore.getState().getRequestsByThread(threadId)
      ).toHaveLength(0);
    });

    it("maintains focus index across events", () => {
      // Add multiple requests
      for (let i = 0; i < 3; i++) {
        eventBus.emit(EventName.PERMISSION_REQUEST, {
          requestId: `req-${i}`,
          threadId: "thread-1",
          toolName: "Bash",
          toolInput: {},
          timestamp: i,
        });
      }

      usePermissionStore.setState({ focusedIndex: 2 });

      // Complete the thread
      eventBus.emit(EventName.AGENT_COMPLETED, {
        threadId: "thread-1",
        exitCode: 0,
      });

      // Focus index should be reset to 0 (no requests left)
      expect(usePermissionStore.getState().focusedIndex).toBe(0);
    });
  });
});
