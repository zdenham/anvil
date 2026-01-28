# Refresh Button in Header

## Overview

Add a "Refresh" button to the tree panel header where the plus button used to be. This button should refresh the state (threads, plans, worktrees) similar to the refresh functionality in the InboxListWindow/Mission Control panel.

## Current State

- **Plus button location**: `src/components/tree-menu/tree-panel-header.tsx` (lines 65-104) - to be removed by sibling plan
- **Existing refresh implementation**: `src/components/inbox-list/InboxListWindow.tsx` (lines 44-57)
- **Refresh icon used**: `RefreshCw` from lucide-react (see InboxListWindow.tsx line 3)
- **Services to refresh**:
  - `threadService.hydrate()` - refreshes threads
  - `planService.hydrate()` - refreshes plans
  - Worktree sync (via `worktreeService.sync()`)

## Requirements

### Refresh Button Placement
- Add a refresh button to the header icons in `TreePanelHeader`
- Position it where the plus button currently is (or near the other icon buttons)
- Use the `RefreshCw` icon (same as InboxListWindow for consistency)

### Refresh Functionality
When clicked, the button should:
1. Show a spinning animation while refreshing (like InboxListWindow)
2. Call `threadService.hydrate()` to refresh threads
3. Call `planService.hydrate()` to refresh plans
4. Optionally refresh worktrees via `treeMenuService` or `worktreeService`
5. Stop spinning when complete

### Implementation Steps

#### Step 1: Update TreePanelHeader Props

In `src/components/tree-menu/tree-panel-header.tsx`:
- Add new prop: `onRefreshClick?: () => Promise<void>`
- Or handle refresh internally with state management

#### Step 2: Add Refresh Button to Header

In `src/components/tree-menu/tree-panel-header.tsx`:
- Import `RefreshCw` from lucide-react
- Add local state for `isRefreshing`
- Add the refresh button next to other icon buttons:
```tsx
<Tooltip content="Refresh" side="bottom">
  <button
    onClick={handleRefresh}
    disabled={isRefreshing}
    className="p-1 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
  >
    <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
  </button>
</Tooltip>
```

#### Step 3: Implement Refresh Handler

Two options:

**Option A: Handle in TreePanelHeader (simpler)**
```tsx
const [isRefreshing, setIsRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  if (isRefreshing) return;
  setIsRefreshing(true);
  try {
    await Promise.all([
      threadService.hydrate(),
      planService.hydrate(),
    ]);
  } catch (err) {
    logger.error("[TreePanelHeader] Refresh failed:", err);
  } finally {
    setIsRefreshing(false);
  }
}, [isRefreshing]);
```

**Option B: Handle in MainWindowLayout (more flexible)**
- Pass `onRefreshClick` prop from MainWindowLayout
- MainWindowLayout can coordinate the refresh with other components

Recommend Option A for simplicity, matching the InboxListWindow pattern.

#### Step 4: Update Imports

In `tree-panel-header.tsx`:
- Add: `import { RefreshCw } from "lucide-react";`
- Add: `import { threadService } from "@/entities/threads/service";`
- Add: `import { planService } from "@/entities/plans/service";`
- Add: `import { logger } from "@/lib/logger-client";`

### Icon Reference

The `RefreshCw` icon is already used in:
- `src/components/inbox-list/InboxListWindow.tsx` (line 3, 235)
- `src/components/thread/error-state.tsx`
- `src/components/diff-viewer/diff-error-state.tsx`
- `src/components/workspace/git-commits-list.tsx`
- `src/components/diff-viewer/file-card-error-boundary.tsx`

This ensures visual consistency across the app.

### Files to Modify

1. `src/components/tree-menu/tree-panel-header.tsx` - Add refresh button and handler
