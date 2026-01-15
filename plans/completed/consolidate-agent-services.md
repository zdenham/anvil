# Plan: Consolidate simple-agent-service into agent-service

## Overview

Merge `simple-agent-service.ts` into `agent-service.ts` to eliminate ~300 lines of duplicate code and **fix broken wiring** between frontend and runner.

### Current Problems

1. **Broken runner path**: `simple-agent-service.ts` references `simple-runner.js` which doesn't exist. The unified `runner.js` already supports `--agent simple` via `SimpleRunnerStrategy`.

2. **State path mismatch**: Frontend expects `simple-tasks/{taskId}/threads/simple-{threadId}/state.json` but runner writes to `simple-tasks/{threadId}/state.json`.

3. **Duplicate code**: Both services have nearly identical spawn logic, process tracking, output parsing, and event handling.

### Architecture After Consolidation

| Aspect | simple-agent (via agent-service) | orchestrated-agent |
|--------|----------------------------------|-------------------|
| Runner | `runner.js --agent simple` | `runner.js --agent {type}` |
| Orchestration | None - runs in sourcePath | Worktree allocation via Node |
| State path | `simple-tasks/{threadId}/state.json` | `tasks/{slug}/threads/{type}-{id}/state.json` |
| Process tracking | `activeSimpleProcesses` Map | None (managed by orchestration) |

## Files to Modify

1. **`src/lib/agent-service.ts`** - Add simple agent functions
2. **`src/lib/simple-agent-service.ts`** - Delete entirely
3. **`src/components/spotlight/spotlight.tsx`** - Update import
4. **`src/components/simple-task/simple-task-window.tsx`** - Update import

## Implementation Steps

### Step 1: Add process tracking to agent-service.ts

Add the `activeSimpleProcesses` Map for cancellation support (simple agents only - orchestrated agents don't need this since they're tracked by the orchestration layer):

```typescript
// Track active simple agent processes for cancellation
const activeSimpleProcesses = new Map<string, Child>();

export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = activeSimpleProcesses.get(threadId);
  if (process) {
    await process.kill();
    activeSimpleProcesses.delete(threadId);
    logger.info("[agent-service] Cancelled simple agent", { threadId });
  }
}

export function isSimpleAgentRunning(threadId: string): boolean {
  return activeSimpleProcesses.has(threadId);
}
```

### Step 2: Add SpawnSimpleAgentOptions interface

```typescript
export interface SpawnSimpleAgentOptions {
  taskId: string;
  threadId: string;
  prompt: string;
  /** Repository source path - agent runs here directly (no worktree) */
  sourcePath: string;
}
```

### Step 3: Add getRunnerPath helper (reuse existing logic)

The existing `spawnAgentWithOrchestration` already resolves runner path. Extract to shared helper:

```typescript
async function getRunnerPaths(): Promise<{
  runnerPath: string;
  nodeModulesPath: string;
  cliPath: string;
}> {
  if (isDev) {
    return {
      runnerPath: `${__PROJECT_ROOT__}/agents/dist/runner.js`,
      nodeModulesPath: `${__PROJECT_ROOT__}/agents/node_modules`,
      cliPath: `${__PROJECT_ROOT__}/agents/dist/cli/mort.js`,
    };
  }
  const runnerPath = await resolveResource("_up_/agents/dist/runner.js");
  const agentsDistDir = await dirname(runnerPath);
  const agentsDir = await dirname(agentsDistDir);
  return {
    runnerPath,
    nodeModulesPath: await join(agentsDir, "node_modules"),
    cliPath: await join(agentsDistDir, "cli", "mort.js"),
  };
}
```

### Step 4: Add spawnSimpleAgent function

Create new function that:
- Uses `runner.js` with `--agent simple` flag
- Sets cwd to `sourcePath` (no worktree orchestration)
- Uses eventBus for all callbacks (no AgentStreamCallbacks)
- Stores process handle in `activeSimpleProcesses` Map
- Emits: `AGENT_SPAWNED`, `AGENT_STATE`, `AGENT_COMPLETED`

```typescript
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  logger.info("[agent-service] spawnSimpleAgent START");

  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Command args for simple agent - matches SimpleRunnerStrategy.parseArgs()
  const commandArgs = [
    runnerPath,
    "--agent", "simple",
    "--thread-id", options.threadId,
    "--cwd", options.sourcePath,
    "--prompt", options.prompt,
    "--mort-dir", mortDir,
  ];

  const command = Command.create("node", commandArgs, {
    cwd: options.sourcePath,
    env: {
      NODE_PATH: nodeModulesPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  // Line buffer for stdout - shell plugin may split JSON across chunks
  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(options.threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  command.on("close", (code) => {
    activeSimpleProcesses.delete(options.threadId);
    if (code.code !== 0) {
      logger.error("[simple-agent] Process exited with code", { code: code.code });
    }
    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId: options.threadId,
      exitCode: code.code ?? -1,
    });
  });

  const child = await command.spawn();
  activeSimpleProcesses.set(options.threadId, child);

  eventBus.emit(EventName.AGENT_SPAWNED, {
    threadId: options.threadId,
    taskId: options.taskId,
  });

  logger.info("[agent-service] spawnSimpleAgent COMPLETE");
}
```

### Step 5: Add handleSimpleAgentOutput function

Reuse existing `parseAgentOutput` and `handleAgentEvent`:

```typescript
function handleSimpleAgentOutput(
  threadId: string,
  data: string,
  buffer: { value: string }
): void {
  buffer.value += data;

  const lines = buffer.value.split("\n");
  buffer.value = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;

    const output = parseAgentOutput(line);
    if (output) {
      switch (output.type) {
        case "log": {
          const level = output.level.toLowerCase() as "debug" | "info" | "warn" | "error";
          const message = `[simple-agent:${threadId}] ${output.message}`;
          switch (level) {
            case "error": logger.error(message); break;
            case "warn": logger.warn(message); break;
            case "debug": logger.debug(message); break;
            default: logger.info(message);
          }
          break;
        }

        case "event":
          handleAgentEvent(output);
          break;

        case "state":
          eventBus.emit(EventName.AGENT_STATE, {
            threadId,
            state: output.state,
          });
          break;
      }
    } else {
      logger.debug(`[simple-agent:${threadId}] ${line}`);
    }
  }
}
```

### Step 6: Add resumeSimpleAgent function

**Key fix**: State path must match what `SimpleRunnerStrategy` creates: `simple-tasks/{threadId}/state.json`

```typescript
export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
  sourcePath: string,
): Promise<void> {
  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // State path matches SimpleRunnerStrategy: simple-tasks/{threadId}/state.json
  const stateFilePath = await join(mortDir, "simple-tasks", threadId, "state.json");

  const commandArgs = [
    runnerPath,
    "--agent", "simple",
    "--thread-id", threadId,
    "--cwd", sourcePath,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
  ];

  logger.info("[agent-service] Resuming simple agent", { taskId, threadId });

  const command = Command.create("node", commandArgs, {
    cwd: sourcePath,
    env: {
      NODE_PATH: nodeModulesPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  command.on("close", (code) => {
    activeSimpleProcesses.delete(threadId);
    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId,
      exitCode: code.code ?? -1,
    });
  });

  const child = await command.spawn();
  activeSimpleProcesses.set(threadId, child);
}
```

### Step 7: Update callers

**spotlight.tsx** (line 27):
```typescript
// Before
import { spawnSimpleAgent } from "../../lib/simple-agent-service";
// After
import { spawnSimpleAgent } from "../../lib/agent-service";
```

**simple-task-window.tsx** (line 3):
```typescript
// Before
import { resumeSimpleAgent } from "@/lib/simple-agent-service";
// After
import { resumeSimpleAgent } from "@/lib/agent-service";
```

### Step 8: Delete simple-agent-service.ts

Remove the file entirely once callers are updated.

## Shared Code Reused from agent-service.ts

- `getShellPath()` - cached shell PATH resolution
- `parseAgentOutput()` - imported from shared utility
- `handleAgentEvent()` - routes events to eventBus
- Path resolution logic (extracted to `getRunnerPaths()`)

## Event Protocol (Must Preserve)

Both callers depend on these eventBus emissions:
- `EventName.AGENT_SPAWNED` - When process starts
- `EventName.AGENT_STATE` - Stream of state updates
- `EventName.AGENT_COMPLETED` - When process exits
- Passthrough events: `THREAD_CREATED`, `THREAD_UPDATED`, `THREAD_STATUS_CHANGED`

## CLI Args Alignment

SimpleRunnerStrategy expects these args (see `agents/src/runners/simple-runner-strategy.ts:55`):

| Arg | Required | Description |
|-----|----------|-------------|
| `--agent simple` | Yes | Selects SimpleRunnerStrategy |
| `--cwd <path>` | Yes | Working directory (must exist) |
| `--thread-id <uuid>` | Yes | Thread identifier |
| `--mort-dir <path>` | Yes | Data directory |
| `--prompt <string>` | Yes | User prompt |
| `--history-file <path>` | No | For resuming with prior messages |

**Note**: `--task-id` is NOT parsed by SimpleRunnerStrategy. The old code passed it but it was ignored. We remove it for clarity.

## Verification

1. **Build check**: `pnpm build` succeeds
2. **Type check**: `pnpm typecheck` passes
3. **Manual test - Spotlight simple task**:
   - Open Spotlight (Cmd+K or similar)
   - Type a prompt and press Enter (not Cmd+Enter)
   - Verify agent spawns and runs in source repo
   - Verify state updates appear in UI
4. **Manual test - Resume simple task**:
   - After agent completes or pauses
   - Submit follow-up prompt in simple-task window
   - Verify conversation continues with history
5. **Manual test - Cancel**:
   - Start a simple task
   - Cancel mid-execution
   - Verify process terminates cleanly

## Rollback

If issues arise, the git history preserves `simple-agent-service.ts` for easy revert.
