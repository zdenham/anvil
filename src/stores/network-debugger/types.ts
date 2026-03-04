// ============================================================================
// Network Debugger Types
// ============================================================================

/**
 * Represents a single HTTP request tracked by the network debugger.
 * Built up incrementally from hub messages (request-start, response-headers,
 * response-chunk, response-end, request-error).
 */
export interface NetworkRequest {
  id: string;
  threadId: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  bodySize: number;
  timestamp: number;
  // Filled as response arrives:
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody: string;
  duration?: number;
  responseSize?: number;
  error?: string;
  // Streaming state:
  chunks: number;
  streaming: boolean;
}

export interface NetworkDebuggerState {
  requests: Map<string, NetworkRequest>;
  selectedRequestId: string | null;
  isCapturing: boolean;
  filter: string;
}
