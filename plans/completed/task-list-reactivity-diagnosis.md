# Task List Reactivity Issue Diagnosis

## Summary
The main window task list remains empty even after task creation despite having reactive event listeners implemented. The issue is likely in the event flow between task creation and UI updates.

## Analysis Performed

### 1. Event System Architecture ✅ CORRECT
- **Event Listeners**: Properly set up in `TaskBoardPage` component (`task-board-page.tsx:42-62`)
- **Entity Listeners**: Correctly implemented in `tasks/listeners.ts` with proper event handling
- **Event Bus**: Using mitt for cross-window communication via `events.ts`
- **Store Integration**: TaskBoardPage uses `useTaskBoard` hook which subscribes to `useTaskStore.tasks`

### 2. Task Creation Flow ✅ CORRECT
- **Event Emission**: Spotlight component correctly emits `TASK_CREATED` event (`spotlight.tsx:262`)
- **Listener Registration**: Task listeners are properly initialized in `entities/index.ts:setupEntityListeners()`
- **App Bootstrap**: Event listeners are set up during app initialization (`App.tsx:29`)

### 3. Store Update Mechanism ✅ EXPECTED TO WORK
- **Entity Listeners**: Call `taskService.refreshTask()` on TASK_CREATED events
- **Store Updates**: `refreshTask()` should update the Zustand store via optimistic updates
- **UI Reactivity**: Components should re-render automatically when store changes

## Identified Issues

### Issue 1: Event Flow Verification Gap
**Problem**: No direct verification that events are actually flowing through the system.

**Evidence**:
- Added debug logging to spotlight, listeners, and TaskBoardPage
- Need to run app and create task to verify logs appear

### Issue 2: Store Hydration vs Event Updates
**Problem**: There may be a timing issue between store hydration and live updates.

**Evidence**:
- Store hydration happens during app startup (`hydrateEntities()`)
- Live events call `refreshTask()` which should update the store
- Need to verify the store is actually being updated when events occur

### Issue 3: Cross-Window Event Propagation
**Problem**: Events might not be crossing window boundaries correctly.

**Evidence**:
- Task creation happens in spotlight (separate window)
- Task list is in main window
- Events use mitt eventBus which should handle cross-window via event bridge
- Need to verify events actually reach the main window

## Most Likely Root Cause

Based on the architecture analysis, the most probable issue is in the **event bridge configuration** or **cross-window event propagation**. Here's why:

1. **Task creation works**: Tasks are being created and saved to disk (otherwise the manual refresh wouldn't show them)
2. **Event emission works**: The spotlight emits the event correctly
3. **Event listeners are set up**: The TaskBoardPage has proper event subscriptions
4. **Store subscriptions work**: Manual refresh updates the UI successfully

This suggests the break is in the **event bridge** that should propagate events from the spotlight window to the main window.

## Verification Tests Needed

### 1. Event Emission Test
Create a task and verify these logs appear:
```
[Spotlight] Emitting TASK_CREATED event for task: {id}
```

### 2. Event Reception Test
Verify these logs appear in main window:
```
[TaskListener] TASK_CREATED event received for {id}
[TaskBoardPage] Task event received: {id}
```

### 3. Store Update Test
Verify the store is actually updated:
```
[TaskListener] Successfully refreshed created task {id}
[TaskBoardPage] Current store tasks count: {number}
```

## Recommended Fix Strategy

### Phase 1: Confirm Event Bridge Issue
1. Run the app with debug logging
2. Create a task via spotlight
3. Check if events reach the main window listeners
4. If not, the issue is in the event bridge

### Phase 2: Event Bridge Investigation
If events don't cross windows:
1. Check `setupIncomingBridge()` in `lib/event-bridge.ts`
2. Verify Tauri event forwarding configuration
3. Check if events are being prefixed correctly for cross-window delivery

### Phase 3: Alternative Solutions
If event bridge can't be fixed quickly:
1. **Polling fallback**: Add periodic task list refresh
2. **Direct store updates**: Make spotlight directly update main window store
3. **Event bridge bypass**: Use direct Tauri window communication

## Implementation Priority

**HIGH**: Verify event flow with debug logging (already implemented)
**HIGH**: Test cross-window event propagation
**MEDIUM**: Fix event bridge if broken
**LOW**: Implement fallback mechanisms

## Success Criteria

- [ ] Task created in spotlight appears immediately in main window task list
- [ ] No manual refresh required
- [ ] Cross-window synchronization works reliably
- [ ] Debug logs confirm full event flow works

## Files Modified for Debugging

1. `src/entities/tasks/listeners.ts` - Added comprehensive debug logging
2. `src/components/tasks/task-board-page.tsx` - Added event reception logging
3. `src/components/spotlight/spotlight.tsx` - Added event emission logging

The debugging infrastructure is now in place to identify exactly where the event flow breaks.