# Mark Unread Blur During Navigation - Diagnosis and Fix

## Problem Summary

When clicking the "mark unread" quick action, the task panel experiences an unexpected blur event during the transition to the next task. The panel is pinned (which should prevent hide-on-blur), but the blur still occurs and causes focus issues.

## Timeline from Logs

```
14:10:28.017 - Panel is pinned (preventing hide on blur)
14:10:28.119 - show_simple_task called with new thread_id/task_id
14:10:28.120 - Rust emits open-simple-task event
14:10:28.121 - makeKeyAndOrderFront called on panel
14:10:28.130 - **Window BLUR detected during focus restoration window**
14:10:28.174 - Focus restoration attempts to recover
```

## Root Cause Analysis

The blur occurs because of the **async gap** between:
1. React calling `invoke("open_simple_task", ...)` (line 51 in `use-navigate-to-next-task.ts`)
2. Rust setting up the new pending task state
3. Rust emitting the `open-simple-task` event
4. Rust calling `makeKeyAndOrderFront`

During this async round-trip through Tauri IPC, macOS window events fire in the native layer. The `open-simple-task` event emission and subsequent panel focus operations can cause momentary focus changes at the OS level.

### Why the blur happens even when pinned:

The panel IS pinned, and the blur handler correctly ignores the blur:
```
14:10:29.505 - [SimpleTaskPanel] Blur ignored - panel is pinned
```

However, the **webview's document** still receives a blur event at the JavaScript level (line 130), which triggers the focus restoration logic. The webview blur happens because:

1. `show_simple_task` in Rust calls `panel.show_and_make_key()` followed by `makeKeyAndOrderFront`
2. These native calls can cause the webview to momentarily lose focus even though the panel remains visible
3. The JavaScript `window.blur` event fires at 14:10:28.130

### The flow:

```
User clicks "Mark Unread"
    → handleSuggestedAction('markUnread')
    → markTaskUnread(taskId)
    → navigateToNextTaskOrFallback()
    → getNextUnreadTaskId()
    → openSimpleTask(threadId, taskId)  ← invoke to Rust

Rust side (show_simple_task):
    → set_pending_simple_task(...)
    → emit("open-simple-task", payload)
    → panel.show_and_make_key()         ← can cause momentary focus shift
    → makeKeyAndOrderFront(None)        ← redundant, also causes focus shift

React side:
    → useSimpleTaskParams receives open-simple-task event
    → Updates threadId/taskId state
    → useEffect fires for new threadId
    → Focus restoration effect triggers
    → window.blur event fires during this
```

## The Actual Problem

The issue is NOT that the panel hides (it's pinned), but that:

1. **Double focus call**: `show_and_make_key()` and `makeKeyAndOrderFront()` are called back-to-back, which may cause focus flickering
2. **Cross-IPC navigation**: Navigating to a new task goes through Tauri IPC unnecessarily when the panel is already showing
3. **Webview blur event**: The JS-level blur event fires during navigation, triggering focus restoration code that shouldn't run

## Proposed Solution: Client-Side Task Navigation

Instead of going through the Tauri `open_simple_task` invoke when the panel is already visible and we just need to change which task is displayed, we should do a **client-side navigation**.

### Option A: Pure Client-Side State Update (Recommended)

Create a new approach where, when navigating between tasks in an already-visible simple-task panel, we:

1. Update the React state directly (`useSimpleTaskParams` already has `setParams`)
2. Skip the Tauri invoke entirely for same-panel navigation
3. Only call Tauri `show_simple_task` when the panel is NOT already visible

**Implementation:**

1. **Add a check for panel visibility** in `openSimpleTask`:
   - If panel is already visible, emit a local event or update state directly
   - If panel is not visible, call `invoke("open_simple_task", ...)`

2. **Create a new function** `navigateToTask(threadId, taskId)` for client-side navigation:
   ```typescript
   // In simple-task-window or a shared module
   export function navigateToTask(threadId: string, taskId: string) {
     // Directly update the useSimpleTaskParams state
     // This triggers a re-render without any Tauri IPC
     simpleTaskParamsEmitter.emit('navigate', { threadId, taskId });
   }
   ```

3. **Modify the navigation hook** to use client-side navigation when possible:
   ```typescript
   // In use-navigate-to-next-task.ts
   const navigateToNextTaskOrFallback = useCallback(async (...) => {
     const result = await getNextUnreadTaskId(currentTaskId);

     if (result.taskId && result.threadId) {
       // Check if simple-task panel is already the active panel
       const isSimpleTaskVisible = await invoke<boolean>("is_panel_visible", {
         panelLabel: "simple-task"
       });

       if (isSimpleTaskVisible) {
         // Client-side navigation - no IPC needed
         navigateToTask(result.threadId, result.taskId);
       } else {
         // Panel not visible - need to show it via Tauri
         await openSimpleTask(result.threadId, result.taskId);
       }

       showBanner(completionMessage, "Next task focused");
       return true;
     }
     // ... fallback logic
   }, [...]);
   ```

### Option B: Fix the Focus Flickering in Rust

Less ideal but simpler - remove the redundant `makeKeyAndOrderFront` call:

```rust
// In show_simple_task()
pub fn show_simple_task(...) -> Result<(), String> {
    // ... setup code ...

    // Show the panel - this already makes it key
    panel.show_and_make_key();

    // REMOVE THIS - it's redundant and causes focus flickering:
    // panel.as_panel().makeKeyAndOrderFront(None);

    Ok(())
}
```

However, this doesn't solve the fundamental issue of unnecessary IPC round-trips.

### Option C: Suppress Blur Events During Navigation

Add a "navigation in progress" flag that suppresses blur handling:

```typescript
// In SimpleTaskWindow
const [isNavigating, setIsNavigating] = useState(false);

// Before navigation
setIsNavigating(true);
await navigateToNextTaskOrFallback();
// Reset after a delay
setTimeout(() => setIsNavigating(false), 100);

// In blur handler
if (isNavigating) {
  logger.debug("Blur ignored - navigation in progress");
  return;
}
```

This is a workaround rather than a fix.

## Recommended Implementation

**Phase 1: Quick Fix**
- Remove the redundant `makeKeyAndOrderFront` call in `show_simple_task()` (Option B)
- This reduces focus flickering

**Phase 2: Proper Fix**
- Implement client-side task navigation (Option A)
- This eliminates unnecessary IPC round-trips entirely
- Results in faster, smoother task navigation

## Files to Modify

### Phase 1 (Rust)
- `src-tauri/src/panels.rs`: Remove redundant `makeKeyAndOrderFront` call in `show_simple_task()`

### Phase 2 (TypeScript)
- `src/components/simple-task/use-simple-task-params.ts`: Add a `setParams` or `navigateToTask` method
- `src/hooks/use-navigate-to-next-task.ts`: Use client-side navigation when panel is visible
- `src/lib/hotkey-service.ts`: Add `isPanelVisible` helper (or use existing Tauri command)

## Testing

1. Open simple-task panel with a task
2. Click "Mark Unread" or any action that navigates to next task
3. Verify no blur warning appears in logs
4. Verify focus remains on the panel
5. Verify keyboard navigation still works immediately after action
