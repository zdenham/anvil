# Fix: Close Panel Quick Action Does Nothing

## Diagnosis

The "Close" quick action executes successfully but nothing visible happens in the UI.

### Root Cause

The `ui:closePanel` event handler in `src/lib/quick-action-executor.ts:284-286` only updates the tree menu selection but doesn't update the content pane:

```typescript
case 'ui:closePanel':
  await treeMenuService.setSelectedItem(null);
  break;
```

The UI consists of two synchronized pieces of state:
1. **Tree menu selection** (`useTreeMenuStore.selectedItemId`) - which item is highlighted in the sidebar
2. **Content pane view** (`useContentPanesStore.panes[activePaneId].view`) - what content is displayed

The `navigationService` exists specifically to keep these in sync:

```typescript
// From src/stores/navigation-service.ts
async navigateToView(view: ContentPaneView): Promise<void> {
  if (view.type === "thread") {
    await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
  } else if (view.type === "plan") {
    await this.navigateToPlan(view.planId);
  } else {
    // For settings, logs, empty - clear tree selection
    await treeMenuService.setSelectedItem(null);
    await contentPanesService.setActivePaneView(view);  // <-- MISSING IN CLOSE HANDLER
  }
}
```

The close panel handler only does step 1 (clear tree selection) but misses step 2 (set content pane to empty view).

### Evidence from Logs

The logs show:
- `ui:closePanel` event is received and handled
- `[quick-action] Closed panel` log message appears
- Action completes successfully
- But the content pane never changes

## Fix

Update `src/lib/quick-action-executor.ts` to use the navigation service for the close panel action:

```typescript
// Change from:
case 'ui:closePanel':
  await treeMenuService.setSelectedItem(null);
  break;

// To:
case 'ui:closePanel':
  await navigationService.navigateToView({ type: 'empty' });
  break;
```

This requires adding the import at the top:
```typescript
import { navigationService } from '@/stores/navigation-service.js';
```

## Implementation

### Status: ✅ Complete

Changes made to `src/lib/quick-action-executor.ts`:

1. Added import for `navigationService`
2. Replaced `ui:closePanel` case to use `navigationService.navigateToView({ type: 'empty' })`
3. Updated `handleNavigation` to also use `navigationService` for all navigation types (thread, plan, empty, nextUnread) - this fixes the same bug for `ui:navigate` with `type: 'empty'`
4. Removed unused `treeMenuService` import
5. Exported `handleSDKEvent` function for testing

### Test Coverage

Added unit tests in `src/lib/__tests__/quick-action-executor.test.ts`:
- `ui:closePanel` navigates to empty view
- `ui:navigate` with `type: 'empty'` navigates to empty view
- `ui:navigate` with `type: 'thread'` navigates to thread
- `ui:navigate` with `type: 'plan'` navigates to plan
- Edge cases for missing IDs
