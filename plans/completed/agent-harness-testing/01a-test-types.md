# Phase 1a: Testing Types

## Overview

Define TypeScript interfaces for the testing framework, reusing existing types from `@core/types` where possible to avoid duplication.

## Dependencies

- Phase 0 complete (runner unification)

## Parallel With

- Nothing in Phase 1 (types needed first)

## Files to Create

### `agents/src/testing/types.ts`

```typescript
// Re-export existing types from core - these are the canonical definitions
export type { TaskMetadata, TaskStatus } from "@core/types/tasks";
export type {
  ThreadState,
  FileChange,
  ResultMetrics,
  AgentThreadStatus,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  AgentOutput as StdoutMessage,
} from "@core/types/events";

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
export interface AgentTestOptions {
  /** Agent type to run */
  agent: "research" | "execution" | "merge" | "simple";
  /** The prompt/instruction to send to the agent */
  prompt: string;
  /** Path to the anvil directory (defaults to temp directory if not provided) */
  anvilDir?: string;
  /** Task slug for task-based agents (research, execution, merge) */
  taskSlug?: string;
  /** Repository name for context */
  repositoryName?: string;
  /** Thread ID to resume or create */
  threadId?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Additional environment variables to pass to the agent process */
  env?: Record<string, string>;
  /** Working directory for simple agents (required for simple agent type) */
  cwd?: string;
}
```

## Design Decisions

1. **Re-export from `@core/types`**: The canonical type definitions live in `core/types/events.ts` and `core/types/tasks.ts`. Re-exporting avoids duplication and ensures consistency across the codebase.

2. **Rename alias for clarity**: `AgentOutput` from `@core/types/events` is a union of message types. We alias it as `StdoutMessage` for testing clarity, then define `AgentRunOutput` as the aggregated test result.

3. **`AgentRunOutput` vs `StdoutMessage`**: These serve different purposes:
   - `StdoutMessage`: A single line of JSON output (discriminated union)
   - `AgentRunOutput`: Aggregated output from an entire test run (arrays + metadata)

4. **Duration field naming**: Using `durationMs` instead of `duration` for explicit units, following codebase conventions (e.g., `durationApiMs` in `ResultMetrics`).

## Notes

- The existing `@core/types/events.ts` already defines the log level type inline as `"DEBUG" | "INFO" | "WARN" | "ERROR"` - no need to re-export separately
- `AgentTestOptions.cwd` is only relevant for simple agents; task-based agents derive their working directory from the worktree

## Acceptance Criteria

- [ ] All types compile without errors
- [ ] Re-exports from `@core/types` work correctly (verify import paths)
- [ ] No duplicate type definitions between testing/types.ts and core/types/*
- [ ] TypeScript can discriminate `StdoutMessage` union by `type` field

## Estimated Effort

Small (~30 mins)
