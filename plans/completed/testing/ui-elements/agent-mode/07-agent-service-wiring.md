# Sub-Plan 07: Agent Service Wiring

## Overview
Wire up the UI mode state to the agent service, passing the selected mode when spawning or resuming agents.

## Dependencies
- **02-entity-types-and-store.md** - Requires store to read mode
- **04-agent-integration.md** - Requires agent to accept --agent-mode argument

## Can Run In Parallel With
- None - This is the final integration step

## Scope
- Update resumeSimpleAgent to accept and pass agentMode
- Update spawnSimpleAgent to accept and pass agentMode
- Update SimpleTaskWindow to pass mode to agent service

## Files Involved

### Modified Files
| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Add agentMode parameter to spawn/resume functions |
| `src/components/simple-task/simple-task-window.tsx` | Pass mode from store to agent service |

## Implementation Details

### Step 1: Update Agent Service

**File:** `src/lib/agent-service.ts`

Update function signature:
```typescript
import type { AgentMode } from "@core/types/agent-mode.js";

export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
  sourcePath: string,
  agentMode: AgentMode = "normal",
): Promise<void> {
```

Add CLI arg:
```typescript
const commandArgs = [
  runnerPath,
  "--agent", "simple",
  "--task-id", taskId,
  "--thread-id", threadId,
  "--cwd", sourcePath,
  "--prompt", prompt,
  "--anvil-dir", anvilDir,
  "--agent-mode", agentMode,  // ADD THIS
  "--history-file", stateFilePath,
];
```

Also update `spawnSimpleAgent` similarly if it exists.

### Step 2: Update SimpleTaskWindow

**File:** `src/components/simple-task/simple-task-window.tsx`

```typescript
import { useAgentModeStore } from "@/entities/agent-mode";

// Inside component
const agentMode = useAgentModeStore((s) => s.getMode(threadId));

const handleSubmit = async (prompt: string) => {
  if (!workingDirectory) {
    logger.error("[SimpleTaskWindow] Cannot resume: no working directory");
    return;
  }
  await resumeSimpleAgent(taskId, threadId, prompt, workingDirectory, agentMode);
};
```

## Tests Required

### agent-service.test.ts (if exists)
- Test resumeSimpleAgent includes --agent-mode in command args
- Test default mode is "normal" when not specified
- Test all three mode values are passed correctly

### simple-task-window.ui.test.tsx (extend if exists)
- Test handleSubmit passes current mode to agent service

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] Agent spawned with mode indicator showing "Plan" receives "--agent-mode plan" arg
- [ ] Agent spawned with mode indicator showing "Auto" receives "--agent-mode auto-accept" arg
- [ ] Default "Normal" mode passes "--agent-mode normal"

## Estimated Time
~20 minutes

## Notes
- This is the final step that connects UI state to agent behavior
- End-to-end testing should verify the agent actually respects the mode
