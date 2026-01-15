# Phase 0e: Unified Runner Entry Point

## Overview

Modify `runner.ts` to be the single entry point for all agent types using the strategy pattern. This is the final integration step for Phase 0, consolidating task-based agents (`research`, `execution`, `merge`) and the `simple` agent into a unified runner with consistent CLI behavior and stdout protocols.

## Dependencies

- `00a-runner-types.md` - `RunnerStrategy`, `RunnerConfig`, `OrchestrationContext` interfaces
- `00b-runner-shared-extraction.md` - `runAgentLoop`, `setupSignalHandlers`, `emitLog`, `emitEvent`
- `00c-task-runner-strategy.md` - `TaskRunnerStrategy` implementation
- `00d-simple-runner-strategy.md` - `SimpleRunnerStrategy` implementation

## Parallel With

- None (this is the final integration step for Phase 0)

## Files to Modify

### `agents/src/runner.ts`

```typescript
import { TaskRunnerStrategy } from "./runners/task-runner-strategy";
import { SimpleRunnerStrategy } from "./runners/simple-runner-strategy";
import { runAgentLoop, setupSignalHandlers, emitLog } from "./runners/shared";
import type { RunnerStrategy } from "./runners/types";

/**
 * Parse --agent flag to determine which strategy to use.
 * @throws Error if --agent flag is missing or agent type is unknown
 */
function getStrategy(args: string[]): RunnerStrategy {
  const agentIndex = args.indexOf("--agent");
  if (agentIndex === -1 || !args[agentIndex + 1]) {
    throw new Error("Missing required --agent flag");
  }

  const agentType = args[agentIndex + 1];

  switch (agentType) {
    case "simple":
      return new SimpleRunnerStrategy();
    case "research":
    case "execution":
    case "merge":
      return new TaskRunnerStrategy();
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

async function main(): Promise<void> {
  let strategy: RunnerStrategy | undefined;
  let context: import("./runners/types").OrchestrationContext | undefined;

  try {
    const args = process.argv.slice(2);
    strategy = getStrategy(args);

    emitLog("INFO", `Starting agent with strategy: ${strategy.constructor.name}`);

    // Parse args using strategy-specific logic
    const config = strategy.parseArgs(args);

    // Set up orchestration context (working directory, task metadata, etc.)
    context = await strategy.setup(config);

    // Set up signal handlers for graceful shutdown
    setupSignalHandlers(async () => {
      if (context) {
        await strategy!.cleanup(context);
      }
    });

    // Run the common agent loop (LLM queries, tool calls, state emission)
    await runAgentLoop(config, context);

    // Clean up on successful completion
    await strategy.cleanup(context);

    process.exit(0);
  } catch (error) {
    emitLog("ERROR", `Agent failed: ${error instanceof Error ? error.message : String(error)}`);

    // Attempt cleanup even on error
    if (strategy && context) {
      try {
        await strategy.cleanup(context);
      } catch (cleanupError) {
        emitLog("ERROR", `Cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
    }

    process.exit(1);
  }
}

main();
```

## CLI Interface

All agent types are invoked through a single entry point with consistent argument patterns.

### Task-Based Agents (research, execution, merge)

```bash
node runner.js \
  --agent research|execution|merge \
  --task-slug <slug> \
  --thread-id <uuid> \
  --mort-dir <path> \
  --prompt "<task description>"
```

**Required arguments:**
- `--agent` - Agent type: `research`, `execution`, or `merge`
- `--task-slug` - Task identifier (e.g., `add-dark-mode`)
- `--thread-id` - UUID for the thread
- `--mort-dir` - Path to the `.mort` directory
- `--prompt` - Task description/instructions

### Simple Agent

```bash
node runner.js \
  --agent simple \
  --cwd <path> \
  --thread-id <uuid> \
  --mort-dir <path> \
  --prompt "<task description>"
```

**Required arguments:**
- `--agent` - Must be `simple`
- `--cwd` - Working directory for the agent
- `--thread-id` - UUID for the thread
- `--mort-dir` - Path to the `.mort` directory
- `--prompt` - Task description/instructions

### Stdout Protocol

All agents emit JSON lines to stdout with the following message types:

| Type | Description | Example |
|------|-------------|---------|
| `log` | Log messages with level | `{"type":"log","level":"INFO","message":"..."}` |
| `event` | Lifecycle events | `{"type":"event","name":"thread:created","payload":{...}}` |
| `state` | Thread state updates | `{"type":"state","state":{...}}` |

## Migration Steps

1. **Ensure dependencies are complete**
   - Verify `runners/types.ts` exists (from 00a)
   - Verify `runners/shared.ts` exists with `runAgentLoop`, `setupSignalHandlers`, `emitLog` (from 00b)
   - Verify `TaskRunnerStrategy` exists and is tested (from 00c)
   - Verify `SimpleRunnerStrategy` exists and is tested (from 00d)

2. **Backup existing behavior**
   - Capture current stdout output for each agent type to use as test fixtures
   - Document any edge cases in current `runner.ts` behavior

3. **Refactor `runner.ts`**
   - Replace existing implementation with strategy-based approach
   - Ensure error handling includes cleanup attempts

4. **Integration testing**
   - Test each agent type individually:
     - `--agent research`
     - `--agent execution`
     - `--agent merge`
     - `--agent simple`
   - Verify stdout output matches expected protocol
   - Test signal handling (SIGTERM, SIGINT)
   - Test error scenarios and cleanup

5. **Update dependent scripts**
   - Update any shell scripts or orchestration code that invokes the runner
   - Update documentation if CLI arguments changed

## Files to Delete (deferred to Phase 0g)

After confirming the unified runner works correctly:

- `agents/src/simple-runner.ts`
- `agents/src/simple-runner-args.ts`

## Acceptance Criteria

- [ ] Single `runner.ts` handles all agent types via strategy pattern
- [ ] CLI interface is documented with required/optional arguments for each agent type
- [ ] All existing agent types work correctly (`research`, `execution`, `merge`, `simple`)
- [ ] Stdout protocol unchanged (log, event, state JSON lines)
- [ ] Error handling includes cleanup attempts before exit
- [ ] Signal handlers (SIGTERM, SIGINT) trigger graceful cleanup
- [ ] Unknown agent types produce clear error messages
- [ ] Missing required arguments produce clear error messages

## Testing Notes

Key scenarios to cover:

1. **Happy path** - Each agent type completes successfully
2. **Error during setup** - Verify no orphaned resources
3. **Error during agent loop** - Verify cleanup is called
4. **SIGTERM/SIGINT** - Verify graceful shutdown
5. **Invalid arguments** - Verify helpful error messages
6. **Unknown agent type** - Verify clear error message

## Estimated Effort

Medium (~2-3 hours)
