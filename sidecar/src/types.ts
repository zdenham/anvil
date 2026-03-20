/**
 * WebSocket protocol types for the sidecar server.
 *
 * Protocol: JSON messages with `{id, cmd, args}` request / `{id, result?, error?}` response.
 * Push events: `{event, payload}` (no id).
 * Relay events: `{relay: true, event, payload}` (client-initiated broadcast).
 */

export interface WsRequest {
  id: number;
  cmd: string;
  args: Record<string, unknown>;
}

export interface WsResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export interface WsPushEvent {
  event: string;
  payload: unknown;
}

export interface WsRelayMessage {
  relay: true;
  event: string;
  payload: unknown;
}

export type WsIncoming = WsRequest | WsRelayMessage;

export function isRelayMessage(msg: unknown): msg is WsRelayMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "relay" in msg &&
    (msg as WsRelayMessage).relay === true
  );
}

export function isRequest(msg: unknown): msg is WsRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    "cmd" in msg &&
    typeof (msg as WsRequest).id === "number" &&
    typeof (msg as WsRequest).cmd === "string"
  );
}
