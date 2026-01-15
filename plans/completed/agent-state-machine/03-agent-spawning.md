# 03 - Agent Spawning Logic

## Changes to `src/components/workspace/task-workspace.tsx`

### New Handlers

```typescript
import { prepareAgent, resumeAgent } from "@/lib/agent-service";
import { eventBus } from "@/entities/events";
import { logger } from "@/lib/logger-client";
import { taskService } from "@/entities/tasks/service";

export function TaskWorkspace({ taskId, initialThreadId }: TaskWorkspaceProps) {
  // ... existing state and hooks

  /**
   * Spawn a new agent of the specified type for progression.
   * Creates a NEW thread (not resuming the old one).
   */
  const handleProgressToNextStep = useCallback(
    async (nextAgentType: string, defaultMessage: string) => {
      if (!task) {
        logger.warn("[TaskWorkspace] No task to progress");
        return;
      }

      try {
        const prompt = buildProgressionPrompt(nextAgentType, task, defaultMessage);

        const prepared = await prepareAgent(
          {
            agentType: nextAgentType,
            workingDirectory: task.repositoryPath ?? process.cwd(),
            prompt,
            taskId,
          },
          {
            onState: (state) => {
              eventBus.emit("agent:state", {
                threadId: prepared.thread.id,
                state,
              });
            },
            onComplete: (exitCode, costUsd) => {
              eventBus.emit("agent:completed", {
                threadId: prepared.thread.id,
                exitCode,
                costUsd,
              });
            },
            onError: (error) => {
              eventBus.emit("agent:error", {
                threadId: prepared.thread.id,
                error,
              });
            },
          }
        );

        // Add new thread to task
        await taskService.update(taskId, {
          threadIds: [...task.threadIds, prepared.thread.id],
        });

        // Select the new thread
        setSelectedThreadId(prepared.thread.id);

        // Spawn
        await prepared.spawn();

        logger.info(`[TaskWorkspace] Spawned ${nextAgentType} agent: ${prepared.thread.id}`);
      } catch (err) {
        logger.error("[TaskWorkspace] Failed to spawn next agent:", err);
      }
    },
    [task, taskId]
  );

  /**
   * Stay in current phase - resume existing agent with feedback.
   */
  const handleStayAndResume = useCallback(
    async (message: string) => {
      if (!activeThreadId) {
        logger.warn("[TaskWorkspace] No active thread to resume");
        return;
      }

      try {
        await resumeAgent(activeThreadId, message, {
          onState: (state) => {
            eventBus.emit("agent:state", { threadId: activeThreadId, state });
          },
          onComplete: (exitCode, costUsd) => {
            eventBus.emit("agent:completed", {
              threadId: activeThreadId,
              exitCode,
              costUsd,
            });
          },
          onError: (error) => {
            eventBus.emit("agent:error", { threadId: activeThreadId, error });
          },
        });
      } catch (err) {
        logger.error("[TaskWorkspace] Failed to resume agent:", err);
      }
    },
    [activeThreadId]
  );

  /**
   * Task is complete - no more agents to spawn.
   */
  const handleTaskComplete = useCallback(() => {
    logger.info(`[TaskWorkspace] Task ${taskId} completed`);
    // Could show a success message, close workspace, etc.
  }, [taskId]);

  // ... render
  return (
    <div className="h-full flex flex-col ...">
      {/* ... other components */}

      <ActionPanel
        taskId={taskId}
        threadId={activeThreadId}
        onProgressToNextStep={handleProgressToNextStep}
        onStayAndResume={handleStayAndResume}
        onTaskComplete={handleTaskComplete}
        onCancel={onCancel}
      />
    </div>
  );
}
```

### Helper: Build Progression Prompt

```typescript
/**
 * Build contextual prompt for the next agent based on phase transition.
 */
function buildProgressionPrompt(
  agentType: string,
  task: Task,
  approvalMessage: string
): string {
  switch (agentType) {
    case "execution":
      return `The research and planning phase is complete. The user has approved the plan.

Task: ${task.title}
Approval: ${approvalMessage}

Please read the task content.md for the detailed plan and begin implementation.`;

    case "review":
      return `Implementation is complete. Please review the changes on the task branch.

Task: ${task.title}
Completion note: ${approvalMessage}

Review the git diff against the main branch and evaluate against the plan in content.md.`;

    default:
      return approvalMessage || `Continue work on: ${task.title}`;
  }
}
```

## Thread Selection Strategy

When spawning a new agent, we need to select the new thread:

```typescript
// After spawning
await taskService.update(taskId, {
  threadIds: [...task.threadIds, prepared.thread.id],
});

// Immediately select the new thread so UI shows it
setSelectedThreadId(prepared.thread.id);
```

## Context Passing Between Phases

Each phase gets context from:

1. **Task content.md** - Shared document with plan, findings, notes
2. **Git branch state** - Actual code changes
3. **Progression prompt** - Brief context about the transition

### Why Not Pass Thread History?

- Each agent type has a different system prompt and role
- Clean separation makes debugging easier
- Smaller context = faster, cheaper API calls
- The task content.md serves as persistent shared memory

If context loss becomes an issue, we can add selective history later.
