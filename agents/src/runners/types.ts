import type { PermissionMode } from "@core/types/permissions.js";

/**
 * Configuration produced by parsing CLI args.
 */
export interface RunnerConfig {
  /** User prompt for the agent */
  prompt: string;
  /** Unique thread identifier */
  threadId: string;
  /** Centralized .mort data directory (e.g., ~/.mort or ~/.mort-dev) */
  mortDir: string;
  /** Repository UUID - used for associating threads with repositories */
  repoId?: string;
  /** Worktree UUID - used for associating threads with worktrees */
  worktreeId?: string;
  /** Working directory for the agent */
  cwd?: string;
  /** Path to existing state.json for resuming a thread */
  historyFile?: string;
  /** Override appended prompt */
  appendedPrompt?: string;
  /** Additional environment variables to set */
  env?: Record<string, string>;
  /** Parent thread ID - for sub-agents spawned via bash */
  parentThreadId?: string;
}

/**
 * Context returned by strategy setup, used during agent execution.
 */
export interface OrchestrationContext {
  /** Working directory for the agent */
  workingDir: string;
  /** Thread ID */
  threadId: string;
  /** Path to thread folder for state/metadata storage */
  threadPath: string;
  /** Repository UUID - used for plan detection */
  repoId?: string;
  /** Worktree UUID - used for plan detection */
  worktreeId?: string;
  /** Cleanup function to call on exit */
  cleanup?: () => void | Promise<void>;
  /** Permission mode for tool execution */
  permissionMode?: PermissionMode;
}

/**
 * Strategy interface for runner modes.
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
   * @param config - Normalized configuration from parseArgs
   * @returns Context needed for agent execution
   */
  setup(config: RunnerConfig): Promise<OrchestrationContext>;

  /**
   * Clean up resources on exit.
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
