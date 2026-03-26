// ============================================================================
// WebSocket Debugger Types
// ============================================================================

export type WsConnectionStatus = "connected" | "disconnected" | "connecting" | "error";

export interface EndpointResult {
  response: unknown;
  status: number;
  at: number;
}

export interface WebSocketDebuggerState {
  port: number | null;
  appSuffix: string | null;
  authToken: string | null;
  connectionStatus: WsConnectionStatus;
  lastHealthCheck: { status: string; port: number; appSuffix: string } | null;
  lastHealthCheckAt: number | null;
  endpointResults: Record<string, EndpointResult>;
}
