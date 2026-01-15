# Sub-Plan 04: Agent Service stdin Communication

## Scope

Modify the Tauri frontend's agent service to support bidirectional communication with agent processes, enabling permission responses to be sent via stdin.

## Dependencies

- **01-core-types.md** - Requires `PermissionDecision` type

## Files to Modify

### `src/lib/agent-service.ts`

Add process tracking and stdin write capability:

```typescript
// Near top of file, add import
import type { Child } from "@tauri-apps/plugin-shell";

// Near top of file, after activeSimpleProcesses
const agentProcesses = new Map<string, Child>();

// In spawnAgentWithOrchestration, after spawn():
const child = await command.spawn();
agentProcesses.set(options.threadId, child);

// In command.on("close") callback, before the callback body:
agentProcesses.delete(options.threadId);

// Similarly for spawnSimpleAgent and resumeSimpleAgent functions

// Add new exported function:
export async function sendPermissionResponse(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny",
  reason?: string
): Promise<void> {
  const process = agentProcesses.get(threadId);
  if (!process) {
    logger.warn(`[agent-service] No process found for threadId: ${threadId}`);
    return;
  }

  const message = JSON.stringify({
    type: "permission:response",
    requestId,
    decision,
    reason,
  }) + "\n";

  try {
    await process.write(message);
    logger.info(`[agent-service] Sent permission response:`, { requestId, decision });
  } catch (error) {
    // Handle case where process has already terminated
    // This can happen if the agent exits between the permission request and response
    if (error instanceof Error && error.message.includes("closed")) {
      logger.warn(`[agent-service] Process already terminated for threadId: ${threadId}`, {
        requestId,
        decision,
      });
      // Clean up the stale process reference
      agentProcesses.delete(threadId);
      return;
    }
    // Re-throw unexpected errors
    logger.error(`[agent-service] Failed to write permission response:`, error);
    throw error;
  }
}

// Add helper to check if process exists
export function hasAgentProcess(threadId: string): boolean {
  return agentProcesses.has(threadId);
}
```

## Verification

```bash
pnpm tsc --noEmit
```

## Manual Testing

1. Start dev server: `pnpm tauri dev`
2. Create a simple task that triggers a tool
3. Verify process is tracked in Map
4. Verify process is removed from Map on completion

## Estimated Time

20-30 minutes

## Notes

- Uses Tauri's `Child.write()` method for stdin communication
- JSON messages with newline delimiter for line-based parsing
- Process cleanup happens automatically on close event
- Map provides O(1) lookup by threadId
