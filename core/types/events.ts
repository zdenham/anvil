import type { TaskStatus } from "./tasks.js";
import type { ThreadStatus } from "./threads.js";
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
  // Task lifecycle
  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_DELETED: "task:deleted",
  TASK_STATUS_CHANGED: "task:status-changed",
  TASK_MARKED_UNREAD: "task:marked-unread",

  // Thread lifecycle
  THREAD_CREATED: "thread:created",
  THREAD_UPDATED: "thread:updated",
  THREAD_STATUS_CHANGED: "thread:status-changed",

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
  // Task events - use taskId (UUID) as primary identifier
  [EventName.TASK_CREATED]: { taskId: string };
  [EventName.TASK_UPDATED]: { taskId: string; planId?: string };
  [EventName.TASK_DELETED]: { taskId: string };
  [EventName.TASK_STATUS_CHANGED]: { taskId: string; status: TaskStatus };
  [EventName.TASK_MARKED_UNREAD]: { taskId: string };

  // Thread events
  [EventName.THREAD_CREATED]: { threadId: string; taskId: string };
  [EventName.THREAD_UPDATED]: { threadId: string; taskId: string; planId?: string };
  [EventName.THREAD_STATUS_CHANGED]: { threadId: string; status: ThreadStatus };

  // Agent events
  [EventName.AGENT_SPAWNED]: { threadId: string; taskId: string };
  [EventName.AGENT_STATE]: { threadId: string; state: ThreadState };
  [EventName.AGENT_COMPLETED]: { threadId: string; exitCode: number; costUsd?: number };
  [EventName.AGENT_ERROR]: { threadId: string; error: string };
  [EventName.AGENT_TOOL_COMPLETED]: { threadId: string; taskId: string };
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
    taskId: string;
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

  // Plan lifecycle
  [EventName.PLAN_DETECTED]: {
    planId: string;
  };
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
  EventName.TASK_CREATED,
  EventName.TASK_UPDATED,
  EventName.TASK_DELETED,
  EventName.TASK_STATUS_CHANGED,
  EventName.TASK_MARKED_UNREAD,
  EventName.THREAD_CREATED,
  EventName.THREAD_UPDATED,
  EventName.THREAD_STATUS_CHANGED,
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
