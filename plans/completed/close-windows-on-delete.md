# Close Standalone Windows When Plan/Thread is Deleted

## Overview

When a user double-click deletes (archives) a plan or thread in the main window, any standalone windows that have that content open should automatically close.

## Current Architecture Analysis

### Double-Click Delete Behavior
- **Current implementation**: Double-click on inbox items triggers archive (not permanent delete)
- Archive action is in `SuggestedActionsPanel` and accessible via quick actions
- Archive emits `PLAN_ARCHIVED` event and moves files to `archive/plans/`
- Thread archive emits `THREAD_ARCHIVED` event

### Window Management
- **NSPanel (singleton)**: The main control panel, hides/shows but never closes
- **Standalone Windows**: Created via `pop_out_control_panel()`, tracked in `CONTROL_PANEL_WINDOWS` registry
- Each standalone window has:
  - Unique `instanceId` (UUID)
  - URL params identifying content: `?view=plan&planId=xxx` or `?view=thread&threadId=xxx`
  - Registry entry in Rust backend with `thread_id` or `task_id` (used for plan_id)

### Event System
- Uses Tauri emit/listen with app-wide broadcast
- Events bridge between local mitt eventBus and Tauri events
- Cross-window events already work (tested with `AGENT_STATE`)

## Feasibility: HIGH

The existing architecture fully supports this feature:
1. Events already broadcast to all windows
2. Window registry tracks which content each window displays
3. `close_control_panel_window()` IPC command exists
4. Standalone windows know their `instanceId` and content via `PanelContextStore`

## Recommended Implementation

### Option A: Frontend-Only Approach (Simpler)

Each standalone window listens for archive events and closes itself if affected.

**Pros**: Minimal code changes, leverages existing event system
**Cons**: Each window makes its own close decision

#### Key Insight: Handling Quick Action Archive

When a user archives via quick action in the same window, that window navigates to the next item instead of closing. The event listener must distinguish between:
- **Originating window**: Should NOT close (it navigates to next item)
- **Other windows with same content**: SHOULD close

**Solution**: Include `originInstanceId` in the archive event payload. Each window checks if it's the originator - if so, skip closing (the quick action handler will navigate instead).

#### Implementation Steps

1. **Update event payload types** to include optional `originInstanceId`

   File: `src/entities/events.ts`

   ```typescript
   [EventName.PLAN_ARCHIVED]: { planId: string; originInstanceId?: string | null };
   [EventName.THREAD_ARCHIVED]: { threadId: string; originInstanceId?: string | null };
   ```

2. **Pass instanceId when archiving from quick action**

   File: `src/components/control-panel/plan-view.tsx` (and `control-panel-window.tsx` for threads)

   ```typescript
   // In handleQuickAction:
   if (action === "archive") {
     await planService.archive(planId, { originInstanceId: instanceId });
     await navigateToNextItemOrFallback(currentItem, { actionType: "archive" });
   }
   ```

3. **Update service to accept and forward originInstanceId**

   File: `src/entities/plans/service.ts`

   ```typescript
   async archive(planId: string, options?: { originInstanceId?: string | null }): Promise<void> {
     // ... existing logic ...
     eventBus.emit(EventName.PLAN_ARCHIVED, {
       planId,
       originInstanceId: options?.originInstanceId
     });
   }
   ```

4. **Add event listener in standalone windows**

   File: `src/components/control-panel/control-panel-window.tsx`

   ```typescript
   useEffect(() => {
     if (!isStandaloneWindow || !instanceId) return;

     const handlePlanArchived = ({ planId, originInstanceId }: { planId: string; originInstanceId?: string | null }) => {
       // Skip if we're the window that initiated the archive (we'll navigate instead)
       if (originInstanceId === instanceId) return;

       if (view?.type === 'plan' && view.planId === planId) {
         invoke('close_control_panel_window', { instanceId });
       }
     };

     const handleThreadArchived = ({ threadId, originInstanceId }: { threadId: string; originInstanceId?: string | null }) => {
       // Skip if we're the window that initiated the archive (we'll navigate instead)
       if (originInstanceId === instanceId) return;

       if (view?.type === 'thread' && view.threadId === threadId) {
         invoke('close_control_panel_window', { instanceId });
       }
     };

     eventBus.on(EventName.PLAN_ARCHIVED, handlePlanArchived);
     eventBus.on(EventName.THREAD_ARCHIVED, handleThreadArchived);

     return () => {
       eventBus.off(EventName.PLAN_ARCHIVED, handlePlanArchived);
       eventBus.off(EventName.THREAD_ARCHIVED, handleThreadArchived);
     };
   }, [view, isStandaloneWindow, instanceId]);
   ```

   Same pattern for `plan-view.tsx`.

5. **No backend changes required** - Uses existing `close_control_panel_window` command

### Option B: Backend-Driven Approach (More Robust)

Backend listens for archive events and closes all affected windows from Rust.

**Pros**: Centralized logic, handles edge cases better
**Cons**: Requires new IPC command and event listener in Rust

#### Implementation Steps

1. **Add new Tauri command** in `src-tauri/src/panels.rs`:

   ```rust
   #[tauri::command]
   pub fn close_windows_for_content(
       app: AppHandle,
       content_type: String, // "plan" or "thread"
       content_id: String,
   ) -> Result<Vec<String>, String> {
       let windows = CONTROL_PANEL_WINDOWS.lock().unwrap();
       let mut closed = vec![];

       for (instance_id, data) in windows.iter() {
           let should_close = match content_type.as_str() {
               "plan" => data.task_id.as_ref() == Some(&content_id),
               "thread" => data.thread_id.as_ref() == Some(&content_id),
               _ => false,
           };

           if should_close {
               if let Some(window) = app.get_webview_window(&format!("control-panel-window-{}", instance_id)) {
                   let _ = window.close();
                   closed.push(instance_id.clone());
               }
           }
       }

       Ok(closed)
   }
   ```

2. **Call from archive action** in `src/entities/plans/service.ts`:

   ```typescript
   async archive(id: string) {
     // ... existing archive logic ...

     // Close any standalone windows showing this plan
     await invoke('close_windows_for_content', {
       contentType: 'plan',
       contentId: id,
     });

     eventBus.emit(EventName.PLAN_ARCHIVED, { planId: id });
   }
   ```

3. **Same for thread archive** in thread service

## Recommendation

**Start with Option A** (frontend-only approach):
- Faster to implement
- Lower risk
- Can migrate to Option B later if edge cases emerge

Option B is better if:
- Windows might miss events during rapid operations
- Need atomic "close all affected windows" behavior
- Want centralized logging/analytics

## Edge Cases to Handle

1. **Quick action archive from same window**: When a user archives via quick action in the same window where they're viewing the content, the window should **NOT close** - it navigates to the next item instead (via `navigateToNextItemOrFallback`). The close behavior only applies to **other** standalone windows displaying the same content.

2. **Window already closing**: Check if window is still open before calling close

3. **Race condition**: Archive event arrives while window is still loading - use debounce or state check

4. **NSPanel showing deleted content**: Should navigate away or show "content not found" (already handled in `plan-view.tsx`)

5. **Multiple windows for same content**: Other windows should close (the originating window navigates instead)

## Files to Modify

### Option A (Recommended)
- `src/entities/events.ts` - Add `originInstanceId` to event payload types
- `src/entities/plans/service.ts` - Accept and forward `originInstanceId` in archive method
- `src/entities/threads/service.ts` - Accept and forward `originInstanceId` in archive method
- `src/components/control-panel/plan-view.tsx` - Pass `instanceId` when archiving, add archive event listener
- `src/components/control-panel/control-panel-window.tsx` - Pass `instanceId` when archiving, add archive event listener

### Option B (If needed later)
- `src-tauri/src/panels.rs` - Add `close_windows_for_content` command
- `src-tauri/src/lib.rs` - Register new command
- `src/entities/plans/service.ts` - Call command on archive
- `src/entities/threads/service.ts` - Call command on thread archive

## Testing Plan

1. **Archive from main window inbox** - Open a plan in standalone window, archive from inbox double-click → standalone window closes
2. **Archive from quick action (same window)** - Open plan in standalone window, use quick action to archive → window navigates to next item (doesn't close)
3. **Archive from quick action (different window)** - Open same plan in two standalone windows, archive via quick action in window A → window A navigates, window B closes
4. **Thread archive** - Repeat above tests with threads
5. **Multiple windows same content** - All non-originating windows should close
6. **Rapid archive** - Archive multiple items quickly, verify proper cleanup
