# Sidebar Selection State Sync Fix

## Problem

The sidebar tree menu items don't always show the "selected" state for the currently opened window/content pane. The visual selection in the tree can become stale when the content pane view changes through means other than clicking on a tree item.

## Solution: Centralized Navigation Service

Create a centralized navigation service that handles both tree selection and pane view updates together, ensuring they always stay in sync.

## Implementation

### Step 1: Create Navigation Service

**File: `src/stores/navigation-service.ts`**

```typescript
import { contentPanesService } from "./content-panes/service";
import { treeMenuService } from "./tree-menu/service";
import type { ContentPaneView } from "@/components/content-pane/types";

export const navigationService = {
  /**
   * Navigate to a thread - updates both content pane AND tree selection.
   */
  async navigateToThread(threadId: string, options?: { autoFocus?: boolean }): Promise<void> {
    // Update tree selection first (so UI updates together)
    await treeMenuService.setSelectedItem(threadId);
    // Then update content pane
    await contentPanesService.setActivePaneView({
      type: "thread",
      threadId,
      autoFocus: options?.autoFocus,
    });
  },

  /**
   * Navigate to a plan - updates both content pane AND tree selection.
   */
  async navigateToPlan(planId: string): Promise<void> {
    await treeMenuService.setSelectedItem(planId);
    await contentPanesService.setActivePaneView({ type: "plan", planId });
  },

  /**
   * Navigate to a view - clears tree selection for non-item views.
   */
  async navigateToView(view: ContentPaneView): Promise<void> {
    if (view.type === "thread") {
      await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
    } else if (view.type === "plan") {
      await this.navigateToPlan(view.planId);
    } else {
      // For settings, logs, empty - clear tree selection
      await treeMenuService.setSelectedItem(null);
      await contentPanesService.setActivePaneView(view);
    }
  },
};
```

### Step 2: Update main-window-layout.tsx

Update the following locations to use `navigationService`:

1. **Command+N handler** (~line 102-114): Replace `contentPanesService.setActivePaneView()` with `navigationService.navigateToThread()`

2. **`set-content-pane-view` event handler** (~line 162-186): Replace `contentPanesService.setActivePaneView()` with `navigationService.navigateToView()`

3. **`handleItemSelect` callback** (~line 75-90): Use `navigationService.navigateToThread/Plan()` - this simplifies the code since tree selection is now handled by the service

### Step 3: Update command-palette.tsx

Update the `navigateToItem()` function (~line 116-132) to use `navigationService.navigateToThread/Plan()` instead of calling `contentPanesService.setActivePaneView()` directly.

### Step 4: Update use-context-aware-navigation.ts

Update `navigateToThread()` and `navigateToPlan()` functions (~line 28-33) to use `navigationService` for main window navigation.

## Files to Modify

1. **Create:** `src/stores/navigation-service.ts`
2. **Modify:** `src/components/main-window/main-window-layout.tsx`
3. **Modify:** `src/components/command-palette/command-palette.tsx`
4. **Modify:** `src/hooks/use-context-aware-navigation.ts`

## Testing

### Manual Test Cases

1. **Command+N** - New thread should be selected in tree
2. **Command+P** - Selected item should sync to tree
3. **Spotlight** - Navigated thread should be selected in tree
4. **Keyboard nav** - Next/prev item navigation should sync to tree
5. **Tree click** - Should work as before (regression test)
6. **Settings/Logs** - Tree selection should clear
