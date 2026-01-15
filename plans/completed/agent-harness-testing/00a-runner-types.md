# Phase 0a: Runner Strategy Types

## Overview

Define TypeScript interfaces for the unified runner strategy pattern. This enables a single entry point to handle both task-based agents (research, execution, merge) and simple agents through a common interface.

## Dependencies

- None (can start immediately)

## Parallel With

- `00f-vitest-config.md` (no shared dependencies)

## Files to Create

### `agents/src/runners/types.ts`

```typescript
import type { TaskMetadata } from "@core/types/tasks";

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
    status: "completed" | "error",
    error?: string
  ): Promise<void>;
}
```

## Implementation Notes

### Type Alignment with Existing Code

The `RunnerConfig` interface aligns with the existing `Args` interface in `runner.ts`:
- `agentType` -> `agent` (standardized naming)
- `taskSlug` -> `taskSlug` (unchanged)
- Added `cwd` for simple agent support

The `OrchestrationContext` captures the output of `orchestrate()` from `orchestration.ts`:
- `cwd` -> `workingDir`
- `taskSlug`, `branch`, `mergeBase` -> corresponding fields
- Added `threadPath` for state file management

### Strategy Selection

The unified entry point will select strategy based on agent type:

```typescript
function getStrategy(agent: AgentType): RunnerStrategy {
  return agent === "simple"
    ? new SimpleRunnerStrategy()
    : new TaskRunnerStrategy();
}
```

## Acceptance Criteria

- [ ] Types compile without errors
- [ ] Types are exported from `agents/src/runners/index.ts`
- [ ] No circular dependencies introduced
- [ ] Types align with existing `runner.ts` Args and orchestrate() output
- [ ] JSDoc comments provide clear documentation

## Estimated Effort

Small (~30 mins)
