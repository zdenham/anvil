# New Button Per Repo/Worktree Section

## Overview

Add a "+" button to each repo/worktree section header in the tree menu, positioned to the right of the item count. This provides contextual creation of threads/worktrees with the relevant repo already selected.

## Current State

- **Section component**: `src/components/tree-menu/repo-worktree-section.tsx`
- **Section header structure**: Toggle chevron → "repoName / worktreeName" → item count badge
- **Plus button in header**: `src/components/tree-menu/tree-panel-header.tsx` (lines 65-104) - to be removed
- **MainWindowLayout handlers**: `src/components/main-window/main-window-layout.tsx` (lines 132-140) - currently TODOs

## Requirements

### Plus Button Placement
- Add a "+" button to each `RepoWorktreeSection` header, positioned after the item count badge
- Button should only appear on hover of the section header (to avoid visual clutter)
- Clicking the button opens a popup menu with options

### Popup Menu Options
The popup menu should have two options (contextual to the repo/worktree):

1. **New Thread** - Creates a new thread for this specific worktree
2. **New Worktree** - Creates a new worktree for this repository

### Remove Header Plus Button
- Remove the plus button and dropdown from `TreePanelHeader` (lines 65-104)
- Remove `showNewMenu` state
- Remove `onNewThreadClick` and `onNewWorktreeClick` props from the header

## Implementation Steps

### Step 1: Update RepoWorktreeSection Props

In `src/components/tree-menu/repo-worktree-section.tsx`, add new props:
```typescript
interface RepoWorktreeSectionProps {
  section: RepoWorktreeSectionType;
  selectedItemId: string | null;
  onToggle: (sectionId: string) => void;
  onItemSelect: (itemId: string, itemType: "thread" | "plan") => void;
  showDivider: boolean;
  // New props for creation actions
  onNewThread: (worktreeId: string, worktreePath: string) => void;
  onNewWorktree: (repoId: string) => void;
}
```

### Step 2: Add Plus Button with Popup to RepoWorktreeSection

In the section header (after the item count badge), add:
- A "+" button that appears on hover
- A popup menu that opens on click with:
  - "New Thread" option (calls `onNewThread(section.worktreeId, section.worktreePath)`)
  - "New Worktree" option (calls `onNewWorktree(section.repoId)`)

```tsx
// Inside the section header div, after the item count badge
<span className="ml-auto text-xs text-surface-500 font-normal">
  {section.items.length}
</span>

{/* Plus button - visible on hover */}
<div className="relative">
  <button
    onClick={(e) => {
      e.stopPropagation();
      setShowMenu(!showMenu);
    }}
    className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-opacity"
  >
    <Plus size={12} />
  </button>
  {showMenu && (
    // Popup menu anchored above the button (opens upward)
  )}
</div>
```

Add `group` class to the section header div to enable hover visibility.

### Step 3: Update TreeMenu to Pass Callbacks

In `src/components/tree-menu/tree-menu.tsx`:
- Accept `onNewThread` and `onNewWorktree` callbacks as props
- Pass them down to each `RepoWorktreeSection`

### Step 4: Update TreePanelHeader

In `src/components/tree-menu/tree-panel-header.tsx`:
- Remove the plus button dropdown (lines 65-104)
- Remove `showNewMenu` state
- Remove `onNewThreadClick` and `onNewWorktreeClick` from props interface
- Keep: Settings, Logs, Terminal buttons

### Step 5: Wire Up MainWindowLayout

In `src/components/main-window/main-window-layout.tsx`:

#### New Thread Handler
```typescript
const handleNewThread = useCallback(async (worktreeId: string, worktreePath: string) => {
  logger.info(`[MainWindowLayout] Creating new thread for worktree ${worktreeId}`);

  // Create thread via threadService
  const thread = await threadService.create({
    worktreeId,
    worktreePath,
    name: "New Thread", // or generate a default name
  });

  // Open the new thread in the content pane
  await contentPanesService.setActivePaneView({ type: "thread", threadId: thread.id });

  // Refresh tree menu to show new thread
  await treeMenuService.refresh();
}, []);
```

#### New Worktree Handler
```typescript
const handleNewWorktree = useCallback(async (repoId: string) => {
  logger.info(`[MainWindowLayout] Creating new worktree for repo ${repoId}`);

  // Option A: Open a modal/dialog for worktree creation
  // Option B: Use Spotlight with repo context
  // Option C: Direct creation with default branch name

  // For now, we could open Spotlight in "new worktree" mode
  // or show a simple dialog to pick a branch

  // TODO: Determine the exact UX for worktree creation
}, []);
```

#### Update TreeMenu usage
```tsx
<TreeMenu
  onItemSelect={handleItemSelect}
  onNewThread={handleNewThread}
  onNewWorktree={handleNewWorktree}
  className="flex-1 min-h-0"
/>
```

### Step 6: Remove Unused Props from Header

Update `TreePanelHeader` usage in `MainWindowLayout`:
```tsx
<TreePanelHeader
  onSettingsClick={handleSettingsClick}
  onLogsClick={handleLogsClick}
  // onNewThreadClick and onNewWorktreeClick removed
/>
```

## Files to Modify

1. `src/components/tree-menu/repo-worktree-section.tsx` - Add plus button with popup
2. `src/components/tree-menu/tree-menu.tsx` - Accept and pass through new callbacks
3. `src/components/tree-menu/tree-panel-header.tsx` - Remove plus button dropdown
4. `src/components/main-window/main-window-layout.tsx` - Wire up handlers, remove header props

## UI/UX Considerations

- Plus button only visible on section header hover to keep the tree clean
- Popup should dismiss when clicking outside or pressing Escape
- Popup opens upward if near bottom of tree, downward otherwise (or just consistently in one direction)
- Consider showing keyboard shortcuts in the popup menu items
- After creating a thread, automatically open it in the content pane
- After creating a worktree, potentially show a success message or open a thread in it

## Dependencies

This plan depends on:
- `threadService.create()` being available and working
- Worktree creation flow (may need a separate plan for the worktree creation dialog/modal)

## Open Questions

1. What should the default thread name be? ("New Thread", "Untitled", timestamp-based?)
2. For worktree creation, do we need a dialog to select branch name, or use a default?
3. Should we show a confirmation/toast after successful creation?
