# Thread Display Stale Bug - Diagnosis and Fix

## Bug Summary

When opening a thread from the unified inbox, the control panel displays the **previous thread's content** instead of the newly selected thread's messages.

## Log Analysis (2026-01-22)

Recent logs reveal key timing information:

```
[13:19:09.888] Thread selected: aff422ee-65c3-4b70-8c82-c700705c75a8
[13:19:09.888] show_control_panel_simple called
[13:19:09.889] SHOWING control-panel
[13:19:09.892] control-panel now KEY
[13:19:12.789] Hiding panel on blur (not pinned)   ← 3 seconds later!
[13:19:12.791] Clearing pending control panel
[13:19:12.792] Unpinning panel
[13:19:12.795] [ErrorPanel] Received panel-hidden event
```

### Key Observations from Logs

1. **Panel hides on blur after ~3 seconds** - The control panel loses focus and auto-hides
2. **`panel-hidden` event is received by ErrorPanel** - This is expected (all panels listen), but indicates the event system is working
3. **`Clearing pending control panel`** happens when panel is hidden - This clears the Rust-side state
4. **Event flow is working** - `open-control-panel` is emitted and received

### What the Logs DON'T Show

The logs don't show `[useControlPanelParams] Received open-control-panel event` which would confirm the frontend received the thread switch. This could mean:
- The event is being received but not logged
- The event IS received but the component doesn't re-render due to Zustand selector issue

## Root Cause Analysis

**Primary Issue: Zustand selector closure problem** (original diagnosis still valid)

The primary issue is with **Zustand selector behavior** in how thread state is retrieved.

**Location:** `src/components/control-panel/control-panel-window.tsx`, line 123

```typescript
const activeState = useThreadStore((s) => s.threadStates[threadId]);
```

### The Problem

Zustand uses **strict equality (`===`) by default** for selector return values. When you access `s.threadStates[threadId]`, here's what happens:

1. **User clicks on thread A** → `threadId` prop = "thread-A"
2. Selector returns the state object for thread A
3. Component renders with thread A's messages ✓

4. **User clicks on thread B** → `threadId` prop = "thread-B"
5. Selector should return thread B's state
6. **BUT**: The selector function closes over `threadId`, but Zustand doesn't know `threadId` changed externally
7. **The component doesn't re-render** because Zustand only checks if the *return value* changed by reference
8. Thread A's messages remain displayed ✗

### Why This Happens

1. **Selector closure issue** - The selector `(s) => s.threadStates[threadId]` captures `threadId` from the component's scope, but Zustand's subscription doesn't track external variables
2. **No dependency tracking** - Zustand's default selector doesn't know that `threadId` changed externally; it only subscribes to store changes
3. **Reference equality** - If the specific thread state object hasn't changed in the store, the selector returns the same reference

### Evidence from Store

From `src/entities/threads/store.ts`:

```typescript
interface ThreadStoreState {
  threadStates: Record<string, DiskThreadState>;  // Keyed by threadId
  activeThreadId: string | null;  // Exists but not used in selectors!
}
```

The store tracks `activeThreadId` but the component uses the `threadId` prop directly without ensuring re-subscription.

## Secondary Issues

### 1. Missing ThreadView Key Prop

From `src/components/control-panel/control-panel-window.tsx`, lines 614-624:

```typescript
<ThreadView
  ref={messageListRef}
  messages={messages}
  isStreaming={isStreaming}
  status={viewStatus}
  toolStates={toolStates}
  onToolResponse={handleToolResponse}
/>
```

**No `key` prop** means React reuses the same component instance when switching threads, potentially keeping internal state alive.

### 2. Virtualized List Not Reset

The `MessageList` uses `react-virtuoso`. Without a `key` or explicit reset, the virtualized list may maintain scroll state or cached measurements from the previous thread.

### 3. Scroll Position Tracking

While `hasScrolledOnMount` ref is reset when `threadId` changes:
```typescript
useEffect(() => {
  hasScrolledOnMount.current = false;
}, [threadId]);
```

The `MessageList` component itself may maintain internal scroll state.

## Code Flow

```
UnifiedInbox.tsx (main window)
  └─ InboxItemRow clicked
      └─ onThreadSelect(thread) called
          └─ switchToThread(thread.id)
              └─ switchControlPanelClientSide({ type: "thread", threadId })
                  └─ eventBus.emit("open-control-panel", { view })
                      └─ event-bridge.ts forwards to Tauri
                          └─ emit("app:open-control-panel", payload)  ← CROSS-WINDOW
                              └─ ControlPanelWindow (separate window) receives via setupIncomingBridge()
                                  └─ useControlPanelParams hook receives event
                                      └─ setParams({ view: { type: "thread", threadId: "B" } })
                                          └─ ControlPanelWindowContent({ threadId: "B" })
                                              └─ useThreadStore((s) => s.threadStates["B"]) ← POTENTIAL ISSUE
```

### Event Propagation Path

The thread selection involves **cross-window communication**:

1. **Main window** (inbox) emits `open-control-panel` via eventBus
2. **Outgoing bridge** (`setupOutgoingBridge`) broadcasts to Tauri with `app:` prefix
3. **Control panel window** receives via `setupIncomingBridge()`
4. **`useControlPanelParams` hook** handles event, updates `params` state
5. **Component re-renders** with new `threadId`

**Important**: The `open-control-panel` event is in `RUST_PANEL_EVENTS` (local events), NOT `BROADCAST_EVENTS`. This means:
- It's forwarded directly from Tauri to mitt without `app:` prefix
- Rust can emit it directly to the control-panel window via `emit_to(CONTROL_PANEL_LABEL, ...)`

### Alternative Hypothesis: Event Not Reaching Control Panel

If `useControlPanelParams` isn't receiving the event when switching threads (while panel is already open):

1. Main window emits `open-control-panel`
2. This goes to the **outgoing bridge** which broadcasts via Tauri
3. But `open-control-panel` is a **LOCAL event**, not a broadcast event
4. The event may not be properly routed between windows

## Proposed Fixes

### Fix 1: Force Selector Re-evaluation (Primary Fix)

Use a key that includes `threadId` to force the selector to be recreated:

```typescript
// Option A: Include threadId in selector subscription
const activeState = useThreadStore(
  useCallback((s) => s.threadStates[threadId], [threadId])
);

// Option B: Use getState() with useMemo for explicit dependency
const activeState = useMemo(() => {
  return useThreadStore.getState().threadStates[threadId];
}, [threadId]);

// Option C: Subscribe to the whole threadStates and select inside component
const threadStates = useThreadStore((s) => s.threadStates);
const activeState = threadStates[threadId];
```

**Recommended: Option A** - wrapping the selector in `useCallback` with `threadId` as a dependency ensures Zustand creates a new subscription when `threadId` changes.

### Fix 2: Add Key to ThreadView (Secondary Fix)

Force unmount/remount when thread changes:

```typescript
<ThreadView
  key={threadId}  // Force fresh instance per thread
  ref={messageListRef}
  messages={messages}
  isStreaming={isStreaming}
  status={viewStatus}
  toolStates={toolStates}
  onToolResponse={handleToolResponse}
/>
```

### Fix 3: Add Key to MessageList

```typescript
<MessageList
  key={threadId}  // Reset virtuoso state
  ref={messageListRef}
  turns={turns}
  messages={messages}
  isStreaming={isStreaming}
  toolStates={toolStates}
  onToolResponse={onToolResponse}
/>
```

### Fix 4: Use Zustand's useShallow (Alternative)

```typescript
import { useShallow } from 'zustand/react/shallow';

const activeState = useThreadStore(
  useShallow((s) => s.threadStates[threadId])
);
```

Note: `useShallow` does shallow comparison, which helps but may not fully solve the selector closure issue.

## Recommended Implementation Order

### Phase 1: Verify Event Propagation (Investigation)

Before implementing fixes, verify whether `open-control-panel` events are reaching the control panel:

1. Add logging to `useControlPanelParams.ts` line 101:
   ```typescript
   const handleOpenControlPanel = (payload: OpenControlPanelPayload) => {
     logger.info("[useControlPanelParams] Received open-control-panel event:", payload);
     // ... existing code
   };
   ```

2. Check if event reaches control panel window when switching threads

### Phase 2: Fix Event Routing (If events aren't propagating)

If events aren't reaching the control panel, the issue is that `open-control-panel` is treated as a LOCAL event (from Rust) but is being emitted from the main window JS:

**Option A**: Add `open-control-panel` to `BROADCAST_EVENTS` in `event-bridge.ts`:
```typescript
const BROADCAST_EVENTS = [
  // ... existing events
  "open-control-panel",  // Add this
] as const;
```

**Option B**: Have main window invoke a Rust command that emits to control panel:
```typescript
// Instead of eventBus.emit, call Rust:
await invoke("switch_control_panel_view", { view });
// Rust then emits to control-panel window
```

### Phase 3: Fix Zustand Selector (Original fixes)

1. **Fix 1 (Option A)** - Wrap selector in `useCallback` with `[threadId]` dependency
2. **Fix 2** - Add `key={threadId}` to `ThreadView`
3. **Fix 3** - Add `key={threadId}` to `MessageList` if issues persist

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/control-panel/control-panel-window.tsx` | Line 123: Wrap selector in useCallback; Lines 614-624: Add key to ThreadView |
| `src/components/thread/message-list.tsx` | Accept and pass through key prop |

## Testing

1. Open thread A from inbox, verify messages display
2. Open thread B from inbox, verify messages update to thread B
3. Open thread A again, verify messages revert to thread A
4. Verify scroll position resets when switching threads
5. Test with threads that are still loading vs already cached

## Severity

**HIGH** - This is a blocking UX issue that prevents users from navigating between threads properly.

## Updated Diagnosis (2026-01-22)

Based on log analysis, there are **two potential root causes**:

### Hypothesis A: Event Propagation Issue (More Likely)

The `open-control-panel` event from main window may not be reaching the control panel window because:
- `switchControlPanelClientSide()` emits via eventBus in the **main window**
- The event is classified as a LOCAL event (from Rust), not a BROADCAST event
- LOCAL events are expected to come FROM Rust TO a specific window
- When emitted from JS, it may only go to the outgoing bridge which doesn't forward local events

**Evidence**: The logs show `show_control_panel_simple` being called (Rust), but no frontend log of receiving the event.

### Hypothesis B: Zustand Selector Issue (Original)

The selector closure doesn't re-evaluate when `threadId` prop changes, keeping stale data.

**Evidence**: This is a known Zustand pattern issue, but without seeing the frontend behavior, it's harder to confirm.

## Next Steps

1. **Add logging** to `useControlPanelParams` to confirm event receipt
2. **If events NOT received**: Fix event routing (add to BROADCAST_EVENTS)
3. **If events ARE received**: Apply Zustand selector fixes

---

## Spotlight Comparison (2026-01-22)

The spotlight successfully opens threads. Here's why it works differently:

### Spotlight Flow (WORKS)

```
Spotlight.tsx
  └─ createSimpleThread()
      └─ openControlPanel(threadId, taskId, content)  ← hotkey-service.ts
          └─ invoke("open_control_panel", { threadId, taskId, prompt })
              └─ Rust: panels::show_control_panel(&app, &thread_id, &task_id, prompt)
                  └─ set_pending_control_panel(...)  ← STORES THREAD INFO IN RUST
                  └─ app.emit("open-control-panel", &payload)  ← RUST EMITS TO CONTROL PANEL
                  └─ panel.show_and_make_key()
```

**Key difference**: Spotlight calls `invoke("open_control_panel")` which:
1. Stores `PendingControlPanel` in Rust state
2. **Rust emits `open-control-panel` event** directly to control panel window
3. Control panel receives event via `setupIncomingBridge()` (LOCAL_EVENTS)

### Main Window Flow (BROKEN)

```
MainWindowLayout.tsx
  └─ handleThreadSelect()
      └─ eventBus.emit("open-control-panel", { view })  ← JS EMIT (STAYS LOCAL!)
      └─ invoke("show_control_panel")
          └─ Rust: panels::show_control_panel_simple(&app)
              └─ panel.show_and_make_key()  ← NO EVENT EMITTED, NO PENDING SET
```

**Problem**: Main window:
1. Emits `open-control-panel` via JS eventBus (stays in main window only!)
2. Calls `show_control_panel` which does NOT emit to control panel
3. Control panel never receives the thread selection event

### Root Cause Confirmed

The `open-control-panel` event from main window JS **does not cross to the control panel window** because:
- It's classified as a `RUST_PANEL_EVENT` (expected to come FROM Rust)
- The outgoing bridge only forwards `BROADCAST_EVENTS`
- `show_control_panel_simple` in Rust does NOT emit the event (unlike `show_control_panel`)

### Recommended Fix: Route Through Rust

Follow the same pattern as spotlight - have Rust emit the event to control panel.

#### Implementation Steps

**Step 1: Add new Rust command** (`src-tauri/src/lib.rs`)
```rust
/// Shows the control panel with a specific view (thread, plan, or inbox)
#[tauri::command]
fn show_control_panel_with_view(
    app: AppHandle,
    view: serde_json::Value,  // { type: "thread", threadId: "..." } or { type: "plan", planId: "..." } or { type: "inbox" }
) -> Result<(), String> {
    // Emit event to control panel window
    // NOTE: Must use emit() not emit_to() - emit_to() doesn't work with NSPanels
    let _ = app.emit("open-control-panel", &serde_json::json!({ "view": view }));

    // Show the panel
    panels::show_control_panel_simple(&app)
}
```

> **Important**: Use `app.emit()` instead of `app.emit_to()` because `emit_to()` does not work with NSPanel windows. The control panel is an NSPanel, not a regular window.

**Step 2: Register command** (`src-tauri/src/lib.rs` in `invoke_handler`)
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    show_control_panel_with_view,
])
```

**Step 3: Add TypeScript wrapper** (`src/lib/hotkey-service.ts`)
```typescript
/**
 * Shows the control panel with a specific view.
 * Routes through Rust to ensure event reaches control panel window.
 */
export const showControlPanelWithView = async (view: ControlPanelViewType): Promise<void> => {
  await invoke("show_control_panel_with_view", { view });
};
```

**Step 4: Update MainWindowLayout** (`src/components/main-window/main-window-layout.tsx`)
```typescript
// Before:
eventBus.emit("open-control-panel", { view: { type: "thread", threadId: thread.id } });
await invoke("show_control_panel");

// After:
await showControlPanelWithView({ type: "thread", threadId: thread.id });
```

**Step 5: Update plan selection similarly**
```typescript
// Before:
eventBus.emit("open-control-panel", { view: { type: "plan", planId: plan.id } });
await invoke("show_control_panel");

// After:
await showControlPanelWithView({ type: "plan", planId: plan.id });
```

#### Why This Approach

1. **Consistent with spotlight** - Uses the same Rust-mediated event pattern
2. **No event duplication** - Single source of truth for `open-control-panel` events
3. **Works reliably** - Rust's `emit()` broadcasts to all windows including NSPanels
4. **Maintains separation** - JS doesn't need to know about cross-window event routing

#### NSPanel Caveat

Tauri's `emit_to()` does not work with NSPanel windows (used for control panel, spotlight, etc.). Always use `emit()` for events that need to reach panels. The control panel's incoming bridge will receive the event along with all other windows.
