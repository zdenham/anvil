# Sub-Plan 02: Zustand Permission Store

## Scope

Create the Zustand store for managing permission request state in the frontend.

## Dependencies

- **01-core-types.md** - Requires `PermissionRequest`, `PermissionStatus`, `PermissionDisplayMode` types

## Files to Create

### `src/entities/permissions/types.ts` (~10 lines)

Re-export types from core for convenience:
```typescript
export type {
  PermissionRequest,
  PermissionStatus,
  PermissionDecision,
  PermissionResponse,
  PermissionMode,
  PermissionDisplayMode,
} from "@core/types/permissions.js";

export { isDangerousTool, isWriteTool } from "@core/types/permissions.js";
```

### `src/entities/permissions/store.ts` (~120 lines)

```typescript
import { create } from "zustand";
import type { PermissionRequest, PermissionStatus, PermissionDisplayMode } from "@core/types/permissions.js";

interface PermissionStoreState {
  // Pending requests keyed by requestId
  requests: Record<string, PermissionRequest & { status: PermissionStatus }>;

  // Currently focused request index (for keyboard navigation in inline mode)
  focusedIndex: number;

  // Display mode preference
  displayMode: PermissionDisplayMode;
}

type Rollback = () => void;

interface PermissionStoreActions {
  // Add a new pending request (returns rollback function per entity-stores pattern)
  _applyAddRequest: (request: PermissionRequest) => Rollback;

  // Update request status
  _applyUpdateStatus: (requestId: string, status: PermissionStatus) => Rollback;

  // Remove a request (after response sent)
  _applyRemoveRequest: (requestId: string) => Rollback;

  // Clear all requests for a thread (on agent complete/error)
  _applyClearThread: (threadId: string) => void;

  // Display mode
  setDisplayMode: (mode: PermissionDisplayMode) => void;

  // Focus management (for inline mode keyboard nav)
  setFocusedIndex: (index: number) => void;
  focusNext: () => void;
  focusPrev: () => void;

  // Selectors
  getPendingRequests: () => (PermissionRequest & { status: PermissionStatus })[];
  getRequestsByThread: (threadId: string) => (PermissionRequest & { status: PermissionStatus })[];
  getNextRequestForThread: (threadId: string) => (PermissionRequest & { status: PermissionStatus }) | undefined;
  getFocusedRequest: () => (PermissionRequest & { status: PermissionStatus }) | undefined;
}

export const usePermissionStore = create<PermissionStoreState & PermissionStoreActions>(
  (set, get) => ({
    requests: {},
    focusedIndex: 0,
    displayMode: "modal",

    _applyAddRequest: (request) => {
      const prevState = get();
      set((state) => ({
        requests: {
          ...state.requests,
          [request.requestId]: { ...request, status: "pending" as PermissionStatus },
        },
      }));
      return () => set({ requests: prevState.requests });
    },

    _applyUpdateStatus: (requestId, status) => {
      const prevState = get();
      const request = prevState.requests[requestId];
      if (!request) return () => {};
      set((state) => ({
        requests: {
          ...state.requests,
          [requestId]: { ...request, status },
        },
      }));
      return () => set({ requests: prevState.requests });
    },

    _applyRemoveRequest: (requestId) => {
      const prevState = get();
      const removedRequest = prevState.requests[requestId];
      set((state) => {
        const { [requestId]: _, ...rest } = state.requests;
        const pending = Object.values(rest).filter((r) => r.status === "pending");
        const nextFocusedIndex = Math.min(state.focusedIndex, Math.max(0, pending.length - 1));
        return { requests: rest, focusedIndex: nextFocusedIndex };
      });
      return () => {
        if (removedRequest) {
          set((state) => ({
            requests: { ...state.requests, [requestId]: removedRequest },
            focusedIndex: prevState.focusedIndex,
          }));
        }
      };
    },

    _applyClearThread: (threadId) => {
      set((state) => {
        const remaining: typeof state.requests = {};
        for (const [id, req] of Object.entries(state.requests)) {
          if (req.threadId !== threadId) {
            remaining[id] = req;
          }
        }
        const pending = Object.values(remaining).filter((r) => r.status === "pending");
        return {
          requests: remaining,
          focusedIndex: Math.min(state.focusedIndex, Math.max(0, pending.length - 1)),
        };
      });
    },

    setDisplayMode: (mode) => set({ displayMode: mode }),
    setFocusedIndex: (index) => set({ focusedIndex: index }),

    focusNext: () => {
      const pending = get().getPendingRequests();
      if (pending.length === 0) return;
      set((state) => ({
        focusedIndex: Math.min(state.focusedIndex + 1, pending.length - 1),
      }));
    },

    focusPrev: () => {
      set((state) => ({
        focusedIndex: Math.max(state.focusedIndex - 1, 0),
      }));
    },

    getPendingRequests: () =>
      Object.values(get().requests)
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.timestamp - b.timestamp),

    getRequestsByThread: (threadId) =>
      Object.values(get().requests)
        .filter((r) => r.threadId === threadId)
        .sort((a, b) => a.timestamp - b.timestamp),

    getNextRequestForThread: (threadId) => {
      const requests = get().getRequestsByThread(threadId);
      return requests.find((r) => r.status === "pending");
    },

    getFocusedRequest: () => {
      const pending = get().getPendingRequests();
      return pending[get().focusedIndex];
    },
  })
);
```

### `src/entities/permissions/store.test.ts`

Test code from main plan's "Test 1: Permission Store" section (see `plans/ui-elements/permission-ui.md` lines 1216-1405):

```typescript
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
      const request = { requestId: "req-1", threadId: "t1", toolName: "Bash", toolInput: {}, timestamp: 1 };
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

      expect(usePermissionStore.getState().requests["req-1"].status).toBe("approved");
    });

    it("returns rollback function", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      const rollback = usePermissionStore.getState()._applyUpdateStatus("req-1", "denied");
      expect(usePermissionStore.getState().requests["req-1"].status).toBe("denied");

      rollback();
      expect(usePermissionStore.getState().requests["req-1"].status).toBe("pending");
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
```

## Verification

```bash
pnpm tsc --noEmit
pnpm test -- src/entities/permissions/store
```

## Estimated Time

30-40 minutes

## Notes

- Follows entity-stores pattern with `_apply*` methods returning rollback functions
- Store is keyed by `requestId` for O(1) lookups
- Focus management supports vim-style keyboard navigation
