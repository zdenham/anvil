/**
 * Base message structure for all socket communication.
 */
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  [key: string]: unknown;
}

export interface RegisterMessage extends SocketMessage {
  type: "register";
  parentId?: string;
}

export interface StateMessage extends SocketMessage {
  type: "state";
  state: unknown;
}

export interface EventMessage extends SocketMessage {
  type: "event";
  name: string;
  payload: unknown;
}

export interface LogMessage extends SocketMessage {
  type: "log";
  level: string;
  message: string;
}

export type TauriToAgentMessage =
  | { type: "permission_response"; payload: { requestId: string; decision: string } }
  | { type: "queued_message"; payload: { content: string } }
  | { type: "cancel" };
