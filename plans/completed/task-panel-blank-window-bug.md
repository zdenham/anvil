# Task Panel Blank Window Bug

## Problem
When submitting a spotlight search to create a new task, the task panel window appears but shows **blank content**. The NSPanel itself is visible - it's the React view inside that fails to render.

## Investigation Findings

### Issue 1: `emit_to` doesn't work with NSPanels
- **Discovery**: `emit_to(TASK_LABEL, "open-task", payload)` was not delivering events to the task panel
- **Root cause**: Known Tauri bug - `emit_to` doesn't work properly with NSPanels (see Tauri issues #11561, #11379)
- **Fix applied**: Changed to broadcast `emit("open-task", payload)` which works with all windows/panels
- **Pattern**: Already used in `event-bridge.ts` for cross-window communication

### Issue 2: React content not rendering (panel stays visible but blank)
- **Symptom**: The NSPanel window shows, but the React content inside is blank
- **Key distinction**: This is NOT the panel hiding - the panel stays visible, the React view fails to render
- **Likely cause**: The `open-task` event is not being received by the React app, so `threadId`/`taskId` state never gets set, leaving it stuck on "Waiting for task..."

### Possible causes for blank React content:
1. **Event not received**: Despite the broadcast fix, the React listener may still not receive the event
2. **Event timing**: Event fires before React listener is ready (race condition on panel show)
3. **State not updating**: Event received but state update fails silently
4. **Render condition**: `task-main.tsx` waits for `threadId && taskId && bridgeReady` - one of these may be falsy

## Current State of Code

### panels.rs - show_task()
```rust
// Show panel first, then emit event
panel.show_and_make_key();

// Broadcast event to open the task (emit_to doesn't work with panels)
app.emit("open-task", &payload)
```

### spotlight.tsx - activateResult()
```typescript
// createTask is NOT awaited - runs in background
controller.createTask(result.data.query, selectedRepo).catch(...);

// Hide spotlight immediately
await controller.hideSpotlight();
```

### task-main.tsx
- Listens for `open-task` event via `listen()`
- Sets threadId/taskId state when received
- Renders TaskWorkspace when ready

## Proposed Solutions

### Option A: Tauri State + Command (Pull Model) - RECOMMENDED
Instead of pushing events (which have timing/delivery issues with panels), have the task panel pull its data when ready.

**Rust:**
```rust
// Store pending task before showing panel
static PENDING_TASK: Mutex<Option<TaskInfo>> = Mutex::new(None);

pub fn show_task(...) {
    *PENDING_TASK.lock() = Some(TaskInfo { thread_id, task_id, ... });
    panel.show_and_make_key();
}

#[tauri::command]
fn get_pending_task() -> Option<TaskInfo> {
    PENDING_TASK.lock().take()
}
```

**Frontend:**
```typescript
useEffect(() => {
    const checkTask = async () => {
        const task = await invoke("get_pending_task");
        if (task) {
            setThreadId(task.threadId);
            setTaskId(task.taskId);
        }
    };

    window.addEventListener("focus", checkTask);
    checkTask(); // Check on mount
    return () => window.removeEventListener("focus", checkTask);
}, []);
```

**Why this is better:**
- No event timing issues - panel requests data when React is ready
- No reliance on `emit_to` or broadcast to panels
- Standard request-response pattern

### Option B: Debug the event delivery further
1. Add more logging to confirm if broadcast `emit()` reaches the panel
2. Check if the React listener is still registered after panel hide/show cycles
3. Verify `bridgeReady` state is true when event arrives

## Next Steps
1. Implement Option A (pull model) as it avoids event timing issues entirely
2. Or add detailed logging to understand why broadcast events aren't reaching the React listener
