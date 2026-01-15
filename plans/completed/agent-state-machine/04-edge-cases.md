# 04 - Edge Cases

## Status Edge Cases

### Task at Unexpected Status

If a task has a status that doesn't map to an agent (e.g., `backlog`, `todo`, `cancelled`):

```typescript
export function getAgentTypeForStatus(status: TaskStatus): string | null {
  switch (status) {
    case "draft":
      return "entrypoint";
    case "in_progress":
      return "execution";
    case "completed":
      return "review";
    // All other statuses = no agent
    default:
      return null;
  }
}
```

The UI should handle this gracefully - don't show "Proceed" if there's nowhere to proceed to.

### Task Already Merged/Cancelled

```typescript
if (taskStatus === "merged" || taskStatus === "cancelled") {
  return (
    <div className="flex items-center gap-2 text-slate-400">
      <CheckCircle size={16} />
      <span>Task {taskStatus}</span>
    </div>
  );
}
```

## Agent Crash Handling

### Agent Crashes Before Requesting Review

The thread ends in error state with no `pendingReview` set.

```typescript
// Detect this case in ActionPanel
const threadInError = activeThread?.status === "error";
const noPendingReview = !pendingReview;

if (threadInError && noPendingReview) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-red-400">Agent encountered an error.</p>
      <div className="flex gap-2">
        <button onClick={handleRetryCurrentPhase}>
          Retry {getCurrentPhaseLabel(taskStatus)}
        </button>
        <button onClick={handleSkipToNextPhase}>
          Skip to {getNextPhaseLabel(taskStatus)}
        </button>
      </div>
    </div>
  );
}
```

### Retry Current Phase

```typescript
const handleRetryCurrentPhase = useCallback(async () => {
  const agentType = getAgentTypeForStatus(taskStatus);
  if (agentType) {
    await handleProgressToNextStep(agentType, "Retrying after error");
  }
}, [taskStatus, handleProgressToNextStep]);
```

### Skip to Next Phase

```typescript
const handleSkipToNextPhase = useCallback(async () => {
  const nextStatus = getNextStatus(taskStatus);
  const nextAgentType = getAgentTypeForStatus(nextStatus);

  await taskService.update(taskId, { status: nextStatus });

  if (nextAgentType) {
    await handleProgressToNextStep(nextAgentType, "Skipped previous phase");
  }
}, [taskStatus, taskId, handleProgressToNextStep]);
```

## Window/Session Handling

### User Closes Window Mid-Agent

**Behavior**: Agent continues running in background.

**On Reopen**:
1. Task store reloads from disk
2. `pendingReview` is preserved if agent requested one
3. User can respond normally
4. If agent still running, streaming resumes

No special handling needed - current architecture handles this.

### Multiple Windows

If the same task is open in multiple windows:
- Event bus syncs state across windows
- `pendingReview` changes are broadcast
- First window to respond wins

```typescript
// Already handled by action-requested event
useEffect(() => {
  const handler = async (payload: { taskId: string }) => {
    if (payload.taskId === taskId) {
      await taskService.refreshTask(taskId);
    }
  };
  eventBus.on("action-requested", handler);
  return () => eventBus.off("action-requested", handler);
}, [taskId]);
```

## Input Edge Cases

### Empty Default Response from Agent

If agent calls `request-review` with empty `defaultResponse`:

```typescript
// The placeholder will be empty, but that's fine
// Empty input still triggers progression
<input
  placeholder={pendingReview.defaultResponse || "Press Enter to proceed"}
/>
```

### Very Long Feedback

User types a lot of feedback:

```typescript
// The input field already handles this
// Consider truncating in the prompt if > 1000 chars
const handleStayAndResume = async (message: string) => {
  const truncated = message.length > 2000
    ? message.slice(0, 2000) + "... (truncated)"
    : message;
  await resumeAgent(activeThreadId, truncated);
};
```

## Thread Management

### No Active Thread When Submitting

If `activeThreadId` is null when user tries to respond:

```typescript
const handleStayAndResume = useCallback(async (message: string) => {
  if (!activeThreadId) {
    // Can't resume - spawn new agent of current type instead
    const agentType = getAgentTypeForStatus(taskStatus);
    if (agentType) {
      await handleProgressToNextStep(agentType, message);
    }
    return;
  }
  // ... normal resume
}, [activeThreadId, taskStatus]);
```

### Thread Deleted While Waiting for Response

Same handling as above - fall back to spawning new agent.

## Going Back a Phase

### User Wants to Redo Previous Phase

Not directly supported. User can:
1. Give feedback like "go back to planning and reconsider X"
2. Agent handles it within current phase context

**Future enhancement**: Add explicit "Go Back" button that:
1. Sets status to previous phase
2. Spawns that agent type with context about what to reconsider

```typescript
// Potential future implementation
function getPreviousStatus(status: TaskStatus): TaskStatus | null {
  switch (status) {
    case "in_progress":
      return "draft";
    case "completed":
      return "in_progress";
    default:
      return null;
  }
}
```

## Testing Checklist

- [ ] Draft task → Enter → spawns execution agent, status = in_progress
- [ ] Draft task → feedback → resumes entrypoint agent, status = draft
- [ ] In-progress task → Enter → spawns review agent, status = completed
- [ ] In-progress task → feedback → resumes execution agent, status = in_progress
- [ ] Completed task → Enter → no agent, status = merged
- [ ] Completed task → feedback → resumes review agent, status = completed
- [ ] Agent error → retry button works
- [ ] Agent error → skip button works
- [ ] Window close/reopen preserves state
- [ ] Multiple windows sync correctly
