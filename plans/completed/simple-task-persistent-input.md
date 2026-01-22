# Simple Task Panel: Persistent Input & Quick Actions Across Tabs

## Goal
Make the input field and quick actions panel visible on all tabs (thread, changes, plan), not just the thread tab. When a message is sent, automatically switch back to the thread tab.

## Current State
In `src/components/simple-task/simple-task-window.tsx` (lines 647-698), the three tabs render independently:
- **Thread tab**: Renders ThreadView + SuggestedActionsPanel + ThreadInput
- **Changes tab**: Only renders ChangesTab
- **Plan tab**: Only renders PlanTab

The input and quick actions are inside the conditional `{activeView === "thread" && (...)}` block.

## Implementation Plan

### Step 1: Restructure the JSX Layout
Move `SuggestedActionsPanel` and `ThreadInput` outside of the conditional tab rendering so they appear on all views.

**Changes to `simple-task-window.tsx`:**

```jsx
{/* Main content area - only one tab visible at a time */}
{activeView === "thread" && (
  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
    <ThreadView ... />
  </div>
)}

{activeView === "changes" && (
  <div className="flex-1 min-h-0 overflow-hidden">
    {activeMetadata && <ChangesTab ... />}
  </div>
)}

{activeView === "plan" && (
  <div className="flex-1 min-h-0 overflow-hidden">
    <PlanTab planId={planId} />
  </div>
)}

{/* Quick actions and input - always visible */}
<SuggestedActionsPanel
  ref={quickActionsPanelRef}
  threadId={threadId}
  onAction={handleSuggestedAction}
  onAutoSelectInput={handleAutoSelectInput}
  isStreaming={isStreaming}
  onSubmitFollowUp={handleSubmit}
  onQuickAction={handleQuickAction}
/>
<ThreadInput
  ref={inputRef}
  threadId={threadId}
  onSubmit={handleSubmit}
  disabled={false}
  workingDirectory={workingDirectory}
  placeholder={undefined}
  onNavigateToQuickActions={handleNavigateToQuickActions}
/>
```

### Step 2: Auto-switch to Thread Tab on Message Submit
Modify the `handleSubmit` function to switch to the thread tab after submitting a message.

**Add to `handleSubmit`:**
```typescript
const handleSubmit = async (userPrompt: string) => {
  // ... existing validation ...

  // Switch to thread tab before/after submitting
  setActiveView("thread");

  // ... existing submit logic ...
};
```

### Step 3: Verify Keyboard Navigation Still Works
The global keyboard handler should continue to work since `inputRef` and `quickActionsPanelRef` remain in scope. No changes needed - the refs are already defined at the component level.

## Files to Modify
- `src/components/simple-task/simple-task-window.tsx`

## Testing Considerations
1. Verify input and quick actions appear on all three tabs
2. Verify submitting a message from changes/plan tab switches to thread tab
3. Verify keyboard navigation (arrow keys, Enter, Escape) works from all tabs
4. Verify text selection still works in the content areas when focused
