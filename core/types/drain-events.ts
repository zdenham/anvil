import { z } from "zod";

// ============================================================================
// Drain Event Names
// ============================================================================

/**
 * All drain event names in the system.
 * Used by the TS agent (emission) and Rust layer (consumption).
 */
export const DrainEventName = {
  TOOL_STARTED: "tool:started",
  TOOL_COMPLETED: "tool:completed",
  TOOL_FAILED: "tool:failed",
  TOOL_DENIED: "tool:denied",
  API_CALL: "api:call",
  THREAD_LIFECYCLE: "thread:lifecycle",
  CONTEXT_PRESSURE: "context:pressure",
  SUBAGENT_SPAWNED: "subagent:spawned",
  SUBAGENT_COMPLETED: "subagent:completed",
  PERMISSION_DECIDED: "permission:decided",
  CONTEXT_COMPACTED: "context:compacted",
  SESSION_RESUMED: "session:resumed",
} as const;

export type DrainEventNameType =
  (typeof DrainEventName)[keyof typeof DrainEventName];

// ============================================================================
// Base Drain Event
// ============================================================================

/** Wire format sent over hub socket as "drain" message type */
export const DrainEventSchema = z.object({
  event: z.string(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type DrainEvent = z.infer<typeof DrainEventSchema>;

// ============================================================================
// Per-Event Property Schemas (for type-safe emission)
// ============================================================================

export const ToolStartedPropsSchema = z.object({
  toolUseId: z.string(),
  toolName: z.string(),
  toolInput: z.string(), // sanitized JSON string
  permissionDecision: z.string(), // allow/deny/ask
  permissionReason: z.string().optional(),
  contextTokensBefore: z.number().optional(),
});

export const ToolCompletedPropsSchema = z.object({
  toolUseId: z.string(),
  toolName: z.string(),
  durationMs: z.number(),
  resultLength: z.number(),
  resultTruncated: z.boolean(),
  contextTokensAfter: z.number().optional(),
  contextDelta: z.number().optional(),
  filesModified: z.string().optional(), // JSON array string
});

export const ToolFailedPropsSchema = z.object({
  toolUseId: z.string(),
  toolName: z.string(),
  durationMs: z.number(),
  error: z.string(),
  errorType: z.enum([
    "permission_denied",
    "execution_error",
    "timeout",
    "unknown",
  ]),
});

export const ToolDeniedPropsSchema = z.object({
  toolUseId: z.string(),
  toolName: z.string(),
  reason: z.string(),
  deniedBy: z.enum(["rule", "user", "global_override"]),
});

export const ApiCallPropsSchema = z.object({
  turnIndex: z.number(),
  model: z.string().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheHitRate: z.number().optional(),
  contextUtilization: z.number().optional(),
  stopReason: z.string().optional(),
  toolUseCount: z.number().optional(),
  thinkingBlockCount: z.number().optional(),
  textBlockCount: z.number().optional(),
});

export const ThreadLifecyclePropsSchema = z.object({
  transition: z.enum(["started", "completed", "errored", "cancelled"]),
  durationMs: z.number().optional(),
  totalCostUsd: z.number().optional(),
  numTurns: z.number().optional(),
  totalToolCalls: z.number().optional(),
  totalTokensIn: z.number().optional(),
  totalTokensOut: z.number().optional(),
  exitCode: z.number().optional(),
  error: z.string().optional(),
});

export const ContextPressurePropsSchema = z.object({
  utilization: z.number(),
  threshold: z.number(),
  inputTokens: z.number(),
  contextWindow: z.number(),
  turnIndex: z.number(),
});

export const SubagentSpawnedPropsSchema = z.object({
  childThreadId: z.string(),
  agentType: z.string(),
  toolUseId: z.string(),
  promptLength: z.number(),
});

export const SubagentCompletedPropsSchema = z.object({
  childThreadId: z.string(),
  agentType: z.string(),
  durationMs: z.number(),
  resultLength: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});

export const PermissionDecidedPropsSchema = z.object({
  toolName: z.string(),
  toolUseId: z.string(),
  decision: z.enum(["allow", "deny", "ask"]),
  reason: z.string().optional(),
  modeId: z.string().optional(),
  evaluationTimeMs: z.number().optional(),
  waitTimeMs: z.number().optional(),
  userDecision: z.string().optional(),
});

export const ContextCompactedPropsSchema = z.object({
  trigger: z.enum(["manual", "auto"]),
  preTokens: z.number(),
  postTokens: z.number(),
  tokensSaved: z.number(),
  turnIndex: z.number(),
});

export const SessionResumedPropsSchema = z.object({
  priorMessageCount: z.number(),
  priorToolStateCount: z.number().optional(),
  priorTokensIn: z.number().optional(),
  priorTokensOut: z.number().optional(),
});

// ============================================================================
// Type-safe event -> properties mapping
// ============================================================================

export interface DrainEventPayloads {
  [DrainEventName.TOOL_STARTED]: z.infer<typeof ToolStartedPropsSchema>;
  [DrainEventName.TOOL_COMPLETED]: z.infer<typeof ToolCompletedPropsSchema>;
  [DrainEventName.TOOL_FAILED]: z.infer<typeof ToolFailedPropsSchema>;
  [DrainEventName.TOOL_DENIED]: z.infer<typeof ToolDeniedPropsSchema>;
  [DrainEventName.API_CALL]: z.infer<typeof ApiCallPropsSchema>;
  [DrainEventName.THREAD_LIFECYCLE]: z.infer<
    typeof ThreadLifecyclePropsSchema
  >;
  [DrainEventName.CONTEXT_PRESSURE]: z.infer<
    typeof ContextPressurePropsSchema
  >;
  [DrainEventName.SUBAGENT_SPAWNED]: z.infer<
    typeof SubagentSpawnedPropsSchema
  >;
  [DrainEventName.SUBAGENT_COMPLETED]: z.infer<
    typeof SubagentCompletedPropsSchema
  >;
  [DrainEventName.PERMISSION_DECIDED]: z.infer<
    typeof PermissionDecidedPropsSchema
  >;
  [DrainEventName.CONTEXT_COMPACTED]: z.infer<
    typeof ContextCompactedPropsSchema
  >;
  [DrainEventName.SESSION_RESUMED]: z.infer<typeof SessionResumedPropsSchema>;
}
