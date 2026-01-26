import type { ThreadStatus } from "./threads.js";
import type { RelationType } from "./relations.js";
import { z } from "zod";

// WorktreeState is defined in src/entities/repositories/types.ts
// We inline the essential fields here to avoid cross-package import issues
// between agents (Node) and frontend (Tauri) packages.

/**
 * Worktree state for event payloads.
 * Simplified version of the full WorktreeState from repositories/types.ts.
 */
export const WorktreeStatePayloadSchema = z.object({
  /** Absolute path to the worktree directory */
  path: z.string(),
  /** Currently checked out branch, or null */
  currentBranch: z.string().nullable(),
});
export type WorktreeStatePayload = z.infer<typeof WorktreeStatePayloadSchema>;

// ============================================================================
// Thread Status (subset used by agent output)
// ============================================================================

/**
 * Thread status values used in agent state emissions.
 *
 * NOTE: This uses "complete" (not "completed") to match the existing agent
 * output protocol. The frontend ThreadStatus uses "completed", so conversions
 * may be needed when mapping between agent state and thread metadata.
 *
 * The full ThreadStatus is: "idle" | "running" | "completed" | "error" | "paused"
 * AgentThreadStatus excludes "idle" and "paused" (no agent running) and uses
 * "complete" instead of "completed" for backwards compatibility with agent output.
 */
export const AgentThreadStatusSchema = z.enum(["running", "complete", "error", "cancelled"]);
export type AgentThreadStatus = z.infer<typeof AgentThreadStatusSchema>;

// ============================================================================
// Event Names
// ============================================================================

/**
 * All event names in the system.
 * Used by both Node agent (emission) and Tauri (consumption).
 */
export const EventName = {
  // Thread lifecycle
  THREAD_CREATED: "thread:created",
  THREAD_UPDATED: "thread:updated",
  THREAD_STATUS_CHANGED: "thread:status-changed",
  THREAD_ARCHIVED: "thread:archived",
  THREAD_FILE_CREATED: "thread:file-created",
  THREAD_FILE_MODIFIED: "thread:file-modified",

  // Agent process
  AGENT_SPAWNED: "agent:spawned",
  AGENT_STATE: "agent:state",
  AGENT_COMPLETED: "agent:completed",
  AGENT_ERROR: "agent:error",
  AGENT_TOOL_COMPLETED: "agent:tool-completed",
  AGENT_CANCELLED: "agent:cancelled",

  // Orchestration
  WORKTREE_ALLOCATED: "worktree:allocated",
  WORKTREE_RELEASED: "worktree:released",

  // Repository
  REPOSITORY_CREATED: "repository:created",
  REPOSITORY_UPDATED: "repository:updated",
  REPOSITORY_DELETED: "repository:deleted",

  // User interaction
  ACTION_REQUESTED: "action-requested",

  // Settings
  SETTINGS_UPDATED: "settings:updated",

  // Permission flow
  PERMISSION_REQUEST: "permission:request",
  PERMISSION_RESPONSE: "permission:response",

  // Queued message acknowledgement
  QUEUED_MESSAGE_ACK: "queued-message:ack",

  // Plan lifecycle
  PLAN_DETECTED: "plan:detected",
  PLAN_CREATED: "plan:created",
  PLAN_UPDATED: "plan:updated",
  PLAN_ARCHIVED: "plan:archived",

  // Relation lifecycle
  RELATION_CREATED: "relation:created",
  RELATION_UPDATED: "relation:updated",

  // User events
  USER_MESSAGE_SENT: "user:message-sent",
} as const;

export type EventNameType = (typeof EventName)[keyof typeof EventName];

// ============================================================================
// Event Payloads
// ============================================================================

/**
 * Payload types for each event.
 * Ensures type safety on both emit and consume sides.
 */
export interface EventPayloads {
  // Thread events
  [EventName.THREAD_CREATED]: { threadId: string; repoId: string; worktreeId: string };
  [EventName.THREAD_UPDATED]: { threadId: string };
  [EventName.THREAD_STATUS_CHANGED]: { threadId: string; status: ThreadStatus };
  [EventName.THREAD_ARCHIVED]: { threadId: string; originInstanceId?: string | null };
  [EventName.THREAD_FILE_CREATED]: { threadId: string; filePath: string };
  [EventName.THREAD_FILE_MODIFIED]: { threadId: string; filePath: string };

  // Agent events
  [EventName.AGENT_SPAWNED]: { threadId: string; repoId: string };
  [EventName.AGENT_STATE]: { threadId: string; state: ThreadState };
  [EventName.AGENT_COMPLETED]: { threadId: string; exitCode: number; costUsd?: number };
  [EventName.AGENT_ERROR]: { threadId: string; error: string };
  [EventName.AGENT_TOOL_COMPLETED]: { threadId: string; repoId: string };
  [EventName.AGENT_CANCELLED]: { threadId: string };

  // Orchestration events
  [EventName.WORKTREE_ALLOCATED]: { worktree: WorktreeStatePayload; mergeBase: string };
  [EventName.WORKTREE_RELEASED]: { threadId: string };

  // Repository events
  [EventName.REPOSITORY_CREATED]: { name: string };
  [EventName.REPOSITORY_UPDATED]: { name: string };
  [EventName.REPOSITORY_DELETED]: { name: string };

  // User interaction
  [EventName.ACTION_REQUESTED]: {
    threadId: string;
    markdown: string;
    defaultResponse: string;
  };

  // Settings
  [EventName.SETTINGS_UPDATED]: { key: string; value: unknown };

  // Permission flow
  [EventName.PERMISSION_REQUEST]: {
    requestId: string;
    threadId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    timestamp: number;
  };

  [EventName.PERMISSION_RESPONSE]: {
    requestId: string;
    threadId: string;
    decision: "approve" | "deny";
    reason?: string;
  };

  // Queued message acknowledgement
  [EventName.QUEUED_MESSAGE_ACK]: {
    threadId: string;
    messageId: string;
  };

  // Plan events
  [EventName.PLAN_DETECTED]: { planId: string };
  [EventName.PLAN_CREATED]: { planId: string; repoId: string };
  [EventName.PLAN_UPDATED]: { planId: string };
  [EventName.PLAN_ARCHIVED]: { planId: string; originInstanceId?: string | null };

  // Relation events
  [EventName.RELATION_CREATED]: { planId: string; threadId: string; type: RelationType };
  [EventName.RELATION_UPDATED]: { planId: string; threadId: string; type: RelationType; previousType: RelationType };

  // User events
  [EventName.USER_MESSAGE_SENT]: { threadId: string; message: string };
}

// ============================================================================
// Agent Output Types (moved from duplicated locations)
// ============================================================================

/**
 * File change tracked during agent execution.
 *
 * NOTE: The `diff` field was removed - diffs are generated on-demand by the
 * frontend using git_diff_files, which handles both tracked files (git diff)
 * and untracked files (synthetic diff generation).
 *
 * Paths are always relative to the working directory (normalized at agent level).
 */
export const FileChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify", "delete", "rename"]),
  oldPath: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * Execution metrics for completed agent run.
 */
export const ResultMetricsSchema = z.object({
  durationApiMs: z.number(),
  totalCostUsd: z.number(),
  numTurns: z.number(),
});
export type ResultMetrics = z.infer<typeof ResultMetricsSchema>;

/**
 * Tool execution state tracked during run.
 */
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error"]),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(), // Track which tool was used
});
export type ToolExecutionState = z.infer<typeof ToolExecutionStateSchema>;

/**
 * Complete thread state snapshot emitted during execution.
 *
 * NOTE: The `status` field uses AgentThreadStatus values.
 * This is a subset of the full ThreadStatus - agents never emit
 * state for "idle" or "paused" threads.
 *
 * MessageParam is from the Anthropic SDK - we use z.any() for messages
 * since the SDK already validates these and we don't want to duplicate
 * their schema definitions.
 */
export const ThreadStateSchema = z.object({
  messages: z.array(z.any()),
  fileChanges: z.array(FileChangeSchema),
  workingDirectory: z.string(),
  metrics: ResultMetricsSchema.optional(),
  status: AgentThreadStatusSchema,
  error: z.string().optional(),
  timestamp: z.number(),
  toolStates: z.record(z.string(), ToolExecutionStateSchema),
  /** SDK session ID for resuming conversations */
  sessionId: z.string().optional(),
});
export type ThreadState = z.infer<typeof ThreadStateSchema>;

// ============================================================================
// Agent Output Protocol
// ============================================================================

/**
 * Schema for event names.
 */
export const EventNameSchema = z.enum([
  EventName.THREAD_CREATED,
  EventName.THREAD_UPDATED,
  EventName.THREAD_STATUS_CHANGED,
  EventName.THREAD_ARCHIVED,
  EventName.THREAD_FILE_CREATED,
  EventName.THREAD_FILE_MODIFIED,
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  EventName.AGENT_COMPLETED,
  EventName.AGENT_ERROR,
  EventName.AGENT_TOOL_COMPLETED,
  EventName.AGENT_CANCELLED,
  EventName.WORKTREE_ALLOCATED,
  EventName.WORKTREE_RELEASED,
  EventName.REPOSITORY_CREATED,
  EventName.REPOSITORY_UPDATED,
  EventName.REPOSITORY_DELETED,
  EventName.ACTION_REQUESTED,
  EventName.SETTINGS_UPDATED,
  EventName.PERMISSION_REQUEST,
  EventName.PERMISSION_RESPONSE,
  EventName.QUEUED_MESSAGE_ACK,
  EventName.PLAN_DETECTED,
  EventName.PLAN_CREATED,
  EventName.PLAN_UPDATED,
  EventName.PLAN_ARCHIVED,
  EventName.RELATION_CREATED,
  EventName.RELATION_UPDATED,
  EventName.USER_MESSAGE_SENT,
]);

/**
 * Event message emitted to stdout by agent.
 * Note: We use z.unknown() for payload since it varies by event type.
 * The type-level EventPayloads mapping provides compile-time safety.
 */
export const AgentEventMessageSchema = z.object({
  type: z.literal("event"),
  name: EventNameSchema,
  payload: z.unknown(),
});
export interface AgentEventMessage<E extends EventNameType = EventNameType> {
  type: "event";
  name: E;
  payload: EventPayloads[E];
}

/**
 * State message emitted to stdout by agent.
 */
export const AgentStateMessageSchema = z.object({
  type: z.literal("state"),
  state: ThreadStateSchema,
});
export type AgentStateMessage = z.infer<typeof AgentStateMessageSchema>;

/**
 * Log message emitted to stdout by agent.
 */
export const AgentLogMessageSchema = z.object({
  type: z.literal("log"),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  message: z.string(),
});
export type AgentLogMessage = z.infer<typeof AgentLogMessageSchema>;

/**
 * All possible stdout messages from agent.
 */
export const AgentOutputSchema = z.discriminatedUnion("type", [
  AgentEventMessageSchema,
  AgentStateMessageSchema,
  AgentLogMessageSchema,
]);
export type AgentOutput = AgentEventMessage | AgentStateMessage | AgentLogMessage;
