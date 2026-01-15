import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks.js";
import type { AgentTestOptions } from "./types.js";

/**
 * Configuration for spawning an agent runner.
 *
 * The unified runner (runner.js) accepts different CLI arguments depending
 * on the agent type. This interface abstracts that complexity, allowing
 * tests to customize how agents are spawned.
 */
export interface RunnerConfig {
  /**
   * Path to runner script relative to agents/src/
   * @default "runner.ts"
   */
  runnerPath: string;

  /**
   * Build CLI arguments for the runner.
   *
   * @param opts - Test options including agent type, prompt, and optional overrides
   * @param task - Task metadata (used by task-based agents for orchestration)
   * @param mortDirPath - Absolute path to the mort directory
   * @param repoCwd - Working directory for the agent (repo path or custom cwd)
   * @returns Array of CLI arguments to pass to the runner
   */
  buildArgs: (
    opts: AgentTestOptions,
    task: TaskMetadata,
    mortDirPath: string,
    repoCwd: string
  ) => string[];

  /**
   * Additional environment variables to pass to the agent process.
   * These are merged with the test's env options.
   */
  env?: Record<string, string>;
}

/**
 * Default runner configuration for the unified runner.
 *
 * Handles both:
 * - Task-based agents (research, execution, merge): Use --task-slug for orchestration
 * - Simple agents: Use --cwd for direct repository access
 */
export const defaultRunnerConfig: RunnerConfig = {
  runnerPath: "runner.ts",

  buildArgs: (opts, task, mortDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();

    // Common args shared by all agent types
    const commonArgs = [
      "--agent", opts.agent,
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--mort-dir", mortDirPath,
    ];

    if (opts.agent === "simple") {
      // Simple agent: operates directly on a directory
      // Uses task.slug as the task-id since harness creates a task for each run
      return [
        ...commonArgs,
        "--task-id", task.slug,
        "--cwd", opts.cwd ?? repoCwd,
      ];
    } else {
      // Task-based agents (research, execution, merge): require task context
      return [
        ...commonArgs,
        "--task-slug", task.slug,
      ];
    }
  },
};

/**
 * Create a custom runner config by merging overrides with the default config.
 *
 * @example
 * // Custom runner path for testing alternative runners
 * const config = createRunnerConfig({ runnerPath: "custom-runner.js" });
 *
 * @example
 * // Custom arg builder for special test scenarios
 * const config = createRunnerConfig({
 *   buildArgs: (opts, task, mortDir, cwd) => [
 *     "--agent", opts.agent,
 *     "--debug",
 *     "--task-slug", task.slug,
 *   ],
 * });
 */
export function createRunnerConfig(
  overrides: Partial<RunnerConfig>
): RunnerConfig {
  return {
    ...defaultRunnerConfig,
    ...overrides,
  };
}
