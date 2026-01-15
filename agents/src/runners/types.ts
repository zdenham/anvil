import type { TaskMetadata } from "@core/types/tasks.js";
import type { AgentMode } from "@core/types/agent-mode.js";
import type { PermissionMode } from "@core/types/permissions.js";

/** Supported agent types */
export type AgentType = "research" | "execution" | "merge" | "simple";

/**
 * Configuration produced by parsing CLI args.
 *
 * This is the normalized representation of CLI arguments that both
 * TaskRunnerStrategy and SimpleRunnerStrategy produce.
 */
export interface RunnerConfig {
  /** Agent type being run */
  agent: AgentType;
  /** User prompt for the agent */
  prompt: string;
  /** Unique thread identifier */
  threadId: string;
  /** Centralized .mort data directory (e.g., ~/.mort or ~/.mort-dev) */
  mortDir: string;
  /** Task slug - required for task-based agents (research, execution, merge) */
  taskSlug?: string;
  /** Task ID - required for simple agent (UUID used as directory name) */
  taskId?: string;
  /** Working directory - required for simple agent */
  cwd?: string;
  /** Path to existing state.json for resuming a thread */
  historyFile?: string;
  /** Parent task ID for subtask support */
  parentTaskId?: string;
  /** Override appended prompt (e.g., merge agent with dynamic context) */
  appendedPrompt?: string;
  /** Additional environment variables to set */
  env?: Record<string, string>;
  /** Agent mode for tool execution */
  agentMode?: AgentMode;
}

/**
 * Context returned by strategy setup, used during agent execution.
 *
 * This provides the runtime context that the unified runner needs
 * to execute the agent, regardless of strategy type.
 */
export interface OrchestrationContext {
  /** Working directory for the agent */
  workingDir: string;
  /** Task metadata - present for task-based agents, undefined for simple */
  task?: TaskMetadata;
  /** Thread ID */
  threadId: string;
  /** Task branch name - present for task-based agents */
  branchName?: string;
  /** Git merge base commit - used for diff generation */
  mergeBase?: string;
  /** Path to thread folder for state/metadata storage */
  threadPath: string;
  /** Cleanup function to call on exit (releases worktree, updates status) */
  cleanup?: () => void | Promise<void>;
  /** Permission mode for tool execution */
  permissionMode?: PermissionMode;
}

/**
 * Strategy interface for different runner modes.
 *
 * Implementations handle the differences between:
 * - TaskRunnerStrategy: task-based agents with orchestration, worktrees, git tracking
 * - SimpleRunnerStrategy: simple agent running in a provided cwd
 *
 * The unified runner uses this interface to remain agnostic of these differences.
 */
export interface RunnerStrategy {
  /**
   * Parse and validate CLI arguments.
   *
   * @param args - Raw CLI arguments (process.argv.slice(2))
   * @returns Normalized configuration
   * @throws Error if required arguments are missing or invalid
   */
  parseArgs(args: string[]): RunnerConfig;

  /**
   * Set up the execution environment.
   *
   * For task-based agents: loads task, allocates worktree, creates thread record
   * For simple agent: validates cwd, creates simple-task metadata
   *
   * @param config - Normalized configuration from parseArgs
   * @returns Context needed for agent execution
   */
  setup(config: RunnerConfig): Promise<OrchestrationContext>;

  /**
   * Clean up resources on exit.
   *
   * For task-based agents: releases worktree, updates thread status
   * For simple agent: updates simple-task status
   *
   * @param context - Context from setup
   * @param status - Final status ("completed" | "error")
   * @param error - Error message if status is "error"
   */
  cleanup(
    context: OrchestrationContext,
    status: "completed" | "error" | "cancelled",
    error?: string
  ): Promise<void>;
}
