# 05 - Implementation Checklist

## Phase 1: State Machine Service

- [ ] **Create `src/lib/agent-state-machine.ts`**
  - [ ] `getAgentTypeForStatus(status)` - maps status to agent type
  - [ ] `getNextStatus(status)` - returns next status in workflow
  - [ ] `canProgress(status)` - check if not terminal
  - [ ] `isDefaultResponse(input)` - empty = default
  - [ ] `determineResponseAction(status, input)` - full decision logic
  - [ ] `getCurrentPhaseLabel(status)` - human-readable
  - [ ] `getNextPhaseLabel(status)` - human-readable

- [ ] **Write tests**
  - [ ] All status → agent type mappings
  - [ ] All status transitions
  - [ ] Default vs custom response detection

## Phase 2: Action Panel Changes

- [ ] **Update `src/components/workspace/action-panel.tsx`**
  - [ ] Add `taskStatus` to store selector
  - [ ] Import state machine utilities
  - [ ] Update props interface (3 handlers instead of 1)
  - [ ] Implement `handleReviewSubmit` with decision logic
  - [ ] Add hint text showing what Enter will do
  - [ ] Dynamic button text (Proceed / Complete / Send Feedback)
  - [ ] Dynamic button color based on action

## Phase 3: Task Workspace Changes

- [ ] **Update `src/components/workspace/task-workspace.tsx`**
  - [ ] Create `handleProgressToNextStep(agentType, message)` handler
  - [ ] Create `handleStayAndResume(message)` handler
  - [ ] Create `handleTaskComplete()` handler
  - [ ] Create `buildProgressionPrompt(agentType, task, message)` helper
  - [ ] Update ActionPanel props

## Phase 4: Polish & Edge Cases

- [ ] **Error handling**
  - [ ] Show retry/skip UI when agent crashes
  - [ ] Handle missing activeThreadId gracefully

- [ ] **UI polish**
  - [ ] Optional: Phase indicator component
  - [ ] Completion state display

## Files Summary

| File | Status | Change |
|------|--------|--------|
| `src/lib/agent-state-machine.ts` | **New** | State machine logic |
| `src/components/workspace/action-panel.tsx` | Modify | Decision routing, UI hints |
| `src/components/workspace/task-workspace.tsx` | Modify | New spawn handlers |

## No Changes Needed

- `src/entities/tasks/types.ts` - Uses existing `TaskStatus`
- `src/entities/tasks/service.ts` - No changes
- Agent runner - No changes
- anvil CLI - No changes

## Testing Flow

1. Create a new task (status = draft)
2. Entrypoint agent runs, requests review
3. Press Enter → status = in_progress, execution agent spawns
4. Execution agent runs, requests review
5. Type "add tests" → execution agent resumes with feedback
6. Agent requests review again
7. Press Enter → status = completed, review agent spawns
8. Review agent runs, requests review
9. Press Enter → status = merged, task complete

## Success Criteria

1. Pressing Enter progresses through all three phases
2. Typing feedback keeps you in the current phase
3. UI clearly shows what action will be taken
4. Task status reflects current workflow phase
5. Multiple threads per task work correctly
