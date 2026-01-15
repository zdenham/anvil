# Phase 0c: Task Runner Strategy

## Overview

Implement `TaskRunnerStrategy` for task-based agents (research, execution, merge). This strategy handles the orchestration logic for agents that operate within a task context, including worktree allocation and task metadata management.

## Dependencies

- `00a-runner-types.md` - Provides `RunnerStrategy`, `RunnerConfig`, and `OrchestrationContext` interfaces
- `00b-runner-shared-extraction.md` - Provides `emitEvent`, `emitState`, and other shared utilities

## Parallel With

- `00d-simple-runner-strategy.md` - Both strategies can be developed simultaneously as they share no implementation dependencies beyond the types and shared code

## Files to Create

### `agents/src/runners/task-runner-strategy.ts`

```typescript
import type { RunnerStrategy, RunnerConfig, OrchestrationContext } from "./types";
import { parseArgs } from "./args"; // existing arg parsing
import { orchestrate } from "../orchestration";
import { ThreadService } from "@/services/thread-service";
import { TaskMetadataService } from "@/services/task-metadata-service";
import { WorktreeAllocationService } from "@/services/worktree-allocation-service";
import { RepositorySettingsService } from "@/services/repository-settings-service";
import { emitEvent } from "./shared";

export class TaskRunnerStrategy implements RunnerStrategy {
  parseArgs(args: string[]): RunnerConfig {
    // 1. Parse CLI args using existing parseArgs utility
    // 2. Validate required args: --task-slug, --thread-id, --mort-dir, --agent
    // 3. Validate agent type is one of: research, execution, merge
    // 4. Return normalized config with all required fields
    // 5. Throw descriptive error if validation fails
  }

  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    // 1. Load repository settings via RepositorySettingsService
    // 2. Load task metadata via TaskMetadataService using config.taskSlug
    // 3. Create thread record via ThreadService
    // 4. Emit thread:created event with { threadId, taskSlug, agent }
    // 5. If useWorktrees enabled in settings:
    //    a. Allocate worktree via WorktreeAllocationService
    //    b. Emit worktree:allocated event with { threadId, worktreePath }
    // 6. Determine workingDir (worktree path or sourcePath from settings)
    // 7. Return OrchestrationContext with:
    //    - workingDir: allocated worktree or sourcePath
    //    - task: loaded TaskMetadata
    //    - threadId: from config
    //    - cleanup: bound cleanup function for signal handlers
  }

  async cleanup(context: OrchestrationContext): Promise<void> {
    // 1. If worktree was allocated:
    //    a. Release worktree via WorktreeAllocationService
    //    b. Emit worktree:released event with { threadId, worktreePath }
    // 2. Update thread status via ThreadService (complete or error)
    // 3. Emit thread:status:changed event with { threadId, status }
    // Note: Called on both successful completion and error/signal
  }
}
```

## Implementation Notes

### Arg Parsing Requirements

Extract and consolidate arg parsing for task-based agents:

| Argument | Required | Description |
|----------|----------|-------------|
| `--agent` | Yes | One of: `research`, `execution`, `merge` |
| `--task-slug` | Yes | Task identifier (e.g., `add-dark-mode`) |
| `--thread-id` | Yes | UUID for the thread |
| `--mort-dir` | Yes | Path to `.mort` directory |
| `--prompt` | No | Optional additional prompt text |

### Setup Sequence (from `orchestrate()`)

The setup phase extracts logic currently in `orchestrate()`:

1. **Load repository settings** - Determines if worktrees are enabled
2. **Load task metadata** - Gets task description, status, dependencies
3. **Create thread record** - Persists thread state for UI/debugging
4. **Allocate worktree** (conditional) - Isolates agent's git operations
5. **Return working directory** - Either worktree path or main repo

### Cleanup Sequence

The cleanup phase ensures resources are properly released:

1. **Release worktree** - Returns worktree to pool for reuse
2. **Update thread status** - Mark as complete, error, or cancelled
3. **Emit final events** - Allow UI to update status

### Key Services Used

| Service | Purpose |
|---------|---------|
| `TaskMetadataService` | Load/update task metadata from `tasks/{slug}/metadata.json` |
| `ThreadService` | Create/update thread records in `threads/{agent}-{threadId}/` |
| `WorktreeAllocationService` | Allocate/release worktrees from configured pool |
| `RepositorySettingsService` | Load settings from `.mort/settings.json` |

### Key Differences from SimpleRunnerStrategy

| Aspect | TaskRunnerStrategy | SimpleRunnerStrategy |
|--------|-------------------|---------------------|
| Working dir | Allocated worktree or sourcePath | Provided `--cwd` |
| Task metadata | `tasks/{slug}/metadata.json` | `simple-tasks/{threadId}/metadata.json` |
| Worktrees | Optional (via settings) | Never used |
| Thread folder | `threads/{agent}-{threadId}/` | N/A |
| Required args | `--task-slug`, `--agent`, `--thread-id`, `--mort-dir` | `--cwd`, `--thread-id`, `--mort-dir`, `--prompt` |

## Error Handling

- **Missing task metadata**: Throw with message including task slug and expected path
- **Invalid agent type**: Throw listing valid options (research, execution, merge)
- **Worktree allocation failure**: Log warning, fall back to sourcePath, emit event
- **Cleanup errors**: Log but don't throw (cleanup should be best-effort)

## Testing Strategy

1. **Unit tests** for `parseArgs()` - Valid/invalid arg combinations
2. **Unit tests** for `setup()` - Mock services, verify event emission
3. **Unit tests** for `cleanup()` - Verify resource release order
4. **Integration test** - Full lifecycle with real services (see Phase 1)

## Acceptance Criteria

- [ ] `TaskRunnerStrategy` implements `RunnerStrategy` interface
- [ ] All task-based agent types work (research, execution, merge)
- [ ] Thread creation emits `thread:created` event with correct payload
- [ ] Worktree allocation works when enabled in repository settings
- [ ] Worktree allocation gracefully falls back when disabled or unavailable
- [ ] Cleanup properly releases resources even on error paths
- [ ] Backward compatible with existing `runner.ts` behavior
- [ ] Error messages are descriptive and actionable

## Estimated Effort

Medium-High (~3-4 hours)

- Arg parsing and validation: ~30 min
- Setup implementation: ~1.5 hours
- Cleanup implementation: ~30 min
- Error handling: ~30 min
- Testing: ~1 hour
