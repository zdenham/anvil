import { create } from "zustand";
import { logger } from "@/lib/logger-client";
import type { NetworkRequest, NetworkDebuggerState } from "./types";

// ============================================================================
// Constants
// ============================================================================

const MAX_REQUESTS = 500;

// ============================================================================
// Actions Interface
// ============================================================================

interface NetworkDebuggerActions {
  handleRequestStart: (msg: Record<string, unknown>) => void;
  handleResponseHeaders: (msg: Record<string, unknown>) => void;
  handleResponseChunk: (msg: Record<string, unknown>) => void;
  handleResponseEnd: (msg: Record<string, unknown>) => void;
  handleRequestError: (msg: Record<string, unknown>) => void;
  toggleCapture: () => void;
  clearRequests: () => void;
  setFilter: (filter: string) => void;
  selectRequest: (id: string | null) => void;
  filteredRequests: () => NetworkRequest[];
}

// ============================================================================
// Helpers
// ============================================================================

function evictOldest(requests: Map<string, NetworkRequest>): Map<string, NetworkRequest> {
  if (requests.size <= MAX_REQUESTS) return requests;
  const next = new Map(requests);
  const firstKey = next.keys().next().value;
  if (firstKey !== undefined) {
    next.delete(firstKey);
  }
  return next;
}

// ============================================================================
// Store
// ============================================================================

export const useNetworkDebuggerStore = create<
  NetworkDebuggerState & NetworkDebuggerActions
>((set, get) => ({
  requests: new Map(),
  selectedRequestId: null,
  isCapturing: false,
  filter: "",

  handleRequestStart: (msg: Record<string, unknown>) => {
    const state = get();
    if (!state.isCapturing) return;

    const request: NetworkRequest = {
      id: String(msg.requestId ?? ""),
      threadId: String(msg.threadId ?? msg.senderId ?? ""),
      url: String(msg.url ?? ""),
      method: String(msg.method ?? "GET"),
      requestHeaders: (msg.headers as Record<string, string>) ?? {},
      requestBody: (msg.body as string) ?? null,
      bodySize: Number(msg.bodySize ?? 0),
      timestamp: Number(msg.timestamp ?? Date.now()),
      responseBody: "",
      chunks: 0,
      streaming: true,
    };

    set((prev) => {
      const next = new Map(prev.requests);
      next.set(request.id, request);
      return { requests: evictOldest(next) };
    });
  },

  handleResponseHeaders: (msg: Record<string, unknown>) => {
    const requestId = String(msg.requestId ?? "");
    set((prev) => {
      const existing = prev.requests.get(requestId);
      if (!existing) return prev;

      const next = new Map(prev.requests);
      next.set(requestId, {
        ...existing,
        status: Number(msg.status ?? 0),
        statusText: String(msg.statusText ?? ""),
        responseHeaders: (msg.headers as Record<string, string>) ?? {},
        duration: Number(msg.duration ?? 0),
      });
      return { requests: next };
    });
  },

  handleResponseChunk: (msg: Record<string, unknown>) => {
    const requestId = String(msg.requestId ?? "");
    set((prev) => {
      const existing = prev.requests.get(requestId);
      if (!existing) return prev;

      const next = new Map(prev.requests);
      next.set(requestId, {
        ...existing,
        responseBody: existing.responseBody + String(msg.content ?? ""),
        chunks: existing.chunks + 1,
        responseSize: Number(msg.totalSize ?? existing.responseSize ?? 0),
      });
      return { requests: next };
    });
  },

  handleResponseEnd: (msg: Record<string, unknown>) => {
    const requestId = String(msg.requestId ?? "");
    set((prev) => {
      const existing = prev.requests.get(requestId);
      if (!existing) return prev;

      const next = new Map(prev.requests);
      next.set(requestId, {
        ...existing,
        streaming: false,
        responseSize: Number(msg.bodySize ?? existing.responseSize ?? 0),
      });
      return { requests: next };
    });
  },

  handleRequestError: (msg: Record<string, unknown>) => {
    const requestId = String(msg.requestId ?? "");
    set((prev) => {
      const existing = prev.requests.get(requestId);
      if (!existing) return prev;

      const next = new Map(prev.requests);
      next.set(requestId, {
        ...existing,
        error: String(msg.error ?? "Unknown error"),
        streaming: false,
        duration: Number(msg.duration ?? existing.duration ?? 0),
      });
      return { requests: next };
    });
  },

  toggleCapture: () => {
    const next = !get().isCapturing;
    logger.info(`[network-debugger] Capture ${next ? "started" : "stopped"}`);
    set({ isCapturing: next });
  },

  clearRequests: () => {
    logger.info("[network-debugger] Requests cleared");
    set({ requests: new Map(), selectedRequestId: null });
  },

  setFilter: (filter: string) => {
    set({ filter });
  },

  selectRequest: (id: string | null) => {
    set({ selectedRequestId: id });
  },

  filteredRequests: () => {
    const state = get();
    const { filter } = state;
    const all = Array.from(state.requests.values());

    if (!filter) return all;

    const lower = filter.toLowerCase();
    return all.filter((req) => req.url.toLowerCase().includes(lower));
  },
}));
