# Task Population Diagnosis Plan

## Issue Description

Despite implementing reactive task views audit, newly created tasks are not populating the main task board view automatically. Users must manually refresh to see new tasks.

## Architecture Overview

### Task Creation Flow
```
Spotlight → taskService.createDraft() → Optimistic Store Update → Disk Write → Event Emission → Entity Listeners → Store Refresh → UI Update
```

### Key Components Involved

1. **Task Creation** (`src/components/spotlight/spotlight.tsx:251-262`)
   - Creates draft task via `taskService.createDraft()`
   - Emits `TASK_CREATED` event

2. **Entity Listeners** (`src/entities/tasks/listeners.ts:14-22`)
   - Listen for `TASK_CREATED` events
   - Call `taskService.refreshTask()` to sync from disk

3. **Store Management** (`src/entities/tasks/store.ts`)
   - `_applyCreate()` - Optimistic UI update
   - `_applyUpdate()` - Updates from disk refresh

4. **UI Components**
   - **useTaskBoard Hook** (`src/hooks/use-task-board.ts:22`) - Groups tasks by status
   - **TaskBoardPage** (`src/components/tasks/task-board-page.tsx:41-64`) - Event listeners for UI updates

## Diagnostic Logging Added

### Service Layer Logging
- ✅ **taskService.createDraft()** - Logs metadata creation, optimistic updates, and disk writes
- ✅ **taskService.refreshTask()** - Logs directory scanning and task discovery
- ✅ **Entity Listeners** - Already had comprehensive event logging

### Store Layer Logging
- ✅ **useTaskStore._applyCreate()** - Logs store updates and task counts
- ✅ **useTaskStore._applyUpdate()** - Logs task updates
- ✅ **useTaskStore.hydrate()** - Logs initial store hydration

### UI Layer Logging
- ✅ **useTaskBoard hook** - Logs task grouping, filtering, and final counts
- ✅ **TaskBoardPage** - Logs event reception and store state changes

## Potential Failure Points

### 1. Event System Issues
**Symptoms:** Events not reaching listeners
**Check:**
- Look for `[Spotlight] Emitting TASK_CREATED event` in console
- Look for `[TaskListener] TASK_CREATED event received` in console
- Look for `[TaskBoardPage] Task event received` in console

### 2. Entity Listener Setup Issues
**Symptoms:** Events emitted but not handled
**Check:**
- Look for `[TaskListener] Setting up task event listeners...` at app startup
- Verify `setupEntityListeners()` is called in `src/App.tsx`

### 3. Store Update Issues
**Symptoms:** Events handled but store not updated
**Check:**
- Look for `[taskService.createDraft] Optimistic store update completed`
- Look for `[taskService.refreshTask] Store update completed`
- Look for `[useTaskStore._applyCreate] Store updated - task count: X → Y`

### 4. Hook Reactivity Issues
**Symptoms:** Store updated but UI not re-rendering
**Check:**
- Look for `[useTaskBoard] Task grouping completed` with updated counts
- Look for `[TaskBoardPage] Grouped tasks updated - Total: X`
- Verify new tasks appear in backlog group (new tasks have status: "backlog")

### 5. Timing Issues
**Symptoms:** Optimistic update works but entity listener refresh fails
**Check:**
- Look for gaps between `[taskService.createDraft] Successfully wrote task metadata` and `[taskService.refreshTask] Starting refresh`
- Check for errors in `[TaskListener] Failed to refresh created task`

### 6. File System Issues
**Symptoms:** Disk writes fail or metadata invalid
**Check:**
- Look for `[taskService.refreshTask] Invalid metadata at tasks/X/metadata.json`
- Check if task folders are created but metadata.json is missing/invalid

## Debugging Steps

### Step 1: Verify Event Flow
1. Create a new task via Spotlight
2. Check browser console for this sequence:
   ```
   [Spotlight] Emitting TASK_CREATED event for task: <taskId>
   [TaskListener] TASK_CREATED event received for <taskId>
   [TaskBoardPage] Task event received for <taskId>
   ```

### Step 2: Verify Store Updates
Look for this sequence:
```
[taskService.createDraft] Optimistic store update completed
[taskService.refreshTask] Store update completed for task: <taskId>
[useTaskStore._applyCreate] Store updated - task count: X → Y
```

### Step 3: Verify UI Updates
Look for:
```
[useTaskBoard] Task grouping completed - Group counts: backlog: 1, ...
[TaskBoardPage] Grouped tasks updated - Total: X
[TaskBoardPage] backlog: 1 tasks
```

### Step 4: Check Task Status and Filters
- New tasks have `status: "backlog"`
- Verify no filters are hiding backlog tasks
- Check `useTaskBoard` includes backlog in groups (it should)

## Expected Log Flow for Successful Task Creation

```
1. [taskService.createDraft] Creating draft task for repo: <repo>
2. [taskService.createDraft] Generated task metadata: {id: <id>, status: "backlog", ...}
3. [taskService.createDraft] Optimistic store update completed
4. [useTaskStore._applyCreate] Store updated - task count: X → Y
5. [useTaskBoard] Task grouping completed - Group counts: backlog: N+1, ...
6. [TaskBoardPage] Grouped tasks updated - Total: Y
7. [taskService.createDraft] Successfully wrote task metadata to disk
8. [Spotlight] Emitting TASK_CREATED event for task: <id>
9. [TaskListener] TASK_CREATED event received for <id>
10. [taskService.refreshTask] Starting refresh for task: <id>
11. [taskService.refreshTask] Found task <id>, updating store
12. [useTaskStore._applyUpdate] Store update completed for task: <id>
13. [TaskBoardPage] Task event received for <id>
```

## Resolution Strategy

1. **Run the application** with comprehensive logging enabled
2. **Create a new task** via Spotlight
3. **Analyze the console logs** following the expected flow above
4. **Identify where the flow breaks**:
   - Missing logs indicate failure points
   - Error logs show specific issues
5. **Focus debugging** on the specific failure point identified

## Common Issues and Fixes

### Issue: Events Not Emitted
- Check if `eventBus.emit()` is called in spotlight
- Verify event names match constants

### Issue: Entity Listeners Not Set Up
- Check `setupEntityListeners()` is called in App.tsx
- Verify listeners are added before first task creation

### Issue: Store Updates But UI Doesn't Render
- Check React DevTools for component re-renders
- Verify `useTaskBoard` hook dependency on store
- Check if filters are hiding new tasks

### Issue: Timing Race Conditions
- Check if optimistic update and entity listener refresh conflict
- Look for task created → immediately refreshed scenarios

## Files to Monitor

### Primary Logs Sources
- `src/entities/tasks/service.ts` - Task operations
- `src/entities/tasks/store.ts` - Store updates
- `src/entities/tasks/listeners.ts` - Event handling
- `src/hooks/use-task-board.ts` - Task grouping
- `src/components/tasks/task-board-page.tsx` - UI updates

### Configuration Files
- `src/App.tsx` - Entity listener setup
- `src/components/spotlight/spotlight.tsx` - Task creation trigger

## Success Criteria

After diagnosis and fix:
1. ✅ New tasks appear in task board immediately after creation
2. ✅ No manual refresh required
3. ✅ Tasks appear in correct status group (backlog)
4. ✅ All logging shows complete flow from creation to UI update
5. ✅ Cross-window synchronization works (if applicable)