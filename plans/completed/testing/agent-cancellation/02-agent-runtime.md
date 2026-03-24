# Sub-Plan 02: Agent Runtime

**Prerequisite:** 01-core-types.md (NOT YET IMPLEMENTED - "cancelled" status must be added first)
**Can run parallel with:** 03-frontend-integration.md
**File tree:** `agents/src/*` only (no overlap with 03)
**Status:** NOT STARTED

## Overview

Make the Node.js agent process respond to SIGTERM by aborting the Claude SDK query and exiting gracefully with status "cancelled".

## Current State Analysis

After reviewing the codebase, here is what exists:

### Existing Infrastructure
- `setupSignalHandlers()` exists in `agents/src/runners/shared.ts` but only handles cleanup and exits with code 0
- `AgentLoopOptions` interface exists but has no `abortController` property
- `output.ts` has `complete()` and `error()` functions but no `cancelled()`
- The Claude SDK's `query()` function supports `abortController` option (per SDK docs)
- `SimpleRunnerStrategy` already uses "cancelled" status for task metadata (line 30, 402, 415)
- `TaskRunnerStrategy` cleanup only handles "completed" | "error"

### Missing Pieces
1. AbortController support in agent loop
2. Signal handler integration with AbortController
3. `cancelled()` output function
4. AbortError handling in runner
5. RunnerStrategy cleanup signature needs "cancelled" status

## Changes

### 1. Update RunnerStrategy cleanup signature

**File: `agents/src/runners/types.ts`**

The cleanup method signature needs to support "cancelled" status:

```typescript
// Current (line 103-110):
cleanup(
  context: OrchestrationContext,
  status: "completed" | "error",
  error?: string
): Promise<void>;

// After:
cleanup(
  context: OrchestrationContext,
  status: "completed" | "error" | "cancelled",
  error?: string
): Promise<void>;
```

### 2. Add AbortController Support to AgentLoopOptions

**File: `agents/src/runners/shared.ts`**

Update the `AgentLoopOptions` interface (line 115-122):

```typescript
export interface AgentLoopOptions {
  /** Called after file-modifying tools to emit file changes */
  onFileChange?: (toolName: string) => void;
  /** Stop hook for validation (task-based only) */
  stopHook?: () => Promise<{ decision: "approve" } | { decision: "block"; reason: string }>;
  /** Thread writer for resilient state writes (task-based only) */
  threadWriter?: ThreadWriter;
  /** AbortController for cancellation support */
  abortController?: AbortController;
}
```

### 3. Pass AbortController to SDK query()

**File: `agents/src/runners/shared.ts`**

In `runAgentLoop()`, update the `query()` call (around line 290-313) to include the abort controller:

```typescript
const result = useMockMode
  ? mockQuery({
      // ... existing mock options ...
    })
  : query({
      prompt: config.prompt,
      options: {
        cwd: context.workingDir,
        additionalDirectories: [config.anvilDir],
        model: agentConfig.model ?? "claude-opus-4-5-20251101",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: systemPrompt,
        },
        tools: agentConfig.tools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: false,
        ...(priorMessages.length > 0 && { messages: priorMessages }),
        ...(canUseTool && { canUseTool }),
        ...(options.abortController && { abortController: options.abortController }),
        hooks,
      },
    });
```

### 4. Update setupSignalHandlers for Abort Support

**File: `agents/src/runners/shared.ts`**

Modify `setupSignalHandlers` (lines 98-110) to accept an optional AbortController:

```typescript
/**
 * Set up signal handlers for graceful shutdown with optional abort support.
 * When abortController is provided, signals trigger abort instead of immediate exit.
 * The actual exit happens after the abort is processed in the main loop.
 */
export function setupSignalHandlers(
  cleanup: () => Promise<void>,
  abortController?: AbortController
): void {
  let isShuttingDown = false;

  const handler = async (signal: string) => {
    // Prevent multiple simultaneous shutdown attempts
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[runner] Received ${signal}, initiating shutdown...`);

    if (abortController) {
      // Signal abort - let the main loop handle graceful exit
      abortController.abort();
      // Note: Don't exit here - let the abort propagate through the SDK
      // The main loop catch block will call cleanup and exit with code 130
    } else {
      // No abort controller - direct cleanup and exit (legacy behavior)
      await cleanup();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
```

### 5. Add cancelled() Output Function

**File: `agents/src/output.ts`**

Add a new function to emit cancelled state (after the `error()` function around line 193):

```typescript
/**
 * Mark the thread as cancelled.
 * Called when agent receives abort signal.
 * Returns a promise that resolves when state is persisted to disk.
 */
export async function cancelled(): Promise<void> {
  markOrphanedToolsAsError();
  state.status = "cancelled";
  await emitState();
}
```

Export it from the module (it's already exported implicitly since it's a named export).

**Note:** This requires 01-core-types.md to be completed first, as `AgentThreadStatusSchema` needs to include "cancelled" for the type assignment to work.

### 6. Handle AbortError in Runner

**File: `agents/src/runner.ts`**

Update `main()` (lines 105-188) to create an AbortController and handle abort:

```typescript
import { cancelled } from "./output.js";

async function main(): Promise<void> {
  // Set up `anvil` command before anything else
  setupAnvilCommand();

  let strategy: RunnerStrategy | undefined;
  let context: OrchestrationContext | undefined;

  // Create abort controller for cancellation support
  const abortController = new AbortController();

  try {
    const args = process.argv.slice(2);
    strategy = getStrategy(args);

    // Log the strategy
    emitLog(
      "INFO",
      `Starting agent with strategy: ${strategy.constructor.name}`
    );

    // Parse args using strategy-specific logic
    const config = strategy.parseArgs(args);

    // Set ANVIL_DATA_DIR env var so the `anvil` CLI can find the correct data directory
    process.env.ANVIL_DATA_DIR = config.anvilDir;

    // Get agent configuration (model, tools, prompts)
    const agentConfig = getAgentConfig(config.agent);

    // Override appended prompt if provided via CLI
    if (config.appendedPrompt) {
      agentConfig.appendedPrompt = config.appendedPrompt;
    }

    // Set up orchestration context (working directory, task metadata, etc.)
    context = await strategy.setup(config);

    // Set up signal handlers with abort support
    // Pass abortController so signals trigger abort instead of immediate exit
    setupSignalHandlers(async () => {
      if (context && strategy) {
        await strategy.cleanup(context, "cancelled");
      }
    }, abortController);

    // Load prior messages from history file if resuming
    const priorMessages = loadPriorMessages(config.historyFile);

    // Run the common agent loop with abort controller
    await runAgentLoop(config, context, agentConfig, priorMessages, {
      abortController,
    });

    // Clean up on successful completion
    await strategy.cleanup(context, "completed");

    logger.info("[runner] Agent completed successfully");
    process.exit(0);
  } catch (error) {
    // Check if this is an abort/cancellation
    const isAbort = error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('aborted'));

    if (isAbort) {
      // Graceful cancellation
      logger.info("[runner] Agent cancelled");
      await cancelled();

      // Attempt cleanup
      if (strategy && context) {
        try {
          await strategy.cleanup(context, "cancelled");
        } catch (cleanupError) {
          emitLog("WARN", `Cleanup after cancel: ${cleanupError}`);
        }
      }

      process.exit(130); // Standard cancelled exit code (128 + SIGINT)
    }

    // Existing error handling
    emitLog(
      "ERROR",
      `Agent failed: ${error instanceof Error ? error.message : String(error)}`
    );

    // Attempt cleanup even on error
    if (strategy && context) {
      try {
        await strategy.cleanup(
          context,
          "error",
          error instanceof Error ? error.message : String(error)
        );
      } catch (cleanupError) {
        emitLog(
          "ERROR",
          `Cleanup failed: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`
        );
      }
    }

    process.exit(1);
  }
}
```

### 7. Update Strategy cleanup() implementations

**File: `agents/src/runners/simple-runner-strategy.ts`**

Update the cleanup signature (line 339-343):

```typescript
async cleanup(
  context: OrchestrationContext,
  status: "completed" | "error" | "cancelled",
  error?: string
): Promise<void> {
```

The thread status mapping (line 366) needs to handle "cancelled":

```typescript
const updated: SimpleThreadMetadata = {
  ...parseResult.data,
  status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "error",
  updatedAt: now,
  turns,
};
```

**Note:** This requires 01-core-types.md to add "cancelled" to `ThreadStatus` and the schema.

**File: `agents/src/runners/task-runner-strategy.ts`**

Update the cleanup signature (line 365-369):

```typescript
async cleanup(
  context: OrchestrationContext,
  status: "completed" | "error" | "cancelled",
  error?: string
): Promise<void> {
```

Update thread status handling (lines 423-427):

```typescript
if (status === "completed") {
  threadService.markCompleted(taskSlug, threadFolderName);
} else if (status === "cancelled") {
  threadService.markCancelled(taskSlug, threadFolderName); // New method needed
} else {
  threadService.markError(taskSlug, threadFolderName);
}
```

**Note:** This requires adding `markCancelled()` method to ThreadService in `core/services/thread/thread-service.ts`.

## Additional Required Changes

### 8. Add markCancelled to ThreadService

**File: `core/services/thread/thread-service.ts`**

Add a new method:

```typescript
/**
 * Mark a thread as cancelled.
 */
markCancelled(taskSlug: string, threadFolderName: string): void {
  const threadPath = join(
    this.anvilDir,
    "tasks",
    taskSlug,
    "threads",
    threadFolderName
  );
  const metadataPath = join(threadPath, "metadata.json");

  const content = this.fs.readFileSync(metadataPath);
  const metadata = ThreadMetadataSchema.parse(JSON.parse(content));

  const updated = {
    ...metadata,
    status: "cancelled" as const,
    updatedAt: Date.now(),
  };

  this.fs.writeFileSync(metadataPath, JSON.stringify(updated, null, 2));
}
```

## Dependency Graph

```
01-core-types.md
    │
    ├── Add "cancelled" to AgentThreadStatusSchema (required for output.ts)
    ├── Add "cancelled" to ThreadStatus (required for strategy cleanup)
    └── Add "cancelled" to ThreadMetadataSchema (required for ThreadService)
         │
         ▼
02-agent-runtime.md (this plan)
    │
    ├── 1. Update RunnerStrategy.cleanup signature
    ├── 2. Add abortController to AgentLoopOptions
    ├── 3. Pass abortController to SDK query()
    ├── 4. Update setupSignalHandlers
    ├── 5. Add cancelled() to output.ts
    ├── 6. Handle AbortError in runner.ts
    ├── 7. Update strategy cleanup() implementations
    └── 8. Add markCancelled to ThreadService
```

## Verification

### Unit Test

Create a test file `agents/src/runners/cancellation.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("cancellation", () => {
  it("should detect AbortError correctly", () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";

    const isAbort = abortError.name === 'AbortError' ||
      abortError.message.includes('aborted');

    expect(isAbort).toBe(true);
  });
});
```

### Manual Test

```bash
# Start an agent
pnpm agent:run --agent simple --task-id test --thread-id test-thread --cwd /tmp --anvil-dir ~/.anvil-dev --prompt "Hello"

# In another terminal, send SIGTERM
kill -TERM <pid>

# Check state.json has status: "cancelled"
cat ~/.anvil-dev/tasks/test/threads/simple-test-thread/state.json | jq .status
# Should output: "cancelled"

# Check exit code was 130
echo $?
# Should output: 130
```

## Files Modified

| File | Changes |
|------|---------|
| `agents/src/runners/types.ts` | Add "cancelled" to cleanup status parameter |
| `agents/src/runners/shared.ts` | AbortController support in options and signal handlers |
| `agents/src/output.ts` | Add `cancelled()` function |
| `agents/src/runner.ts` | Create AbortController, handle AbortError |
| `agents/src/runners/simple-runner-strategy.ts` | Update cleanup signature and status mapping |
| `agents/src/runners/task-runner-strategy.ts` | Update cleanup signature and add cancelled handling |
| `core/services/thread/thread-service.ts` | Add `markCancelled()` method |

## Implementation Order

1. First complete 01-core-types.md (prerequisite)
2. Update types.ts (cleanup signature)
3. Update shared.ts (AbortController support)
4. Update output.ts (cancelled function)
5. Add markCancelled to ThreadService
6. Update strategy implementations
7. Update runner.ts (main orchestration)
8. Test manually and with unit tests

## Open Questions

1. **SDK AbortController behavior:** Need to verify exact error type/message thrown by Claude SDK when aborted. The plan assumes `error.name === 'AbortError'` but should be tested.

2. **Cleanup idempotency:** The current implementation calls cleanup from both signal handler callback AND catch block. Need to ensure cleanup is idempotent or add guard logic.

3. **Exit code convention:** Using 130 (128 + SIGINT). Should we differentiate between SIGTERM (143) and SIGINT (130)?
