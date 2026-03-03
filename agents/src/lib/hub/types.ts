import type { PipelineStamp } from "@core/types/pipeline.js";
import type { Operation } from "fast-json-patch";

/**
 * Base message structure for all socket communication.
 */
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  /** Pipeline stamps for end-to-end delivery tracking */
  pipeline?: PipelineStamp[];
  /** Origin within the agent runner, e.g. "shared:PreToolUse", "PostToolUse:plan-detection" */
  source?: string;
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

/**
 * Application-level state event for patch-based state emission.
 * Contains JSON Patch diffs and event chain IDs for gap detection.
 * `threadId` is stamped by HubClient.send(), so not required here.
 */
export interface StateEvent {
  id: string;
  previousEventId: string | null;
  patches: Operation[];
  /** Full state snapshot — included when previousEventId is null (first emit or resync). */
  full?: unknown;
}

/**
 * Wire format for state events sent over the socket.
 * Extends SocketMessage (which adds threadId, senderId, pipeline).
 */
export interface StateEventMessage extends SocketMessage {
  type: "state_event";
  id: string;
  previousEventId: string | null;
  patches: Operation[];
  full?: unknown;
}

export type TauriToAgentMessage =
  | { type: "permission_response"; payload: { requestId: string; decision: string; reason?: string } }
  | { type: "permission_mode_changed"; payload: { modeId: string } }
  | { type: "question_response"; payload: { requestId: string; answers: Record<string, string> } }
  | { type: "queued_message"; payload: { content: string } }
  | { type: "diagnostic_config"; payload: { pipeline: boolean; heartbeat: boolean; sequenceGaps: boolean; socketHealth: boolean } }
  | { type: "question_cancelled"; payload: { requestId: string } }
  | { type: "cancel" };
