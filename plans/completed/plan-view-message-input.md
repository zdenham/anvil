# Plan View Message Input

## Overview

Add a message input to the plan view, similar to the thread view. When a user sends a message from the plan view, it should create a NEW thread with the plan file path prefixed for context.

## Current State

**Thread View Input**: `src/components/control-panel/control-panel-window.tsx` (lines 550-557)
- Has `ThreadInput` component below the `SuggestedActionsPanel`
- Input supports @ mentions for files via trigger system
- Submits to `handleSubmit` which resumes/queues messages

**Plan View**: `src/components/control-panel/plan-view.tsx`
- Has `SuggestedActionsPanel` but NO input component
- Quick action "respond" currently does nothing

**Existing Plan Context Feature**: `src/components/control-panel/plan-input-area.tsx`
- Already has logic to prefix messages with the plan path
- Uses format: `@plans/my-feature.md my question`

## Implementation Steps

### Step 1: Add ThreadInput to PlanView

**File**: `src/components/control-panel/plan-view.tsx`

Add imports:
```typescript
import { ThreadInput, type ThreadInputRef } from "@/components/reusable/thread-input";
```

Add ref:
```typescript
const inputRef = useRef<ThreadInputRef>(null);
```

Add input below SuggestedActionsPanel (before metadata footer):
```tsx
<ThreadInput
  ref={inputRef}
  onSubmit={handleMessageSubmit}
  disabled={false}
  workingDirectory={workingDirectory}
  placeholder="Type a message to start a thread about this plan..."
  onNavigateToQuickActions={handleNavigateToQuickActions}
/>
```

### Step 2: Get Working Directory for Plan

Plans are associated with repositories. Need to derive working directory.

**File**: `src/components/control-panel/plan-view.tsx`

```typescript
import { useWorkingDirectory } from "@/hooks/use-working-directory";
// OR get from plan's repoId

// Plans have repoId - get the repo's working directory
const workingDirectory = useMemo(() => {
  if (!plan?.repoId) return undefined;
  // Get repo from store and return its path
  const repo = repoStore.getState().repos[plan.repoId];
  return repo?.primaryWorktree?.path;
}, [plan?.repoId]);
```

### Step 3: Implement handleMessageSubmit

**File**: `src/components/control-panel/plan-view.tsx`

```typescript
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { threadService } from "@/entities/threads/service";
import { spawnSimpleAgent } from "@/lib/agent-service";

const handleMessageSubmit = useCallback(async (userMessage: string) => {
  if (!workingDirectory || !plan) {
    logger.error("[PlanView] Cannot submit: missing workingDirectory or plan");
    return;
  }

  // Prefix message with @ and the plan's relative path for context
  const messageWithContext = `@${plan.path} ${userMessage}`;

  // Generate new thread ID
  const threadId = crypto.randomUUID();

  // Open control panel with the new thread
  await invoke("open_control_panel", {
    threadId,
    taskId: null,
    content: messageWithContext,
  });

  // Spawn agent with the new thread
  await spawnSimpleAgent({
    repoId: plan.repoId,
    worktreeId: plan.worktreeId ?? getDefaultWorktreeId(plan.repoId),
    threadId,
    prompt: messageWithContext,
  });
}, [plan, workingDirectory]);
```

### Step 4: Handle Focus Navigation

**File**: `src/components/control-panel/plan-view.tsx`

```typescript
// Handle focus transfer from ThreadInput to quick actions panel
const handleNavigateToQuickActions = useCallback(() => {
  if (quickActionsPanelRef.current) {
    quickActionsPanelRef.current.focus();
  }
}, []);
```

### Step 5: Implement "Type to Do Something Else" Auto-Focus Behavior

**File**: `src/components/control-panel/plan-view.tsx`

This is a key UX feature: when the user starts typing anywhere in the plan view (without the input focused), the input should automatically receive focus and capture the keystrokes. This matches the thread view behavior where typing instantly starts composing a message.

**Behavior to implement:**
1. **Clicking "respond" action** → focuses the input (via `onAutoSelectInput` callback)
2. **Pressing Enter on "respond" action** → focuses the input
3. **Typing any regular character** → auto-focuses the input AND selects the "respond" quick action

Update the keyboard handler to focus input when "respond" is selected OR when the user starts typing:

```typescript
// In the useEffect keyboard handler
} else if (e.key === "Enter" && !e.shiftKey) {
  e.preventDefault();
  const selectedAction = actions[selectedIndex];
  if (selectedAction) {
    if (selectedAction.key === "respond") {
      // Focus input instead of "executing" respond
      inputRef.current?.focus();
    } else {
      handleQuickAction(selectedAction.key);
    }
  }
} else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
  // KEY BEHAVIOR: Any regular character typed auto-focuses input
  // This enables "type to do something else" - user can just start typing
  // without explicitly clicking or selecting the input first
  const respondIndex = actions.findIndex(a => a.key === "respond");
  if (respondIndex !== -1) {
    setSelectedIndex(respondIndex); // Visual feedback: highlight "respond"
  }
  inputRef.current?.focus(); // Focus captures the typed character
}
```

**Also wire up the `onAutoSelectInput` callback** to handle clicks on "respond" action:

```typescript
const handleAutoSelectInput = useCallback(() => {
  inputRef.current?.focus();
}, []);

// Pass to SuggestedActionsPanel:
<SuggestedActionsPanel
  ...
  onAutoSelectInput={handleAutoSelectInput}
  ...
/>
```

This ensures all three entry points (click, Enter, typing) focus the input consistently.

### Step 6: Plan File Mentions (Optional Enhancement)

The existing `@` trigger for file mentions should already work for plan files since plans are just markdown files in the repository. No special handler needed - `@plans/my-feature.md` will use the standard file trigger.

## Complete Updated PlanView Structure

```tsx
return (
  <div className={...}>
    <ControlPanelHeader view={{ type: "plan", planId }} />

    {/* Main content area */}
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {/* Markdown content */}
    </div>

    {/* Quick actions panel */}
    <SuggestedActionsPanel
      ref={quickActionsPanelRef}
      view={{ type: "plan", planId }}
      onAction={handleLegacyAction}
      isStreaming={false}
      onQuickAction={handleQuickAction}
      onAutoSelectInput={handleAutoSelectInput}
    />

    {/* NEW: Message input */}
    <ThreadInput
      ref={inputRef}
      onSubmit={handleMessageSubmit}
      disabled={false}
      workingDirectory={workingDirectory}
      placeholder="Type a message to start a thread about this plan..."
      onNavigateToQuickActions={handleNavigateToQuickActions}
    />

    {/* Plan metadata footer */}
    <div className="px-4 py-3 bg-surface-800 border-t border-surface-700 text-xs text-surface-400">
      ...
    </div>
  </div>
);
```

## Testing

1. Open a plan in the control panel
2. Verify input appears below quick actions
3. **Test "type to do something else" auto-focus:**
   - With input NOT focused, type any character (e.g., "h")
   - Verify: input auto-focuses AND captures the typed character
   - Verify: "respond" quick action becomes highlighted/selected
4. **Test clicking "respond" action:**
   - Click the "respond" quick action
   - Verify: input receives focus
5. **Test Enter on "respond" action:**
   - Use arrow keys to select "respond" action
   - Press Enter
   - Verify: input receives focus (not some other action)
6. Type a message and press Enter
7. Verify:
   - New thread is created
   - Control panel switches to thread view
   - Thread message is prefixed with `@{path}` (e.g., `@plans/my-feature.md`)
   - Agent starts running with the plan context
8. Test @ file mentions work in the input
9. Test keyboard navigation between quick actions and input (arrow keys)

## Dependencies

- This plan depends on the first plan (quick actions reorder) being implemented first, since it expects "respond" action to exist

## Notes

- The `@{path}` format uses the standard file mention syntax - no special plan syntax needed
- Using the relative path allows agents to directly read the plan file content
- Example: `@plans/my-feature.md` followed by the user's question
