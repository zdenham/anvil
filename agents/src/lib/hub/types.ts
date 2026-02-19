import type { PipelineStamp } from "@core/types/pipeline.js";

/**
 * Base message structure for all socket communication.
 */
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  /** Pipeline stamps for end-to-end delivery tracking */
  pipeline?: PipelineStamp[];
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

export interface RelayMessage extends SocketMessage {
  type: "relay";
  targetThreadId: string;
  payload: Record<string, unknown>;
}

export interface DrainMessage extends SocketMessage {
  type: "drain";
  event: string;
  properties: Record<string, string | number | boolean>;
}

export interface HeartbeatMessage extends SocketMessage {
  type: "heartbeat";
  timestamp: number;
}

export type TauriToAgentMessage =
  | { type: "permission_response"; payload: { requestId: string; decision: string; reason?: string } }
  | { type: "permission_mode_changed"; payload: { modeId: string } }
  | { type: "queued_message"; payload: { content: string } }
  | { type: "diagnostic_config"; payload: { pipeline: boolean; heartbeat: boolean; sequenceGaps: boolean; socketHealth: boolean } }
  | { type: "cancel" };
