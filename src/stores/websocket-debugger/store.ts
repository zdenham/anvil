import { create } from "zustand";
import { logger } from "@/lib/logger-client";
import { getWsPort, getWsToken, getWsReadyState } from "@/lib/invoke";
import type { WebSocketDebuggerState, WsConnectionStatus } from "./types";

// ============================================================================
// Helpers
// ============================================================================

function readyStateToStatus(state: number): WsConnectionStatus {
  switch (state) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "connected";
    case WebSocket.CLOSING:
      return "disconnected";
    default:
      return "disconnected";
  }
}

function maskToken(token: string): string {
  if (token.length <= 4) return token;
  return token.slice(0, 4) + "••••";
}

// ============================================================================
// Actions Interface
// ============================================================================

interface WebSocketDebuggerActions {
  refresh: () => void;
  checkHealth: () => Promise<void>;
  testEndpoint: (name: string, path: string) => Promise<void>;
  getMaskedToken: () => string | null;
}

// ============================================================================
// Store
// ============================================================================

export const useWebSocketDebuggerStore = create<
  WebSocketDebuggerState & WebSocketDebuggerActions
>((set, get) => ({
  port: null,
  appSuffix: null,
  authToken: null,
  connectionStatus: "disconnected",
  lastHealthCheck: null,
  lastHealthCheckAt: null,
  endpointResults: {},

  refresh: () => {
    const port = getWsPort();
    const token = getWsToken();
    const status = readyStateToStatus(getWsReadyState());
    set({ port, authToken: token, connectionStatus: status });
  },

  checkHealth: async () => {
    const port = get().port ?? getWsPort();
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const data = await res.json();
      const now = Date.now();
      set({
        lastHealthCheck: data,
        lastHealthCheckAt: now,
        appSuffix: data.appSuffix ?? null,
        endpointResults: {
          ...get().endpointResults,
          health: { response: data, status: res.status, at: now },
        },
      });
      logger.info("[ws-debugger] Health check OK");
    } catch (err) {
      const now = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      set({
        lastHealthCheck: null,
        lastHealthCheckAt: now,
        endpointResults: {
          ...get().endpointResults,
          health: { response: { error: message }, status: 0, at: now },
        },
      });
      logger.warn(`[ws-debugger] Health check failed: ${message}`);
    }
  },

  testEndpoint: async (name: string, path: string) => {
    const port = get().port ?? getWsPort();
    try {
      const res = await fetch(`http://localhost:${port}${path}`);
      const data = await res.json();
      const now = Date.now();
      set({
        endpointResults: {
          ...get().endpointResults,
          [name]: { response: data, status: res.status, at: now },
        },
      });
      logger.info(`[ws-debugger] Endpoint "${name}" OK`);
    } catch (err) {
      const now = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      set({
        endpointResults: {
          ...get().endpointResults,
          [name]: { response: { error: message }, status: 0, at: now },
        },
      });
      logger.warn(`[ws-debugger] Endpoint "${name}" failed: ${message}`);
    }
  },

  getMaskedToken: () => {
    const token = get().authToken;
    return token ? maskToken(token) : null;
  },
}));
