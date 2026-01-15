# Phase 2a: Runner Configuration Interface

## Overview

Create a runner configuration interface that defines how agents are spawned with different configurations. This interface abstracts the CLI argument construction for the unified runner, allowing tests to customize agent spawning behavior.

## Dependencies

- Phase 1 complete (test services: `01a-test-types.md`, `01b-test-mort-directory.md`, `01c-test-repository.md`)

## Parallel With

- `02c-assertions.md` (no shared dependencies)

## Files to Create

### `agents/src/testing/runner-config.ts`

```typescript
import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks";
import type { AgentTestOptions } from "./types";

/**
 * Configuration for spawning an agent runner.
 *
 * The unified runner (runner.js) accepts different CLI arguments depending
 * on the agent type. This interface abstracts that complexity, allowing
 * tests to customize how agents are spawned.
 */
export interface RunnerConfig {
  /**
   * Path to runner script relative to agents/dist/
   * @default "runner.js"
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
  runnerPath: "runner.js",

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
      // Simple agent: operates directly on a directory, no task context
      return [
        ...commonArgs,
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
```

## Design Decisions

1. **Strategy pattern** - The `buildArgs` function allows complete customization of CLI argument construction while providing sensible defaults.

2. **Agent type awareness** - The default config handles the fundamental difference between simple agents (directory-based) and task-based agents (slug-based orchestration).

3. **Immutable defaults** - The `createRunnerConfig` function creates new configs without mutating the default, ensuring test isolation.

4. **Thread ID generation** - Uses `randomUUID()` by default but allows override via `opts.threadId` for deterministic testing.

## Usage Examples

```typescript
// Use default configuration (most common case)
const harness = new AgentTestHarness();

// Custom runner path for testing alternative runners
const customHarness = new AgentTestHarness({
  runnerConfig: createRunnerConfig({
    runnerPath: "custom-runner.js",
  }),
});

// Custom environment variables
const envHarness = new AgentTestHarness({
  runnerConfig: createRunnerConfig({
    env: { DEBUG: "1", LOG_LEVEL: "debug" },
  }),
});

// Fully custom arg builder for edge cases
const specialHarness = new AgentTestHarness({
  runnerConfig: createRunnerConfig({
    buildArgs: (opts, task, mortDir, cwd) => [
      "--agent", opts.agent,
      "--prompt", opts.prompt,
      "--custom-flag", "value",
      "--task-slug", task.slug,
    ],
  }),
});
```

## Integration with AgentTestHarness

This config is consumed by `AgentTestHarness.spawnAgent()` (defined in `02b-agent-harness.md`):

```typescript
// In agent-harness.ts (simplified)
private spawnAgent(opts: AgentTestOptions, task: TaskMetadata): Promise<AgentRunOutput> {
  const runnerPath = join(distDir, this.runnerConfig.runnerPath);
  const args = this.runnerConfig.buildArgs(opts, task, mortDir, repoCwd);

  return spawn("node", [runnerPath, ...args], {
    env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
  });
}
```

## Acceptance Criteria

- [ ] Interface compiles without TypeScript errors
- [ ] Default config produces correct args for simple agent (`--cwd`)
- [ ] Default config produces correct args for task-based agents (`--task-slug`)
- [ ] `createRunnerConfig()` correctly merges partial overrides
- [ ] Thread ID defaults to random UUID when not specified
- [ ] Custom `buildArgs` function can completely override argument construction

## Estimated Effort

Small (~30 mins)
