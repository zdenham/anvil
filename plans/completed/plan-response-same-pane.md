# Plan Response Should Open Thread in Same Content Pane

## Problem

When responding to a plan in the **main window content pane**, the new thread opens in a separate control panel window instead of replacing the plan view in the same content pane.

**Expected behavior:** Responding to a plan should create a new thread and display it in the same content pane where the plan was being viewed.

**Actual behavior:** The control panel window opens with the new thread, leaving the plan still visible in the main window.

## Root Cause

**File:** `src/components/content-pane/plan-content.tsx`
**Lines:** 228-261 (`handleMessageSubmit` function)

The `PlanContent` component directly invokes the Tauri `open_control_panel` command:

```typescript
const handleMessageSubmit = useCallback(
  async (userMessage: string) => {
    // ...

    // Open control panel with the new thread
    await invoke("open_control_panel", {
      threadId,
      taskId: threadId,
      prompt: messageWithContext,
    });

    // Spawn agent with the new thread
    await spawnSimpleAgent({...});
  },
  [plan, workingDirectory]
);
```

This bypasses the context-aware navigation system that already exists and handles this exact use case correctly.

## Solution

Use the `useContextAwareNavigation` hook instead of directly invoking `open_control_panel`. This hook automatically routes navigation based on window context:

- **Main window:** Updates the content pane via `contentPanesService.setActivePaneView()`
- **Control panel:** Opens/shows the control panel via `showControlPanelWithView()`

**File to modify:** `src/components/content-pane/plan-content.tsx`

### Changes Required

1. **Import the hook:**
   ```typescript
   import { useContextAwareNavigation } from "@/hooks/use-context-aware-navigation";
   ```

2. **Use the hook in the component:**
   ```typescript
   const { navigateToThread } = useContextAwareNavigation();
   ```

3. **Update `handleMessageSubmit` to use context-aware navigation:**
   ```typescript
   const handleMessageSubmit = useCallback(
     async (userMessage: string) => {
       if (!workingDirectory || !plan) {
         logger.error(
           "[PlanContent] Cannot submit: missing workingDirectory or plan"
         );
         return;
       }

       // Prefix message with @ and the plan's relative path for context
       const messageWithContext = `@${plan.relativePath} ${userMessage}`;

       // Generate new thread ID
       const threadId = crypto.randomUUID();

       // Navigate to the new thread (context-aware: same pane in main window, control panel otherwise)
       await navigateToThread(threadId);

       // Spawn agent with the new thread
       await spawnSimpleAgent({
         repoId: plan.repoId,
         worktreeId: plan.worktreeId,
         threadId,
         prompt: messageWithContext,
         sourcePath: workingDirectory,
       });
     },
     [plan, workingDirectory, navigateToThread]
   );
   ```

4. **Remove the unused `invoke` import** (if no longer needed elsewhere in the file):
   ```typescript
   // Remove: import { invoke } from "@tauri-apps/api/core";
   ```

## Testing

1. Open a plan in the main window content pane
2. Type a message and submit it
3. Verify the new thread opens in the **same content pane** (replacing the plan view)
4. Verify the agent starts processing the message

Also verify the control panel behavior is unchanged:
1. Open a plan in the control panel
2. Type a message and submit it
3. Verify the control panel shows the new thread (existing behavior preserved)

## Related Files

- `src/hooks/use-context-aware-navigation.ts` - The hook that provides context-aware navigation
- `src/components/main-window/main-window-context.tsx` - Provides `useIsMainWindow()` hook
- `src/stores/content-panes/service.ts` - Service for managing content pane state
- `src/components/control-panel/plan-view.tsx` - Control panel version (correctly uses `open_control_panel`)
