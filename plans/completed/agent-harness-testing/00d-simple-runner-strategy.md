# Phase 0d: Simple Runner Strategy

## Overview

Implement `SimpleRunnerStrategy` for simple agents that run in a user-provided working directory without task orchestration, worktree allocation, or git-based file tracking.

## Dependencies

- `00a-runner-types.md` (types must exist first)
- `00b-runner-shared-extraction.md` (shared code must be extracted first)

## Parallel With

- `00c-task-runner-strategy.md` (both can be developed simultaneously after dependencies are complete)

## Files to Create

### `agents/src/runners/simple-runner-strategy.ts`

```typescript
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { RunnerStrategy, RunnerConfig, OrchestrationContext } from "./types";
import { emitEvent, emitLog } from "./shared";

export class SimpleRunnerStrategy implements RunnerStrategy {
  parseArgs(args: string[]): RunnerConfig {
    // Validate required args: --cwd, --thread-id, --anvil-dir, --prompt
    // Validate --cwd exists and is a directory
    // Return normalized config with agent: "simple"
  }

  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    // 1. Validate cwd exists and is accessible
    // 2. Create simple-tasks/{threadId}/ directory in anvil-dir
    // 3. Write initial metadata.json with status: "running"
    // 4. Emit thread:created event
    // 5. Return context with cwd as workingDir
  }

  async cleanup(context: OrchestrationContext): Promise<void> {
    // 1. Update metadata.json with final status (complete/error)
    // 2. Emit thread:status:changed event
    // Note: No worktree to release for simple agents
  }
}
```

## Implementation Notes

### Required CLI Arguments

```
--agent simple
--cwd <path>           # Required: Working directory (must exist)
--thread-id <uuid>     # Required: Unique thread identifier
--anvil-dir <path>      # Required: Path to anvil data directory
--prompt <string>      # Required: Agent prompt/instructions
```

### Setup Sequence

1. **Validate working directory**:
   - Check `cwd` exists using `existsSync()`
   - Verify it is a directory (not a file)
   - Throw descriptive error if validation fails

2. **Create metadata directory**:
   - Create `{anvilDir}/simple-tasks/{threadId}/` directory
   - Use `mkdirSync` with `{ recursive: true }`

3. **Write initial metadata**:
   - Write `metadata.json` with initial state
   - Set `status: "running"`, `createdAt: Date.now()`

4. **Emit events**:
   - Emit `thread:created` event with threadId and agent type

5. **Return context**:
   - `workingDir` set to the provided `cwd`
   - `threadId` from config
   - No `task` property (simple agents are not task-based)

### Cleanup Sequence

1. **Update metadata**:
   - Read existing metadata.json
   - Update `status` to "complete" or "error"
   - Update `updatedAt` timestamp
   - If error, include `error` message

2. **Emit events**:
   - Emit `thread:status:changed` with final status

### Key Differences from TaskRunnerStrategy

| Aspect | TaskRunnerStrategy | SimpleRunnerStrategy |
|--------|-------------------|---------------------|
| Working directory | Allocated worktree or task's sourcePath | User-provided `--cwd` |
| Metadata location | `tasks/{slug}/metadata.json` | `simple-tasks/{threadId}/metadata.json` |
| Worktree allocation | Optional (via repository settings) | Never used |
| File change tracking | Git diff from merge base | None |
| Thread folder | `threads/{agent}-{threadId}` | Not applicable |
| Task association | Required (`--task-slug`) | None |

### Metadata Schema

```typescript
// Location: {anvilDir}/simple-tasks/{threadId}/metadata.json
interface SimpleTaskMetadata {
  /** Unique identifier (same as threadId for simple tasks) */
  id: string;
  /** Thread identifier */
  threadId: string;
  /** The prompt/instructions given to the agent */
  prompt: string;
  /** Working directory the agent runs in */
  cwd: string;
  /** Current execution status */
  status: "running" | "complete" | "error";
  /** Unix timestamp when execution started */
  createdAt: number;
  /** Unix timestamp of last status update */
  updatedAt: number;
  /** Error message if status is "error" */
  error?: string;
}
```

### Error Handling

- If `cwd` does not exist: Throw `Error("Working directory does not exist: <path>")`
- If `cwd` is not a directory: Throw `Error("Path is not a directory: <path>")`
- If metadata directory creation fails: Log error and rethrow
- If cleanup fails: Log error but do not rethrow (best-effort cleanup)

## Acceptance Criteria

- [ ] `SimpleRunnerStrategy` implements `RunnerStrategy` interface from `00a-runner-types.md`
- [ ] Simple agent runs in the provided `--cwd` directory
- [ ] Metadata is created in `simple-tasks/{threadId}/` directory
- [ ] No worktree allocation is attempted
- [ ] `thread:created` event is emitted on setup
- [ ] `thread:status:changed` event is emitted on cleanup
- [ ] Error cases are handled gracefully with descriptive messages
- [ ] Backward compatible with existing `simple-runner.ts` behavior

## Testing Notes

- Unit tests should mock file system operations
- Integration tests should verify actual file creation/updates
- Test error scenarios: missing cwd, invalid cwd, cleanup failures

## Estimated Effort

Medium (~2-3 hours)
