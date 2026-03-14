import type { ThreadStatus } from "./threads.js";
import type { RelationType } from "./relations.js";
import type { PermissionModeId } from "./permissions.js";
import type { GatewayEvent } from "./gateway-events.js";
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
  THREAD_OPTIMISTIC_CREATED: "thread:optimistic-created",
  THREAD_CREATED: "thread:created",
  THREAD_UPDATED: "thread:updated",
  THREAD_STATUS_CHANGED: "thread:status-changed",
  THREAD_ARCHIVED: "thread:archived",
  THREAD_FILE_CREATED: "thread:file-created",
  THREAD_FILE_MODIFIED: "thread:file-modified",

  // Agent process
  AGENT_SPAWNED: "agent:spawned",
  AGENT_COMPLETED: "agent:completed",
  AGENT_ERROR: "agent:error",
  AGENT_TOOL_COMPLETED: "agent:tool-completed",
  AGENT_CANCELLED: "agent:cancelled",

  // Thread state (reducer-based)
  THREAD_ACTION: "thread:action",

  // Orchestration
  WORKTREE_ALLOCATED: "worktree:allocated",
  WORKTREE_RELEASED: "worktree:released",
  WORKTREE_NAME_GENERATED: "worktree:name:generated",
  WORKTREE_SYNCED: "worktree:synced",
  PR_DETECTED: "pr:detected",

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
  PERMISSION_MODE_CHANGED: "permission:mode-changed",

  // Question flow (AskUserQuestion hook gate)
  QUESTION_REQUEST: "question:request",
  QUESTION_RESPONSE: "question:response",

  // Queued message acknowledgement
  QUEUED_MESSAGE_ACK: "queued-message:ack",

  // Terminal lifecycle
  TERMINAL_CREATED: "terminal:created",
  TERMINAL_UPDATED: "terminal:updated",
  TERMINAL_ARCHIVED: "terminal:archived",

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

  // Thread naming
  THREAD_NAME_GENERATED: "thread:name:generated",

  // Pull request lifecycle
  PR_CREATED: "pr:created",
  PR_UPDATED: "pr:updated",
  PR_ARCHIVED: "pr:archived",

  // Gateway events
  GATEWAY_EVENT: "gateway:event",
  GATEWAY_STATUS: "gateway:status",
  GITHUB_WEBHOOK_EVENT: "github:webhook-event",

  // Streaming
  STREAM_DELTA: "stream:delta",

  // API health
  API_DEGRADED: "api:degraded",

  // Comments
  COMMENT_ADDED: "comment:added",
  COMMENT_UPDATED: "comment:updated",
  COMMENT_RESOLVED: "comment:resolved",
  COMMENT_DELETED: "comment:deleted",

  // Folder lifecycle
  FOLDER_CREATED: "folder:created",
  FOLDER_UPDATED: "folder:updated",
  FOLDER_DELETED: "folder:deleted",
  FOLDER_ARCHIVED: "folder:archived",
} as const;

export type EventNameType = (typeof EventName)[keyof typeof EventName];

// ============================================================================
// Event Classification — Visibility-Aware Filtering
// ============================================================================

/**
 * Lifecycle events always emit to all WS clients regardless of which thread
 * the user is viewing. These are events that affect the sidebar tree
 * (thread list, status dots, plan/PR/terminal/folder nodes, etc.).
 *
 * Everything NOT in this set is a "display" event — only emitted for threads
 * the user is actively viewing. This is the safe default: new event types
 * are display-gated unless explicitly added here.
 */
export const LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  // Thread tree nodes
  EventName.THREAD_OPTIMISTIC_CREATED,
  EventName.THREAD_CREATED,
  EventName.THREAD_UPDATED,
  EventName.THREAD_STATUS_CHANGED,
  EventName.THREAD_ARCHIVED,
  EventName.THREAD_NAME_GENERATED,

  // Pending input (yellow dot) — drives threadsWithPendingInput
  EventName.PERMISSION_REQUEST,
  EventName.QUESTION_REQUEST,

  // Plan tree nodes
  EventName.PLAN_DETECTED,
  EventName.PLAN_CREATED,
  EventName.PLAN_UPDATED,
  EventName.PLAN_ARCHIVED,

  // PR tree nodes
  EventName.PR_DETECTED,
  EventName.PR_CREATED,
  EventName.PR_UPDATED,
  EventName.PR_ARCHIVED,

  // Terminal tree nodes
  EventName.TERMINAL_CREATED,
  EventName.TERMINAL_UPDATED,
  EventName.TERMINAL_ARCHIVED,

  // Folder tree nodes
  EventName.FOLDER_CREATED,
  EventName.FOLDER_UPDATED,
  EventName.FOLDER_DELETED,
  EventName.FOLDER_ARCHIVED,

  // Worktree/repo grouping
  EventName.WORKTREE_ALLOCATED,
  EventName.WORKTREE_RELEASED,
  EventName.WORKTREE_NAME_GENERATED,
  EventName.WORKTREE_SYNCED,
  EventName.REPOSITORY_CREATED,
  EventName.REPOSITORY_UPDATED,
  EventName.REPOSITORY_DELETED,

  // Sidebar relationships
  EventName.RELATION_CREATED,
  EventName.RELATION_UPDATED,

  // Global state
  EventName.SETTINGS_UPDATED,
  EventName.API_DEGRADED,
]);

// ============================================================================
// Event Payloads
// ============================================================================

/**
 * Block delta for streaming — append-only, simpler than JSON Patch.
 * Streaming content only grows during generation (no edits/deletes).
 */
export interface BlockDelta {
  index: number;
  type: "text" | "thinking";
  append: string;
  blockId?: string;
}

/**
 * Stream delta event payload — append-only deltas from the socket.
 */
export interface StreamDeltaPayload {
  threadId: string;
  deltas: BlockDelta[];
  /** Stable SDK message ID (from message_start). Used by reducer for WIP message tracking. */
  messageId?: string;
}

/**
 * Payload types for each event.
 * Ensures type safety on both emit and consume sides.
 */
export interface EventPayloads {
  // Thread events
  [EventName.THREAD_OPTIMISTIC_CREATED]: { threadId: string; repoId: string; worktreeId: string; prompt: string; status: ThreadStatus; permissionMode?: PermissionModeId };
  [EventName.THREAD_CREATED]: { threadId: string; repoId: string; worktreeId: string; source?: string };
  [EventName.THREAD_UPDATED]: { threadId: string };
  [EventName.THREAD_STATUS_CHANGED]: { threadId: string; status: ThreadStatus };
  [EventName.THREAD_ARCHIVED]: { threadId: string; originInstanceId?: string | null };
  [EventName.THREAD_FILE_CREATED]: { threadId: string; filePath: string };
  [EventName.THREAD_FILE_MODIFIED]: { threadId: string; filePath: string };

  // Agent events
  [EventName.AGENT_SPAWNED]: { threadId: string; repoId: string };
  [EventName.AGENT_COMPLETED]: { threadId: string; exitCode: number; costUsd?: number };
  [EventName.AGENT_ERROR]: { threadId: string; error: string };
  [EventName.AGENT_TOOL_COMPLETED]: { threadId: string; repoId: string };
  [EventName.AGENT_CANCELLED]: { threadId: string };

  // Thread state (reducer-based)
  [EventName.THREAD_ACTION]: { threadId: string; action: import("@core/lib/thread-reducer.js").ThreadAction };

  // Orchestration events
  [EventName.WORKTREE_ALLOCATED]: { worktree: WorktreeStatePayload; mergeBase: string };
  [EventName.WORKTREE_RELEASED]: { threadId: string };

  // Worktree naming
  [EventName.WORKTREE_NAME_GENERATED]: {
    worktreeId: string;
    repoId: string;
    name: string;
  };

  // Worktree sync (agent detected git worktree add)
  [EventName.WORKTREE_SYNCED]: {
    repoId: string;
  };

  // PR detected (agent detected gh pr create)
  [EventName.PR_DETECTED]: {
    repoId: string;
    worktreeId: string;
    repoSlug: string;
    prNumber: number;
  };

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
    toolUseId?: string;
    timestamp: number;
  };

  [EventName.PERMISSION_RESPONSE]: {
    requestId: string;
    threadId: string;
    decision: "approve" | "deny";
    reason?: string;
  };

  [EventName.PERMISSION_MODE_CHANGED]: {
    threadId: string;
    modeId: PermissionModeId;
  };

  // Question flow (AskUserQuestion hook gate)
  [EventName.QUESTION_REQUEST]: {
    requestId: string;
    threadId: string;
    toolUseId: string;
    toolInput: Record<string, unknown>;
    timestamp: number;
  };

  [EventName.QUESTION_RESPONSE]: {
    requestId: string;
    threadId: string;
    answers: Record<string, string>;
  };

  // Queued message acknowledgement
  [EventName.QUEUED_MESSAGE_ACK]: {
    threadId: string;
    messageId: string;
  };

  // Terminal events
  [EventName.TERMINAL_CREATED]: { terminalId: string; worktreeId: string };
  [EventName.TERMINAL_UPDATED]: { terminalId: string };
  [EventName.TERMINAL_ARCHIVED]: { terminalId: string };

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

  // Thread naming
  [EventName.THREAD_NAME_GENERATED]: { threadId: string; name: string };

  // Pull request events
  [EventName.PR_CREATED]: { prId: string; repoId: string; worktreeId: string };
  [EventName.PR_UPDATED]: { prId: string };
  [EventName.PR_ARCHIVED]: { prId: string; originInstanceId?: string | null };

  // Gateway events
  [EventName.GATEWAY_EVENT]: GatewayEvent;
  [EventName.GATEWAY_STATUS]: { status: "disconnected" | "connecting" | "connected" };
  [EventName.GITHUB_WEBHOOK_EVENT]: {
    channelId: string;
    githubEventType: string;
    payload: Record<string, unknown>;
  };

  // Streaming
  [EventName.STREAM_DELTA]: StreamDeltaPayload;

  // API health
  [EventName.API_DEGRADED]: {
    service: string;
    message: string;
  };

  // Comments
  [EventName.COMMENT_ADDED]: { worktreeId: string; commentId: string };
  [EventName.COMMENT_UPDATED]: { worktreeId: string; commentId: string };
  [EventName.COMMENT_RESOLVED]: { worktreeId: string; commentId: string };
  [EventName.COMMENT_DELETED]: { worktreeId: string; commentId: string };

  // Folder events
  [EventName.FOLDER_CREATED]: { folderId: string };
  [EventName.FOLDER_UPDATED]: { folderId: string };
  [EventName.FOLDER_DELETED]: { folderId: string };
  [EventName.FOLDER_ARCHIVED]: { folderId: string };
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
 * Token usage from a single API call.
 *
 * Per the Anthropic API docs, total input tokens for a single request is:
 *   inputTokens + cacheCreationTokens + cacheReadTokens
 *
 * inputTokens alone is only the uncached portion.
 * outputTokens is only this call's generated output (incremental).
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Execution metrics for completed agent run.
 */
export const ResultMetricsSchema = z.object({
  durationApiMs: z.number(),
  totalCostUsd: z.number(),
  numTurns: z.number(),
  lastCallUsage: TokenUsageSchema.optional(),
  contextWindow: z.number().optional(),
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
 * Content block within a StoredMessage.
 *
 * The `isStreaming` flag is client-only — set by ThreadStateMachine on
 * in-flight blocks during streaming. It is never persisted to disk and
 * disappears when committed state replaces the WIP message.
 */
export interface RenderContentBlock {
  type: "text" | "thinking";
  id?: string;
  text?: string;
  thinking?: string;
  isStreaming?: boolean;
}

/**
 * A message stored in thread state with a stable ID for identification.
 *
 * Assistant messages use the API-assigned ID (e.g. msg_013Zva...).
 * User messages use a generated nanoid.
 *
 * Structurally extends SDK MessageParam — the `role` and `content` fields
 * come from the SDK type, with `id` added for stable keying.
 */
export interface StoredMessage {
  id: string;
  /** SDK message ID (e.g. msg_013Zva...) for correlating stream deltas with committed messages */
  anthropicId?: string;
  role: string;
  content: unknown;
  [key: string]: unknown;
}

/**
 * Complete thread state snapshot emitted during execution.
 *
 * NOTE: The `status` field uses AgentThreadStatus values.
 * This is a subset of the full ThreadStatus - agents never emit
 * state for "idle" or "paused" threads.
 *
 * Messages are StoredMessage instances (MessageParam + id).
 * We use z.any() since the SDK already validates message structure.
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
  /** Latest token usage from the most recent API call (for context pressure) */
  lastCallUsage: TokenUsageSchema.optional(),
  /** Cumulative token usage across all API calls (for total spend display) */
  cumulativeUsage: TokenUsageSchema.optional(),
  /** Maps anthropicMessageId → WIP message UUID (consumed on first commit) */
  wipMap: z.record(z.string(), z.string()).optional(),
  /** Maps correlation key → our stable block nanoid (consumed per-block on commit) */
  blockIdMap: z.record(z.string(), z.string()).optional(),
});
export type ThreadState = z.infer<typeof ThreadStateSchema>;

// ============================================================================
// Agent Output Protocol
// ============================================================================

/**
 * Schema for event names.
 */
export const EventNameSchema = z.enum([
  EventName.THREAD_OPTIMISTIC_CREATED,
  EventName.THREAD_CREATED,
  EventName.THREAD_UPDATED,
  EventName.THREAD_STATUS_CHANGED,
  EventName.THREAD_ARCHIVED,
  EventName.THREAD_FILE_CREATED,
  EventName.THREAD_FILE_MODIFIED,
  EventName.AGENT_SPAWNED,
  EventName.AGENT_COMPLETED,
  EventName.AGENT_ERROR,
  EventName.AGENT_TOOL_COMPLETED,
  EventName.AGENT_CANCELLED,
  EventName.WORKTREE_ALLOCATED,
  EventName.WORKTREE_RELEASED,
  EventName.WORKTREE_NAME_GENERATED,
  EventName.WORKTREE_SYNCED,
  EventName.PR_DETECTED,
  EventName.REPOSITORY_CREATED,
  EventName.REPOSITORY_UPDATED,
  EventName.REPOSITORY_DELETED,
  EventName.ACTION_REQUESTED,
  EventName.SETTINGS_UPDATED,
  EventName.PERMISSION_REQUEST,
  EventName.PERMISSION_RESPONSE,
  EventName.PERMISSION_MODE_CHANGED,
  EventName.QUESTION_REQUEST,
  EventName.QUESTION_RESPONSE,
  EventName.QUEUED_MESSAGE_ACK,
  EventName.TERMINAL_CREATED,
  EventName.TERMINAL_UPDATED,
  EventName.TERMINAL_ARCHIVED,
  EventName.PLAN_DETECTED,
  EventName.PLAN_CREATED,
  EventName.PLAN_UPDATED,
  EventName.PLAN_ARCHIVED,
  EventName.RELATION_CREATED,
  EventName.RELATION_UPDATED,
  EventName.USER_MESSAGE_SENT,
  EventName.THREAD_NAME_GENERATED,
  EventName.PR_CREATED,
  EventName.PR_UPDATED,
  EventName.PR_ARCHIVED,
  EventName.GATEWAY_EVENT,
  EventName.GATEWAY_STATUS,
  EventName.GITHUB_WEBHOOK_EVENT,
  EventName.THREAD_ACTION,
  EventName.STREAM_DELTA,
  EventName.COMMENT_ADDED,
  EventName.COMMENT_UPDATED,
  EventName.COMMENT_RESOLVED,
  EventName.COMMENT_DELETED,
  EventName.FOLDER_CREATED,
  EventName.FOLDER_UPDATED,
  EventName.FOLDER_DELETED,
  EventName.FOLDER_ARCHIVED,
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
