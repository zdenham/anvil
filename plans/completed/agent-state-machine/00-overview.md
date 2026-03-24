# Agent State Machine

## Goal

Build a state machine that manages progression through agent types based on user responses:
- **Default action** (press Enter): Progress to the next agent type
- **Custom feedback**: Stay in the current step, resume the same agent

## Current Architecture

### Agent Types (3 total)
```
entrypoint → execution → review → (done)
```

1. **Entrypoint**: Research, planning, task routing
2. **Execution**: Implements code changes
3. **Review**: Validates work against plan

### Current Flow
1. Agent requests review via `anvil request-review` → sets `pendingReview` on task
2. User responds in ActionPanel (Enter or custom message)
3. `handleReviewSubmit()` clears `pendingReview` and calls `onSendMessage()`
4. `handleSendMessage()` calls `resumeAgent()` with the message
5. **Problem**: Always resumes the *same* agent type from thread metadata

### Missing Pieces
- No logic to determine if user gave default vs custom response
- No mechanism to spawn a *different* agent type on progression

## Proposed Solution: Status-Based Agent Mapping

**Key insight**: The existing `TaskStatus` already represents where a task is in its lifecycle. We can map status directly to agent type without adding new fields.

### Status → Agent Type Mapping

| Status | Agent Type | Meaning |
|--------|------------|---------|
| `draft` | entrypoint | Research & planning phase |
| `in_progress` | execution | Implementation phase |
| `completed` | review | Code review phase |
| `merged` | none | Task finished |

### State Machine Flow

```
                    ┌─────────────────┐
     start ────────►│  draft          │ ◄─── entrypoint agent
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     default response              custom feedback
              │                             │
              ▼                             │
    ┌─────────────────┐                     │
    │  in_progress    │ ◄─── execution      │
    └────────┬────────┘      agent          │
             │                              │
              ┌──────────────┴──────────────┤
              │                             │
     default response              custom feedback
              │                             │
              ▼                             │
    ┌─────────────────┐                     │
    │  completed      │ ◄─── review         │
    └────────┬────────┘      agent          │
             │                              │
              ┌──────────────┴──────────────┤
              │                             │
     default response              custom feedback
              │                             │
              ▼                             │
    ┌─────────────────┐                     │
    │  merged         │ ◄─── done           │
    └─────────────────┘                     │
```

### Decision Logic

```typescript
const isDefaultResponse = inputValue.trim() === "";

if (isDefaultResponse) {
  // Progress to next status, spawn new agent type
  const nextStatus = getNextStatus(task.status);
  const nextAgentType = getAgentTypeForStatus(nextStatus);

  await taskService.update(taskId, { status: nextStatus });

  if (nextAgentType) {
    await spawnAgent(taskId, nextAgentType, pendingReview.defaultResponse);
  }
} else {
  // Stay in current status - resume current agent with feedback
  await resumeAgent(activeThreadId, inputValue);
}
```

### Key Benefits

1. **No new fields** - Reuses existing `status` field
2. **Semantic clarity** - Status already means "where is this task"
3. **Simpler mental model** - One concept instead of two
4. **Backward compatible** - Existing tasks already have status

## Plan Structure

1. **01-status-agent-mapping.md** - Mapping logic and transitions
2. **02-action-panel-integration.md** - UI changes for decision routing
3. **03-agent-spawning.md** - Spawning correct agent type on progression
4. **04-edge-cases.md** - Error handling, migration, special cases

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent-state-machine.ts` | **New file**: Status transitions and agent mapping |
| `src/components/workspace/action-panel.tsx` | Decision logic for default vs custom |
| `src/components/workspace/task-workspace.tsx` | Support for spawning new agent type |
