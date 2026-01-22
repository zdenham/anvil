import { randomUUID } from "crypto";
import type { AgentTestOptions } from "./types.js";

/**
 * Configuration for spawning an agent runner.
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
   * @param mortDirPath - Absolute path to the mort directory
   * @param repoCwd - Working directory for the agent (repo path or custom cwd)
   * @returns Array of CLI arguments to pass to the runner
   */
  buildArgs: (
    opts: AgentTestOptions,
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
 */
export const defaultRunnerConfig: RunnerConfig = {
  runnerPath: "runner.ts",

  buildArgs: (opts, mortDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();
    const repoId = opts.repoId ?? randomUUID();
    const worktreeId = opts.worktreeId ?? randomUUID();

    return [
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--repo-id", repoId,
      "--worktree-id", worktreeId,
      "--mort-dir", mortDirPath,
      "--cwd", opts.cwd ?? repoCwd,
    ];
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
 *   buildArgs: (opts, mortDir, cwd) => [
 *     "--agent", opts.agent,
 *     "--debug",
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
