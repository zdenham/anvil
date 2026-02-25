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
    AGENT_STATE: "agent:state",
    AGENT_COMPLETED: "agent:completed",
    AGENT_ERROR: "agent:error",
    AGENT_TOOL_COMPLETED: "agent:tool-completed",
    AGENT_CANCELLED: "agent:cancelled",
    // Orchestration
    WORKTREE_ALLOCATED: "worktree:allocated",
    WORKTREE_RELEASED: "worktree:released",
    WORKTREE_NAME_GENERATED: "worktree:name:generated",
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
    OPTIMISTIC_STREAM: "optimistic:stream",
};
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
/**
 * Tool execution state tracked during run.
 */
export const ToolExecutionStateSchema = z.object({
    status: z.enum(["running", "complete", "error"]),
    result: z.string().optional(),
    isError: z.boolean().optional(),
    toolName: z.string().optional(), // Track which tool was used
});
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
    /** Latest token usage from the most recent API call (for context pressure) */
    lastCallUsage: TokenUsageSchema.optional(),
    /** Cumulative token usage across all API calls (for total spend display) */
    cumulativeUsage: TokenUsageSchema.optional(),
});
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
    EventName.AGENT_STATE,
    EventName.AGENT_COMPLETED,
    EventName.AGENT_ERROR,
    EventName.AGENT_TOOL_COMPLETED,
    EventName.AGENT_CANCELLED,
    EventName.WORKTREE_ALLOCATED,
    EventName.WORKTREE_RELEASED,
    EventName.WORKTREE_NAME_GENERATED,
    EventName.REPOSITORY_CREATED,
    EventName.REPOSITORY_UPDATED,
    EventName.REPOSITORY_DELETED,
    EventName.ACTION_REQUESTED,
    EventName.SETTINGS_UPDATED,
    EventName.PERMISSION_REQUEST,
    EventName.PERMISSION_RESPONSE,
    EventName.PERMISSION_MODE_CHANGED,
    EventName.QUEUED_MESSAGE_ACK,
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
    EventName.OPTIMISTIC_STREAM,
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
/**
 * State message emitted to stdout by agent.
 */
export const AgentStateMessageSchema = z.object({
    type: z.literal("state"),
    state: ThreadStateSchema,
});
/**
 * Log message emitted to stdout by agent.
 */
export const AgentLogMessageSchema = z.object({
    type: z.literal("log"),
    level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    message: z.string(),
});
/**
 * All possible stdout messages from agent.
 */
export const AgentOutputSchema = z.discriminatedUnion("type", [
    AgentEventMessageSchema,
    AgentStateMessageSchema,
    AgentLogMessageSchema,
]);
