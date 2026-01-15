# Task Read Status Issue - Diagnosis Report

**Date**: 2026-01-15
**Issue**: Tasks/threads are getting marked as read when they complete, even when the task panel is not shown in the UI. **User confirmed this is linked to Spotlight opening.**

## Problem Summary

The application has a race condition where threads are being marked as read upon completion due to conflicting logic between the completion event listener and the `useMarkThreadAsRead` hook. **The issue is specifically triggered by Spotlight opening, which makes the `isPanelVisible` check return true during task completion.**

## Root Cause Analysis

### 1. Expected Behavior
When an agent/thread completes:
1. Backend emits `AGENT_COMPLETED` event
2. Frontend listener intentionally marks thread as **unread** to notify user of results
3. Thread should remain unread until user actively views it

### 2. Actual Behavior (Bug)
When an agent/thread completes **while any panel is visible**:
1. Backend emits `AGENT_COMPLETED` event
2. Frontend listener marks thread as **unread** ✓
3. `useMarkThreadAsRead` hook detects completion and marks thread as **read** ❌
4. User never sees the notification because thread appears read

### 3. Technical Details

**The Race Condition**:
- `src/entities/threads/listeners.ts:62` - Marks thread unread on completion
- `src/hooks/use-mark-thread-as-read.ts:50-63` - Marks thread read on completion if panel visible

**Panel Visibility Logic Issue**:
```typescript
// Current logic checks if ANY panel is visible
const isPanelVisible = usePanelVisibility();

// Hook behavior:
useMarkThreadAsRead(threadId, {
  markOnView: true,
  markOnComplete: true, // ← This causes the bug
});
```

**Problem**: The `markOnComplete` option checks `isPanelVisible` which returns true if ANY of the 6 panel types are visible, not specifically if the task panel showing this particular task is visible.

## The Spotlight Connection - CRITICAL INSIGHT

**Why Spotlight triggers this bug**: When users open Spotlight (Cmd+Space) to create tasks, the following sequence occurs:

1. **Spotlight opens** → `panels.rs:377` calls `panel.show_and_make_key()`
2. **Panel visibility polling** → `usePanelVisibility()` detects Spotlight is visible (100ms polling interval)
3. **Task creation** → User creates task from Spotlight, which launches agent
4. **Agent completes** → While Spotlight is still visible or recently closed
5. **isPanelVisible = true** → Because Spotlight counted as "any panel visible"
6. **useMarkThreadAsRead hook fires** → Marks thread as read despite user not seeing it

**The timing issue**: Panel visibility polling (`src/hooks/use-panel-visibility.ts`) checks every 100ms if ANY of these panels are visible:
- `SPOTLIGHT_LABEL` (the culprit!)
- `CLIPBOARD_LABEL`
- `TASK_LABEL`
- `ERROR_LABEL`
- `SIMPLE_TASK_LABEL`
- `TASKS_LIST_LABEL`

When Spotlight opens, `isPanelVisible` returns true, making the hook think the task panel is visible when it's actually just Spotlight.

## Code Locations

### Key Files Involved

1. **Thread Completion Listener**:
   - `src/entities/threads/listeners.ts:55-72`
   - Marks threads unread on completion (correct behavior)

2. **Read Status Hook**:
   - `src/hooks/use-mark-thread-as-read.ts:50-63`
   - Incorrectly marks threads read on completion when panel visible

3. **Panel Visibility Check**:
   - `src/hooks/use-panel-visibility.ts` - Polls every 100ms for ANY panel visibility
   - `src-tauri/src/panels.rs:1146-1167` - `is_any_panel_visible()` checks all 6 panels
   - `src-tauri/src/panels.rs:377-387` - Spotlight opening via `show_spotlight()`
   - Checks if ANY panel is visible, not specific to current task

4. **Components Using the Hook**:
   - `src/components/simple-task/simple-task-window.tsx:77-79`
   - `src/components/workspace/task-workspace.tsx`

### Data Flow - The Complete Spotlight Timeline

```
User presses Cmd+Space (Spotlight hotkey)
    ↓
show_spotlight() called (panels.rs:377)
    ↓
panel.show_and_make_key() - Spotlight becomes visible
    ↓
usePanelVisibility() polling detects Spotlight (within 100ms)
    ↓
isPanelVisible = TRUE in React components
    ↓
User creates task from Spotlight → Agent starts
    ↓
Agent Completes (while Spotlight visibility is still detected)
    ↓
AGENT_COMPLETED Event
    ↓
┌─────────────────────────┬──────────────────────────────────┐
│ Completion Listener     │ useMarkThreadAsRead Hook         │
│ (listeners.ts:62)       │ (use-mark-thread-as-read.ts:50-63│
│ markThreadAsUnread()    │ if (isPanelVisible && completed) │
│ [CORRECT BEHAVIOR]      │   markThreadAsRead()             │
│                         │ [WRONG - Spotlight != Task panel]│
└─────────────────────────┴──────────────────────────────────┘
    ↓
Thread marked as READ (hook overwrites listener)
    ↓
User doesn't see completion notification!
```

## Potential Solutions

### Option 1: Fix Panel Visibility Check (Recommended)
Make `isPanelVisible` more specific:
- Check if the specific task panel for this thread is visible
- Not just if ANY panel is visible

### Option 2: Remove markOnComplete from Hook
Disable the `markOnComplete` behavior entirely:
```typescript
useMarkThreadAsRead(threadId, {
  markOnView: true,
  markOnComplete: false, // Prevent marking read on completion
});
```

### Option 3: Priority-based Marking
Add timing logic to ensure completion listener always wins over the hook.

### Option 4: Unified Completion Logic
Remove the hook's completion logic and handle all completion marking in the central listener.

## Impact Assessment

- **Severity**: High - Users consistently miss completion notifications when using Spotlight
- **Frequency**: Occurs whenever tasks are created via Spotlight (primary user workflow)
- **User Experience**: Threads appear already read, reducing awareness of completed work
- **Root Timing**: Spotlight's 100ms polling window creates persistent visibility detection
- **Workaround**: Users can manually check task status or refresh, but this defeats the notification system

## Recommended Fix

**Option 2** is now recommended given the Spotlight connection. Simply disable `markOnComplete` entirely:

```typescript
useMarkThreadAsRead(threadId, {
  markOnView: true,
  markOnComplete: false, // Disable to prevent Spotlight interference
});
```

**Why Option 2 is better**:
- **Simple and safe**: Removes the problematic logic entirely
- **Preserves notifications**: Lets the completion listener work as intended
- **Prevents Spotlight interference**: No more panel visibility conflicts
- **Maintains core UX**: Threads still marked read when actually viewed
- **Lower risk**: No complex panel-specific visibility logic needed

**Alternative - Enhanced Option 1**:
If you want to preserve the completion marking feature, make `isPanelVisible` panel-specific:
- Check if the specific TASK panel showing THIS thread is visible
- Not just if ANY panel (including Spotlight) is visible
- Requires tracking which panel owns which thread

The Spotlight connection makes this a **critical workflow bug** since most users create tasks via Spotlight.