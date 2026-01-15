import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type {
  PermissionRequest,
  PermissionStatus,
  PermissionDisplayMode,
} from "@core/types/permissions.js";

interface PermissionStoreState {
  // Pending requests keyed by requestId
  requests: Record<string, PermissionRequest & { status: PermissionStatus }>;

  // Currently focused request index (for keyboard navigation in inline mode)
  focusedIndex: number;

  // Display mode preference
  displayMode: PermissionDisplayMode;
}

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
  getRequestsByThread: (
    threadId: string
  ) => (PermissionRequest & { status: PermissionStatus })[];
  getNextRequestForThread: (
    threadId: string
  ) => (PermissionRequest & { status: PermissionStatus }) | undefined;
  getFocusedRequest: () =>
    | (PermissionRequest & { status: PermissionStatus })
    | undefined;
}

export const usePermissionStore = create<
  PermissionStoreState & PermissionStoreActions
>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  requests: {},
  focusedIndex: 0,
  displayMode: "modal",

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyAddRequest: (request) => {
    const prevState = get();
    set((state) => ({
      requests: {
        ...state.requests,
        [request.requestId]: {
          ...request,
          status: "pending" as PermissionStatus,
        },
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
      const nextFocusedIndex = Math.min(
        state.focusedIndex,
        Math.max(0, pending.length - 1)
      );
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
      const pending = Object.values(remaining).filter(
        (r) => r.status === "pending"
      );
      return {
        requests: remaining,
        focusedIndex: Math.min(state.focusedIndex, Math.max(0, pending.length - 1)),
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Display Mode
  // ═══════════════════════════════════════════════════════════════════════════
  setDisplayMode: (mode) => set({ displayMode: mode }),

  // ═══════════════════════════════════════════════════════════════════════════
  // Focus Management
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════════════════════════
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
}));
