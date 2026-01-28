# Auto-Focus Input When Creating New Thread via Double-Click

## Problem

When a new thread is created via the double-click button on the Plus icon, the thread view opens but the input is not automatically focused. Users expect to immediately start typing their prompt.

## Current Flow

1. User double-clicks Plus button in `repo-worktree-section.tsx:168-174`
2. `handlePlusDoubleClick` calls `onNewThread()`
3. `handleNewThread()` in `main-window-layout.tsx:147-167`:
   - Creates thread via `threadService.create()`
   - Navigates via `contentPanesService.setActivePaneView({ type: "thread", threadId })`
   - Refreshes tree menu
4. `ThreadContent` component renders with new threadId
5. **Missing**: Input is not focused

## Solution

Add a mechanism to signal that the input should be auto-focused when navigating to a newly created thread.

### Option A: Pass focus flag through navigation (Recommended)

Extend the navigation payload to include an `autoFocus` flag.

**Changes required:**

1. **`src/stores/content-panes/content-panes-types.ts`** - Add optional `autoFocus` property to thread view type:
   ```typescript
   type ThreadView = {
     type: "thread";
     threadId: string;
     autoFocus?: boolean;  // New property
   };
   ```

2. **`src/stores/content-panes/content-panes-service.ts`** - Ensure `setActivePaneView` preserves the `autoFocus` flag when setting the view.

3. **`src/components/main-window/main-window-layout.tsx:159`** - Pass `autoFocus: true` when creating new thread:
   ```typescript
   await contentPanesService.setActivePaneView({
     type: "thread",
     threadId: thread.id,
     autoFocus: true  // Signal to focus input
   });
   ```

4. **`src/components/content-pane/thread-content.tsx`** - Read `autoFocus` from the view and focus input on mount/view change:
   ```typescript
   // Get autoFocus from the current view
   const { autoFocus } = view;

   // Focus input when autoFocus is true
   useEffect(() => {
     if (autoFocus) {
       inputRef.current?.focus();
     }
   }, [autoFocus, threadId]);
   ```

### Option B: Focus based on empty thread detection

Focus the input automatically when the thread has no messages (turns array is empty).

**Changes required:**

1. **`src/components/content-pane/thread-content.tsx`** - Add effect to check if thread is empty and focus:
   ```typescript
   useEffect(() => {
     // Auto-focus input for new/empty threads
     if (threadMetadata && threadMetadata.turns.length === 0) {
       inputRef.current?.focus();
     }
   }, [threadId, threadMetadata]);
   ```

**Pros**: Simpler, no changes to navigation types
**Cons**: May unexpectedly focus when returning to an empty thread (though this might be desired behavior)

### Option C: Use a transient store flag

Create a transient flag in a store that signals "focus next thread input".

**Changes required:**

1. Create or extend a UI state store with a `pendingInputFocus` flag
2. Set the flag in `handleNewThread`
3. Read and clear the flag in `ThreadContent`

**Cons**: More complex, adds indirect coupling

## Recommended Approach

**Option A** is recommended because:
- It's explicit about intent (only focuses when explicitly requested)
- It follows existing patterns of passing view configuration
- It doesn't affect behavior when navigating to existing threads
- The `autoFocus` flag is self-documenting

**Option B** is a good fallback if the view type changes are undesirable. The behavior of focusing on empty threads is arguably correct UX anyway.

## Implementation Steps

1. [ ] Add `autoFocus?: boolean` to `ThreadView` type in content-panes-types.ts
2. [ ] Update `handleNewThread` in main-window-layout.tsx to pass `autoFocus: true`
3. [ ] Add `useEffect` in thread-content.tsx to focus input when `autoFocus` is true
4. [ ] Test: Double-click Plus button → thread opens with focused input
5. [ ] Test: Navigate to existing thread → input is NOT auto-focused
6. [ ] Test: Focus behavior doesn't interfere with other navigation patterns

## Files to Modify

- `src/stores/content-panes/content-panes-types.ts`
- `src/components/main-window/main-window-layout.tsx`
- `src/components/content-pane/thread-content.tsx`
