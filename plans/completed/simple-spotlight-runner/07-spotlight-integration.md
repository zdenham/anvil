# 07 - Spotlight Integration

**Parallelizable:** No (depends on all Phase 1 plans)
**Estimated scope:** 1 file modified

## Overview

Wire the simple task flow into the Spotlight component. This is the final integration step.

## Prerequisites

All Phase 1 plans must be complete:
- ✅ 01-types: AgentType includes "simple"
- ✅ 02-agent-runner: simple-runner.js exists
- ✅ 03-frontend-service: spawnSimpleAgent, openSimpleTask available
- ✅ 04-ui-components: SimpleTaskWindow exists
- ✅ 05-tauri-commands: open_simple_task command registered
- ✅ 06-entry-point-config: simple-task.html and vite entry configured

## Tasks

### 1. Update keyboard handler

**File:** `src/components/spotlight/spotlight.tsx`

In the keyboard event handler (usually in a useEffect), update the Enter case:

```typescript
case "Enter":
  e.preventDefault();
  if (results.length > 0 && results[selectedIndex]) {
    const result = results[selectedIndex];
    // Command+Enter triggers full task flow
    const useFullFlow = e.metaKey;
    await activateResult(result, { useFullFlow });
  }
  break;
```

### 2. Update activateResult function

**File:** `src/components/spotlight/spotlight.tsx`

Update the function signature and logic:

```typescript
const activateResult = useCallback(async (
  result: SpotlightResult,
  options?: { useFullFlow?: boolean }
) => {
  const controller = controllerRef.current;
  const useFullFlow = options?.useFullFlow ?? false;

  // Handle other result types (app, calculator, action, etc.)
  // ... existing handlers ...

  if (result.type === "task") {
    const repos = controller.getRepositories();
    const selectedRepo = controller.getDefaultRepository() ?? repos[0];

    if (repos.length === 0) {
      logger.error("No repositories available.");
      return;
    }

    // Save to history
    promptHistoryService.add(result.data.query).catch(console.error);

    if (useFullFlow) {
      // Command+Enter: Full worktree flow (existing behavior)
      controller.createTask(result.data.query, selectedRepo).catch(handleError);
    } else {
      // Enter: Simple flow (new default)
      controller.createSimpleTask(result.data.query, selectedRepo).catch(handleError);
    }

    await controller.hideSpotlight();
  }
}, [/* dependencies */]);
```

### 3. Add createSimpleTask to SpotlightController

**File:** `src/components/spotlight/spotlight-controller.ts` (or wherever the controller is defined)

```typescript
import { spawnSimpleAgent } from "@/lib/simple-agent-service";
import { openSimpleTask } from "@/lib/hotkey-service";

/**
 * Creates a simple task that runs directly in the source repository.
 * No worktree allocation, no branch management - just direct execution.
 *
 * Note: Task metadata is created by the simple-runner process, not here.
 * This follows the "Agent Process Architecture" principle from AGENTS.md.
 */
async createSimpleTask(content: string, repo: Repository): Promise<void> {
  const taskId = crypto.randomUUID();
  const threadId = crypto.randomUUID();

  logger.info(`[spotlight:createSimpleTask] Creating simple task: ${taskId}`);

  // Open simple task window immediately (optimistic UI)
  // Window shows prompt while agent starts up
  await openSimpleTask(threadId, taskId, content);

  // Spawn simple agent (no orchestration)
  // The runner creates task metadata and thread data on disk
  await spawnSimpleAgent({
    taskId,
    threadId,
    prompt: content,
    sourcePath: repo.sourcePath,
  });
}
```

### 4. Update UI hint (optional)

If there's a hint/help text in the Spotlight UI, update it to indicate:
- **Enter** = Quick task (runs in repo)
- **⌘+Enter** = Full task (creates branch)

## Verification

### Manual Testing

1. Open Spotlight (global hotkey)
2. Type a task prompt
3. Press **Enter** → Simple task window should open
4. Verify agent runs in source repo (check working directory)
5. Press **⌘+Enter** → Full task flow (existing behavior)

### Automated Checks

```bash
pnpm typecheck
pnpm build
```

## Keyboard Shortcut Summary

| Shortcut | Flow | Where it runs | Storage |
|----------|------|---------------|---------|
| **Enter** | Simple | Source repo | `~/.anvil/simple-tasks/` |
| **⌘+Enter** | Full | Allocated worktree | `~/.anvil/tasks/` |
