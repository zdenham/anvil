# Sub-Plan 03: Frontend Integration

**Prerequisite:** 01-core-types.md
**Can run parallel with:** 02-agent-runtime.md
**File tree:** `src/*` only (no overlap with 02)

## Overview

Track agent processes in the frontend, provide `cancelAgent()` function, handle exit code 130, and add UI for cancellation.

## Current State Analysis

### Already Implemented
- [x] `activeSimpleProcesses` Map exists for tracking simple agent processes (line 39)
- [x] `agentProcesses` Map exists for all processes (line 42) - used for stdin/permission communication
- [x] `cancelSimpleAgent()` function exists (line 778-785)
- [x] `isSimpleAgentRunning()` function exists (line 790-792)
- [x] Cancel button UI pattern exists in `action-panel.tsx` (StopCircle icon, line 438-446)
- [x] Task "cancelled" status already exists in `core/types/tasks.ts` and has UI styling in `task-header.tsx`

### Not Yet Implemented
- [ ] Thread "cancelled" status (needs addition in 01-core-types.md first)
- [ ] Unified `cancelAgent()` function that works for all agent types
- [ ] `isAgentRunning()` function for all agent types
- [ ] Exit code 130 handling in close handlers
- [ ] `markCancelled()` method in thread service
- [ ] Cancel button in `simple-task-header.tsx`

## Changes

### 1. Unify Process Tracking (Cleanup Only)

**File: `src/lib/agent-service.ts`**

The codebase already has two Maps:
- `activeSimpleProcesses` (line 39) - tracks simple agents only
- `agentProcesses` (line 42) - tracks all agents for stdin communication

**Decision:** Keep both Maps but ensure consistency. The `agentProcesses` Map already tracks all agent types. We can:
- Use `agentProcesses` as the unified source of truth for cancellation
- Keep `activeSimpleProcesses` as a legacy reference (or deprecate it)

For minimal changes, update `cancelSimpleAgent` to use `agentProcesses`:

```typescript
// Line ~778 - Replace existing cancelSimpleAgent implementation
export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = agentProcesses.get(threadId);
  if (process) {
    await process.kill();
    agentProcesses.delete(threadId);
    activeSimpleProcesses.delete(threadId); // Keep in sync
    logger.info("[agent-service] Cancelled agent", { threadId });
  }
}
```

### 2. Create Unified cancelAgent Function

**File: `src/lib/agent-service.ts`**

Add after `cancelSimpleAgent` (around line 786):

```typescript
/**
 * Cancels a running agent by sending SIGTERM to its process.
 * Works for all agent types (simple, orchestrated, etc.)
 *
 * @returns true if process was found and kill signal sent, false if no process found
 */
export async function cancelAgent(threadId: string): Promise<boolean> {
  const child = agentProcesses.get(threadId);
  if (!child) {
    logger.warn(`[agent-service] No running process found for thread ${threadId}`);
    return false;
  }

  logger.info(`[agent-service] Cancelling agent for thread ${threadId}`);

  // Send SIGTERM for graceful shutdown
  await child.kill();

  // Note: Process cleanup happens in close handlers - don't delete here
  // The close handler will receive exit code 130 and clean up properly

  return true;
}

/**
 * Checks if an agent is currently running for the given thread.
 * Works for all agent types.
 */
export function isAgentRunning(threadId: string): boolean {
  return agentProcesses.has(threadId);
}
```

Update exports to include `cancelAgent` and `isAgentRunning`.

### 3. Handle Exit Code 130 in Close Handlers

**File: `src/lib/agent-service.ts`**

**Prerequisite:** This requires `AGENT_CANCELLED` event and `threadService.markCancelled()` from 01-core-types.md.

Update close handler in `spawnAgentWithOrchestration` (around line 369):

```typescript
command.on("close", async (data) => {
  agentProcesses.delete(options.threadId);
  logger.log(`[spawnAgentWithOrchestration] Agent closed with code: ${data.code}`);

  // Update thread entity based on exit code
  const thread = threadService.get(options.threadId);
  if (thread) {
    if (data.code === 0) {
      await threadService.completeTurn(options.threadId, data.code, lastCostUsd);
      await threadService.markCompleted(options.threadId);
    } else if (data.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
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
- `resumeAgent` close handler (around line 565)
- `spawnSimpleAgent` close handler (around line 686)
- `resumeSimpleAgent` close handler (around line 761)

### 4. Handle AGENT_CANCELLED in Event Handler

**File: `src/lib/agent-service.ts`**

Update `handleAgentEvent` (around line 104) to include the new event:

```typescript
switch (name) {
  // ... existing cases ...
  case EventName.AGENT_CANCELLED:
    eventBus.emit(name as any, payload as any);
    break;
  // ...
}
```

### 5. Add markCancelled to Thread Service

**File: `src/entities/threads/service.ts`**

Add a new method (around line 410):

```typescript
/**
 * Marks a thread as cancelled.
 */
async markCancelled(id: string): Promise<void> {
  await this.setStatus(id, "cancelled");
}
```

### 6. Add Cancel Button to Simple Task Header

**File: `src/components/simple-task/simple-task-header.tsx`**

Update to include a cancel button:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { taskService } from "@/entities/tasks/service";
import { DeleteButton } from "@/components/tasks/delete-button";
import { ModeIndicator } from "./mode-indicator";
import { useAgentModeStore } from "@/entities/agent-mode";
import { cancelAgent } from "@/lib/agent-service";
import { StopCircle } from "lucide-react";

interface SimpleTaskHeaderProps {
  taskId: string;
  threadId: string;
  status: "idle" | "loading" | "running" | "completed" | "error" | "cancelled";
}

const statusStyles = {
  running: "text-success-500 bg-success-500/15",
  completed: "text-success-500 bg-success-500/15",
  error: "text-error-500 bg-error-500/15",
  idle: "text-surface-400 bg-surface-700",
  loading: "text-surface-400 bg-surface-700",
  cancelled: "text-amber-500 bg-amber-500/15",
} as const;

export function SimpleTaskHeader({ taskId, threadId, status }: SimpleTaskHeaderProps) {
  const currentMode = useAgentModeStore((s) => s.getMode(threadId));
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleToggle = () => {
    cycleMode(threadId);
  };

  const handleDelete = async () => {
    await taskService.delete(taskId);
    await getCurrentWindow().close();
  };

  const handleCancel = async () => {
    await cancelAgent(threadId);
  };

  const isStreaming = status === "running";

  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700 [-webkit-app-region:drag]">
      <span className="font-mono text-xs text-surface-400">{taskId.slice(0, 8)}...</span>
      <span className={cn("text-[11px] font-medium uppercase px-2 py-0.5 rounded", statusStyles[status])}>
        {status}
      </span>
      <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
        {isStreaming && (
          <button
            onClick={handleCancel}
            className="px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors flex items-center gap-1.5 text-xs"
            aria-label="Cancel agent"
          >
            <StopCircle size={14} />
            Cancel
          </button>
        )}
        <ModeIndicator
          mode={currentMode}
          onClick={handleToggle}
          disabled={isStreaming}
        />
        <DeleteButton onDelete={handleDelete} />
      </div>
    </div>
  );
}
```

### 7. Update ViewStatus Type in SimpleTaskWindow

**File: `src/components/simple-task/simple-task-window.tsx`**

Update the ViewStatus type (line 15) to include "cancelled":

```typescript
/** Map entity ThreadStatus to ThreadView's expected status type */
type ViewStatus = "idle" | "loading" | "running" | "completed" | "error" | "cancelled";
```

Update the viewStatus derivation (line 63-68) to handle the cancelled status:

```typescript
const viewStatus: ViewStatus =
  prompt && !activeState?.messages?.length
    ? "running"
    : entityStatus === "paused"
      ? "idle"
      : entityStatus === "cancelled"
        ? "cancelled"
        : entityStatus;
```

## Verification

### Unit Test

```typescript
// Test cancelAgent returns false for unknown thread
expect(await cancelAgent("nonexistent")).toBe(false);

// Test isAgentRunning
expect(isAgentRunning("nonexistent")).toBe(false);
```

### Manual Test

1. Start a simple agent in the UI
2. Click Cancel button in the header
3. Verify:
   - Agent stops within 5 seconds
   - Thread shows "Cancelled" status (amber badge)
   - No error messages in console
   - Can start a new agent on the same thread

### Integration Test

1. Start an orchestrated agent via workspace
2. Click Cancel in the action panel (already exists)
3. Verify:
   - Same behavior as simple agent
   - Thread transitions from "running" to "cancelled"

## Dependencies

Before implementing this plan, ensure:
1. `01-core-types.md` is complete (adds "cancelled" to ThreadStatus and AGENT_CANCELLED event)
2. `02-agent-runtime.md` is complete (agent handles SIGTERM and exits with code 130)

## Files Modified

- `src/lib/agent-service.ts` - Unified cancelAgent, isAgentRunning, exit code 130 handling
- `src/entities/threads/service.ts` - Add markCancelled method
- `src/components/simple-task/simple-task-header.tsx` - Add cancel button
- `src/components/simple-task/simple-task-window.tsx` - Add "cancelled" to ViewStatus

## Notes

### Existing Cancel UI

The `action-panel.tsx` already has a cancel button pattern for orchestrated agents:
```tsx
{onCancel && (
  <button onClick={onCancel} className="...">
    <StopCircle size={16} />
    Cancel
  </button>
)}
```

The `onCancel` prop is passed from the parent workspace component. This plan focuses on the simple task window which doesn't currently have cancellation support.

### Process Tracking Architecture

The codebase has two overlapping Maps:
- `activeSimpleProcesses` - Simple agents only, used for `cancelSimpleAgent`
- `agentProcesses` - All agents, used for stdin communication (`sendPermissionResponse`)

This plan adds unified functions that use `agentProcesses` as the source of truth, maintaining backward compatibility with existing code.

### Exit Code Convention

- Exit code 0: Success
- Exit code 130: Cancelled (128 + SIGINT signal number 2)
- Other non-zero: Error

This follows Unix conventions where signal-terminated processes exit with 128 + signal number.
