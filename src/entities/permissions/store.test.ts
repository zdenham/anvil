import { describe, it, expect, beforeEach } from "vitest";
import { usePermissionStore } from "./store";

describe("PermissionStore", () => {
  beforeEach(() => {
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });
  });

  describe("_applyAddRequest", () => {
    it("adds request with pending status", () => {
      const request = {
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        timestamp: Date.now(),
      };

      usePermissionStore.getState()._applyAddRequest(request);

      const stored = usePermissionStore.getState().requests["req-1"];
      expect(stored).toBeDefined();
      expect(stored.status).toBe("pending");
    });

    it("returns rollback function that restores previous state", () => {
      const request = {
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      };
      const rollback = usePermissionStore.getState()._applyAddRequest(request);

      expect(usePermissionStore.getState().requests["req-1"]).toBeDefined();

      rollback();

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });
  });

  describe("_applyUpdateStatus", () => {
    it("updates existing request status", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      usePermissionStore.getState()._applyUpdateStatus("req-1", "approved");

      expect(usePermissionStore.getState().requests["req-1"].status).toBe(
        "approved"
      );
    });

    it("returns rollback function", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      const rollback = usePermissionStore
        .getState()
        ._applyUpdateStatus("req-1", "denied");
      expect(usePermissionStore.getState().requests["req-1"].status).toBe(
        "denied"
      );

      rollback();
      expect(usePermissionStore.getState().requests["req-1"].status).toBe(
        "pending"
      );
    });
  });

  describe("_applyRemoveRequest", () => {
    it("removes request from map", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      usePermissionStore.getState()._applyRemoveRequest("req-1");

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });

    it("adjusts focus index when removing requests", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "t1",
        toolName: "Read",
        toolInput: {},
        timestamp: 2,
      });
      usePermissionStore.setState({ focusedIndex: 1 });

      usePermissionStore.getState()._applyRemoveRequest("req-2");

      expect(usePermissionStore.getState().focusedIndex).toBe(0);
    });
  });

  describe("getPendingRequests", () => {
    it("returns only pending requests sorted by timestamp", () => {
      const now = Date.now();
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "t1",
        toolName: "Write",
        toolInput: {},
        timestamp: now + 100,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Edit",
        toolInput: {},
        timestamp: now,
      });
      usePermissionStore.getState()._applyUpdateStatus("req-2", "approved");

      const pending = usePermissionStore.getState().getPendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe("req-1");
    });
  });

  describe("focus navigation", () => {
    it("focusNext increments within bounds", () => {
      for (let i = 0; i < 3; i++) {
        usePermissionStore.getState()._applyAddRequest({
          requestId: `req-${i}`,
          threadId: "t1",
          toolName: "Write",
          toolInput: {},
          timestamp: i,
        });
      }

      usePermissionStore.getState().focusNext();
      expect(usePermissionStore.getState().focusedIndex).toBe(1);

      usePermissionStore.getState().focusNext();
      usePermissionStore.getState().focusNext();
      expect(usePermissionStore.getState().focusedIndex).toBe(2); // Clamped
    });

    it("focusPrev decrements within bounds", () => {
      usePermissionStore.setState({ focusedIndex: 1 });
      usePermissionStore.getState().focusPrev();
      expect(usePermissionStore.getState().focusedIndex).toBe(0);

      usePermissionStore.getState().focusPrev();
      expect(usePermissionStore.getState().focusedIndex).toBe(0); // Clamped
    });
  });

  describe("_applyClearThread", () => {
    it("removes only requests for specified thread", () => {
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

      usePermissionStore.getState()._applyClearThread("thread-1");

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
      expect(usePermissionStore.getState().requests["req-2"]).toBeDefined();
    });
  });
});
