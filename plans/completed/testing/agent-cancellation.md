# Agent Cancellation Support

## Problem Statement

Users currently cannot cancel running agents. Once an agent is spawned, it runs until completion, error, or process termination. This creates a poor UX when:
- The agent is stuck in an infinite loop
- The user realizes the prompt was wrong
- Cost is accumulating on an unwanted task
- The user wants to pivot to a different approach

## Architecture Overview

### Current Flow

```
Frontend (Tauri) → spawn Node process → runner.ts → query() → Claude API
                                           ↓
                              setupSignalHandlers (in runners/shared.ts)
                                           ↓
                              setupCleanup (in orchestration.ts - worktree release)
```

### Key Components

1. **`src/lib/agent-service.ts`** - Spawns Node process via Tauri shell plugin
   - Already has `activeSimpleProcesses` Map and `cancelSimpleAgent()` for simple agents
   - Missing: Process tracking for orchestrated agents (`spawnAgentWithOrchestration`, `resumeAgent`)
2. **`agents/src/runner.ts`** - Main entry point, uses strategy pattern
3. **`agents/src/runners/shared.ts`** - Contains `runAgentLoop()`, `setupSignalHandlers()`, calls SDK `query()`
4. **`agents/src/orchestration.ts`** - Worktree allocation, `setupCleanup()` for worktree release
5. **`agents/src/output.ts`** - State emission functions (`complete()`, `error()`, `emitState()`)

### Claude Agent SDK Cancellation Support

The SDK provides the **`abortController`** option:

```typescript
query({
  prompt,
  options: {
    abortController: myController,
    // ...
  }
})
```

When `abortController.abort()` is called, the SDK stops processing and throws an `AbortError`.

### Existing Infrastructure to Build On

**Simple agents already have cancellation support:**

```typescript
// From agent-service.ts (lines 37-38, 759-766)
const activeSimpleProcesses = new Map<string, Child>();

export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = activeSimpleProcesses.get(threadId);
  if (process) {
    await process.kill();
    activeSimpleProcesses.delete(threadId);
    logger.info("[agent-service] Cancelled simple agent", { threadId });
  }
}
```

**This implementation will extend this pattern to ALL agent types.**

## Proposed Implementation

### Phase 1: Type Updates (Prerequisites)

Update types FIRST since subsequent phases depend on them.

#### 1.1 Add "cancelled" to AgentThreadStatus

**File: `core/types/events.ts`**

Update the `AgentThreadStatusSchema` to include "cancelled":

```typescript
// Line 36 - update the schema
export const AgentThreadStatusSchema = z.enum(["running", "complete", "error", "cancelled"]);
```

This enables the agent to emit "cancelled" status in state emissions.

#### 1.2 Add AGENT_CANCELLED Event

**File: `core/types/events.ts`**

Add new event name and payload:

```typescript
// In EventName object (around line 64)
export const EventName = {
  // ... existing events ...

  // Agent process
  AGENT_CANCELLED: "agent:cancelled",
} as const;

// In EventPayloads interface (around line 107)
export interface EventPayloads {
  // ... existing payloads ...

  [EventName.AGENT_CANCELLED]: { threadId: string };
}

// Update EventNameSchema (around line 197)
export const EventNameSchema = z.enum([
  // ... existing events ...
  EventName.AGENT_CANCELLED,
]);
```

#### 1.3 ThreadStatus vs AgentThreadStatus Mapping

**Important clarification:** These are two different enums with different values:

| Context | Enum | Values | Used By |
|---------|------|--------|---------|
| Agent output (state.json) | `AgentThreadStatus` | "running", "complete", "error", "cancelled" | Node agent process |
| Thread metadata (metadata.json) | `ThreadStatus` | "idle", "running", "completed", "error", "paused", "cancelled" | Frontend Tauri app |

**Mapping:**
- Agent `"complete"` → Frontend `"completed"` (note the 'd')
- Agent `"cancelled"` → Frontend `"cancelled"` (same)

**File: `src/entities/threads/types.ts`**

The file re-exports from `@core/types/threads.js`. Update the core file:

**File: `core/types/threads.ts`**

```typescript
// Line 3 - add "cancelled" to ThreadStatus
export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused" | "cancelled";

// Line 32 - update schema to include "cancelled"
export const ThreadMetadataSchema = z.object({
  // ...
  status: z.enum(["idle", "running", "completed", "error", "paused", "cancelled"]),
  // ...
});
```

### Phase 2: Agent-Side Cancellation

#### 2.1 Add AbortController to runAgentLoop

**File: `agents/src/runners/shared.ts`**

Modify `runAgentLoop` to accept and use an AbortController:

```typescript
// Update AgentLoopOptions interface (around line 105)
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

// In runAgentLoop function, update the query call (around line 225)
const result = useMockMode
  ? mockQuery({ /* ... existing mock options ... */ })
  : query({
      prompt: config.prompt,
      options: {
        cwd: context.workingDir,
        additionalDirectories: [config.mortDir],
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
        ...(options.abortController && { abortController: options.abortController }),
        hooks,
      },
    });
```

#### 2.2 Unify Signal Handler with Abort Support

**File: `agents/src/runners/shared.ts`**

The current `setupSignalHandlers` exits with code 0. Modify to support cancellation:

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

#### 2.3 Add cancelled() Function

**File: `agents/src/output.ts`**

Add a new function to emit cancelled state:

```typescript
/**
 * Mark the thread as cancelled.
 * Called when agent receives abort signal.
 * Returns a promise that resolves when state is persisted to disk.
 */
export async function cancelled(): Promise<void> {
  markOrphanedToolsAsError();
  state.status = "cancelled";
  await emitState(); // emitState is already async and awaits disk write
}
```

**Note:** `emitState()` is already async and writes to disk before emitting to stdout (disk-as-truth pattern). The await ensures state is persisted before process exits.

#### 2.4 Handle Abort in Runner

**File: `agents/src/runner.ts`**

Update main() to create AbortController and handle abort:

```typescript
async function main(): Promise<void> {
  // Set up `mort` command before anything else
  setupMortCommand();

  let strategy: RunnerStrategy | undefined;
  let context: OrchestrationContext | undefined;

  // Create abort controller for cancellation support
  const abortController = new AbortController();

  try {
    const args = process.argv.slice(2);
    strategy = getStrategy(args);

    // ... existing setup code ...

    // Set up orchestration context (working directory, task metadata, etc.)
    context = await strategy.setup(config);

    // Set up signal handlers with abort support
    // Pass abortController so signals trigger abort instead of immediate exit
    setupSignalHandlers(async () => {
      if (context && strategy) {
        await strategy.cleanup(context, "cancelled");
      }
    }, abortController);

    // ... existing code ...

    // Run the common agent loop with abort controller
    await runAgentLoop(config, context, agentConfig, priorMessages, {
      abortController,
      // ... other options from strategy
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

    // ... existing error handling ...
  }
}
```

### Phase 3: Frontend Process Tracking

#### 3.1 Unify Process Tracking

**File: `src/lib/agent-service.ts`**

Rename and generalize the existing simple agent tracking to cover ALL agent types:

```typescript
// Line 37-38: Rename to cover all agent types
// Track active agent processes for cancellation (all agent types)
const activeProcesses = new Map<string, Child>();

// Update spawnSimpleAgent to use the unified map (around line 684)
const child = await command.spawn();
activeProcesses.set(options.threadId, child);

// Update close handler
command.on("close", (code) => {
  activeProcesses.delete(options.threadId);
  // ... rest of handler
});

// Update resumeSimpleAgent similarly (around line 752)
const child = await command.spawn();
activeProcesses.set(threadId, child);

// Update close handler
command.on("close", (code) => {
  activeProcesses.delete(threadId);
  // ... rest of handler
});
```

#### 3.2 Capture Child Reference for Orchestrated Agents

**File: `src/lib/agent-service.ts`**

Update `spawnAgentWithOrchestration` to capture the Child reference (currently at line 389):

```typescript
// Around line 386-400, change from:
try {
  logger.info(`[spawnAgentWithOrchestration] Spawning agent for thread ${options.threadId}`);
  await command.spawn();
  logger.info(`[spawnAgentWithOrchestration] Agent spawned successfully`);
} catch (error) {
  // ...
}

// To:
try {
  logger.info(`[spawnAgentWithOrchestration] Spawning agent for thread ${options.threadId}`);
  const child = await command.spawn();
  activeProcesses.set(options.threadId, child);
  logger.info(`[spawnAgentWithOrchestration] Agent spawned successfully`);
} catch (error) {
  // ...
}

// Also update the close handler (around line 363) to clean up the map:
command.on("close", async (data) => {
  activeProcesses.delete(options.threadId);
  // ... rest of existing handler
});
```

Do the same for `resumeAgent` (around line 569):

```typescript
try {
  const child = await command.spawn();
  activeProcesses.set(threadId, child);
} catch (error) {
  // ...
}

// And update its close handler (around line 557):
command.on("close", async (data) => {
  activeProcesses.delete(threadId);
  // ... rest of existing handler
});
```

#### 3.3 Generalize cancelSimpleAgent to cancelAgent

**File: `src/lib/agent-service.ts`**

Replace `cancelSimpleAgent` with a unified `cancelAgent`:

```typescript
/**
 * Cancels a running agent by sending SIGINT to its process.
 * Works for all agent types (simple, orchestrated, etc.)
 *
 * @returns true if process was found and kill signal sent, false if no process found
 */
export async function cancelAgent(threadId: string): Promise<boolean> {
  const process = activeProcesses.get(threadId);
  if (!process) {
    logger.warn(`[agent-service] No running process found for thread ${threadId}`);
    return false;
  }

  logger.info(`[agent-service] Cancelling agent for thread ${threadId}`);

  // Send SIGINT for graceful shutdown
  // Tauri's Child.kill() sends SIGTERM by default
  await process.kill();

  // Don't delete from map here - let the close handler do it
  // This ensures proper cleanup even if kill fails

  return true;
}

/**
 * Checks if an agent is currently running for the given thread.
 * Works for all agent types.
 */
export function isAgentRunning(threadId: string): boolean {
  return activeProcesses.has(threadId);
}

// Keep cancelSimpleAgent as deprecated alias for backwards compatibility
/**
 * @deprecated Use cancelAgent instead
 */
export async function cancelSimpleAgent(threadId: string): Promise<void> {
  await cancelAgent(threadId);
}
```

### Phase 4: Handle Cancellation Exit Code

#### 4.1 Update Close Handlers

**File: `src/lib/agent-service.ts`**

Update the close handler in `spawnAgentWithOrchestration` (around line 363):

```typescript
command.on("close", async (data) => {
  logger.log(`[spawnAgentWithOrchestration] Agent closed with code: ${data.code}`);
  activeProcesses.delete(options.threadId);

  // Update thread entity based on exit code
  const thread = threadService.get(options.threadId);
  if (thread) {
    if (data.code === 0) {
      await threadService.completeTurn(options.threadId, data.code, lastCostUsd);
      await threadService.markCompleted(options.threadId);
    } else if (data.code === 130) {
      // Cancelled via SIGINT (exit code 128 + 2)
      await threadService.completeTurn(options.threadId, data.code, lastCostUsd);
      await threadService.markCancelled(options.threadId);
      eventBus.emit(EventName.AGENT_CANCELLED, {
        threadId: options.threadId,
      });
    } else {
      await threadService.completeTurn(options.threadId, data.code ?? -1);
      await threadService.markError(options.threadId);
    }
  }

  eventBus.emit("agent:completed", {
    threadId: options.threadId,
    exitCode: data.code ?? -1,
    costUsd: lastCostUsd,
  });
});
```

Apply similar updates to:
- `resumeAgent` close handler (around line 557)
- `spawnSimpleAgent` close handler (around line 673)
- `resumeSimpleAgent` close handler (around line 744)

#### 4.2 Handle AGENT_CANCELLED Event

**File: `src/lib/agent-service.ts`**

Update `handleAgentEvent` to handle the new event:

```typescript
function handleAgentEvent(event: AgentEventMessage): void {
  const { name, payload } = event;

  switch (name) {
    // ... existing cases ...
    case EventName.AGENT_CANCELLED:
      eventBus.emit(name as any, payload as any);
      break;
    // ...
  }
}
```

### Phase 5: Thread Service Updates

#### 5.1 Add markCancelled Method

**File: `src/entities/threads/service.ts`**

Add a new method for marking threads as cancelled:

```typescript
/**
 * Marks a thread as cancelled.
 */
async markCancelled(id: string): Promise<void> {
  await this.setStatus(id, "cancelled");
}
```

This follows the same pattern as `markCompleted` and `markError`.

### Phase 6: Cleanup Guarantees

#### 6.1 Worktree Release Flow

The existing `setupCleanup` in `orchestration.ts` handles worktree release on process exit. The cancellation flow ensures this runs:

1. User clicks Cancel
2. `cancelAgent()` calls `child.kill()` → sends SIGTERM
3. Node receives SIGTERM, `setupSignalHandlers` triggers `abortController.abort()`
4. SDK stops, throws AbortError in main loop
5. Catch block: `await cancelled()` (persists state), `await strategy.cleanup()` (releases worktree)
6. `process.exit(130)`
7. `process.on('exit')` handler runs any final cleanup
8. Frontend receives close event with code 130

**Key insight:** The abort controller approach lets us await async operations (state persistence, worktree release) before exiting, solving the async timing issues.

#### 6.2 Timeout for Unresponsive Agents

For agents that don't respond to SIGTERM within a timeout, we need escalation. However, Tauri's `Child.kill()` has limitations - it sends SIGTERM, not SIGKILL.

**File: `src/lib/agent-service.ts`**

```typescript
/**
 * Cancels a running agent with timeout escalation.
 * First tries graceful SIGTERM, then escalates if needed.
 */
export async function cancelAgent(threadId: string): Promise<boolean> {
  const child = activeProcesses.get(threadId);
  if (!child) {
    logger.warn(`[agent-service] No running process found for thread ${threadId}`);
    return false;
  }

  logger.info(`[agent-service] Cancelling agent for thread ${threadId}`);

  // Send SIGTERM for graceful shutdown
  await child.kill();

  // Set up escalation timeout
  const GRACEFUL_TIMEOUT_MS = 5000;

  setTimeout(() => {
    // Check if process is still tracked (not yet exited)
    if (activeProcesses.has(threadId)) {
      logger.warn(`[agent-service] Agent ${threadId} did not exit within ${GRACEFUL_TIMEOUT_MS}ms`);
      // Note: Tauri's Child doesn't support SIGKILL directly
      // The process map entry will be cleaned up eventually when close fires
      // For truly hung processes, user may need to restart the app
      // TODO: Investigate if Tauri's invoke can call a Rust SIGKILL function
    }
  }, GRACEFUL_TIMEOUT_MS);

  return true;
}
```

**Limitation documented:** Tauri shell plugin's `Child.kill()` sends SIGTERM, not SIGKILL. Truly hung Node processes may require app restart. Future enhancement could add a Rust-side `force_kill` command.

### Phase 7: UI Components

#### 7.1 Cancel Button in Thread Header

Add a cancel button that appears when thread is running:

```tsx
// In thread/workspace component
import { cancelAgent, isAgentRunning } from "@/lib/agent-service";

const thread = useThread(threadId);
const isRunning = thread?.status === "running";

// Use actual process state, not just thread status, to handle desync
const [processRunning, setProcessRunning] = useState(false);

useEffect(() => {
  setProcessRunning(isAgentRunning(threadId));
}, [threadId, thread?.status]);

{isRunning && processRunning && (
  <Button
    variant="ghost"
    size="sm"
    onClick={async () => {
      const success = await cancelAgent(thread.id);
      if (!success) {
        // Process already dead, refresh thread state
        await threadService.refreshById(thread.id);
      }
    }}
  >
    <StopCircle className="h-4 w-4 mr-1" />
    Cancel
  </Button>
)}
```

#### 7.2 Cancelled State Display

Show visual indicator when thread was cancelled:

```tsx
{thread.status === "cancelled" && (
  <Badge variant="secondary">
    <XCircle className="h-3 w-3 mr-1" />
    Cancelled
  </Badge>
)}
```

## Files to Modify

| File | Changes |
|------|---------|
| `core/types/events.ts` | Add AGENT_CANCELLED event, add "cancelled" to AgentThreadStatus |
| `core/types/threads.ts` | Add "cancelled" to ThreadStatus |
| `agents/src/runners/shared.ts` | Add abortController to AgentLoopOptions, update setupSignalHandlers |
| `agents/src/output.ts` | Add `cancelled()` function |
| `agents/src/runner.ts` | Create AbortController, handle AbortError, pass to runAgentLoop |
| `src/lib/agent-service.ts` | Unify process tracking, add `cancelAgent()`, capture Child refs, handle exit 130 |
| `src/entities/threads/service.ts` | Add `markCancelled()` method |
| UI components | Add cancel button, cancelled state display |

## Decisions Made

### Partial Results: Keep All Progress

**Decision:** Keep all messages and file changes from before cancellation.

**Rationale:**
- Users may want to review what was done before cancelling
- Rolling back file changes is complex and error-prone
- The "cancelled" status clearly indicates incomplete work
- Users can easily start a new thread if they want a clean slate

### Cancelled Threads: Resumable

**Decision:** Allow resuming cancelled threads (same as completed threads).

**Rationale:**
- User may want to continue where they left off
- Thread state is preserved and valid
- No technical barrier to resumption

### Cancel Confirmation: None Required

**Decision:** Immediate cancellation without confirmation dialog.

**Rationale:**
- Cancellation is non-destructive (work is preserved)
- Fast cancellation is often time-sensitive (cost control)
- Easy to restart if cancelled by mistake

## Edge Cases

### 1. Cancel During Tool Execution

The SDK will interrupt the tool execution via AbortSignal propagation. The tool's cleanup should run, but:
- File writes may be incomplete
- Bash commands may leave orphaned processes

**Mitigation:** Tools receive the AbortSignal and should clean up. Orphaned tool output is marked as error state.

### 2. Cancel During API Call

The SDK will abort the in-flight request. This is safe - partial responses are discarded.

### 3. Rapid Cancel/Restart

User cancels then immediately starts new agent on same task.

**Mitigation:** Worktree release is awaited before process exits. New agent will wait for lock if needed.

### 4. Process Already Dead

User clicks cancel but process already crashed.

**Mitigation:** `cancelAgent()` returns false if no process found. UI should handle this gracefully by refreshing thread state.

### 5. Cancel During Cleanup

User cancels while worktree release is in progress.

**Mitigation:** The abort controller approach ensures cleanup awaits completion before exit. Multiple cancel attempts are guarded by `isShuttingDown` flag.

## Testing Plan

1. **Unit Tests**
   - `cancelled()` emits correct state with status "cancelled"
   - `markCancelled()` updates thread correctly
   - Process tracking add/remove for all agent types
   - AbortController triggers abort on signal

2. **Integration Tests**
   - Cancel during idle (waiting for API response)
   - Cancel during tool execution
   - Cancel rapid succession
   - Verify worktree released after cancel
   - Verify state.json has "cancelled" status
   - Verify metadata.json has "cancelled" status
   - Cancel then resume thread

3. **Manual Testing**
   - Cancel button appears for running agents
   - Cancel stops agent within 5 seconds
   - Thread shows "Cancelled" status in UI
   - Can restart agent after cancel
   - Cost tracking accurate (partial cost reported)
   - Works for simple agents
   - Works for orchestrated agents (research, execution, merge)

## Success Criteria

1. Cancel button visible when agent is running
2. Cancel stops agent within 5 seconds
3. Thread status shows "cancelled" in both UI and on disk
4. Worktree properly released after cancellation
5. Can start new agent on same task after cancel
6. Can resume cancelled thread
7. No orphaned Node processes
8. Partial cost tracked in thread metadata
9. Works for all agent types (simple, orchestrated)
