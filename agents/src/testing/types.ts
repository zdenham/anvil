// Re-export existing types from core - these are the canonical definitions
export type {
  ThreadState,
  FileChange,
  ResultMetrics,
  AgentThreadStatus,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  AgentOutput as StdoutMessage,
  ToolExecutionState,
} from "@core/types/events.js";

// Import for use in interface definitions
import type { AgentLogMessage, AgentEventMessage, AgentStateMessage } from "@core/types/events.js";

/**
 * Collected output from an agent test run.
 *
 * Unlike the `StdoutMessage` union (which represents individual messages),
 * this aggregates all output from a complete agent execution for assertions.
 */
export interface AgentRunOutput {
  /** All log messages emitted during execution */
  logs: AgentLogMessage[];
  /** All event messages emitted during execution */
  events: AgentEventMessage[];
  /** All state snapshots emitted during execution */
  states: AgentStateMessage[];
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Any stderr output (typically empty for successful runs) */
  stderr: string;
  /** Total wall-clock duration in milliseconds */
  durationMs: number;
}

/**
 * Options for running an agent test.
 * These mirror the unified runner CLI arguments.
 */
/**
 * A queued message to be sent during agent execution.
 */
export interface QueuedMessageSpec {
  /** Delay in milliseconds from agent start before sending */
  delayMs: number;
  /** Message content to send */
  content: string;
}

export interface AgentTestOptions {
  /** The prompt/instruction to send to the agent */
  prompt: string;
  /** Path to the mort directory (defaults to temp directory if not provided) */
  mortDir?: string;
  /** Repository name for context */
  repositoryName?: string;
  /** Thread ID to resume or create */
  threadId?: string;
  /** Repository UUID for the agent */
  repoId?: string;
  /** Worktree UUID for the agent */
  worktreeId?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Additional environment variables to pass to the agent process */
  env?: Record<string, string>;
  /** Working directory for the agent */
  cwd?: string;
  /**
   * Queued messages to send during execution.
   * Each message is sent after the specified delay from agent start.
   */
  queuedMessages?: QueuedMessageSpec[];
}
