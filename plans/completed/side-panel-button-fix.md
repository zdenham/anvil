# Side Panel Create Buttons - Diagnosis & Fix

## Problem

The "Create Repository" and "Create Worktree" buttons in the side panel (tree menu) appear non-functional - clicking them does nothing visible to the user.

## Diagnosis

### Button Locations

Both buttons are located in:
- **File:** `src/components/tree-menu/repo-worktree-section.tsx`
- **Create Worktree Button:** Lines 250-262 (also in context menu at lines 303-315)
- **Create Repository Button:** Lines 263-275 (also in context menu at lines 316-328)

### Current Implementation Flow

1. **Buttons have onClick handlers** that call local functions:
   ```tsx
   onClick={(e) => {
     e.stopPropagation();
     handleNewWorktree();  // or handleNewRepo()
   }}
   ```

2. **Local handlers** (lines 124-132) call optional prop callbacks:
   ```tsx
   const handleNewWorktree = () => {
     setShowMenu(false);
     onNewWorktree?.(section.repoId);
   };

   const handleNewRepo = () => {
     setShowMenu(false);
     onNewRepo?.();
   };
   ```

3. **Props are passed down** from `MainWindowLayout` → `TreeMenu` → `RepoWorktreeSection`

4. **The handlers in MainWindowLayout are empty TODOs** (`src/components/main-window/main-window-layout.tsx` lines 208-218):
   ```tsx
   const handleNewWorktree = useCallback(async (repoId: string) => {
     logger.info(`[MainWindowLayout] New worktree requested for repo ${repoId}`);
     // TODO: Implement worktree creation flow
     // This could open a modal/dialog for branch selection or use Spotlight
   }, []);

   const handleNewRepo = useCallback(async () => {
     logger.info(`[MainWindowLayout] New repository requested`);
     // TODO: Implement repository addition flow
     // This could open a file picker dialog to select a git repository
   }, []);
   ```

### Root Cause

The buttons ARE correctly hooked up through the component hierarchy. The issue is that **the actual implementations in `MainWindowLayout` are empty** - they only log a message and do nothing else.

## Proposed Fix

### 1. Implement `handleNewRepo` (Easy)

This can reuse the exact logic from `src/components/main-window/settings/repository-settings.tsx` lines 69-101:

```tsx
const handleNewRepo = useCallback(async () => {
  try {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    });

    if (selectedPath && typeof selectedPath === "string") {
      const validation = await repoService.validateNewRepository(selectedPath);
      if (!validation.valid) {
        // Show error toast or notification
        logger.error(`[MainWindowLayout] Invalid repository: ${validation.error}`);
        return;
      }

      await repoService.createFromFolder(selectedPath);
      await repoService.hydrate();
      await treeMenuService.hydrate();
      logger.info(`[MainWindowLayout] Added repository from ${selectedPath}`);
    }
  } catch (error) {
    logger.error("[MainWindowLayout] Failed to add repository:", error);
  }
}, []);
```

**Required imports:**
```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { repoService } from "@/entities/repositories";
```

### 2. Implement `handleNewWorktree` (Moderate)

The worktree service already has a `create` method at `src/entities/worktrees/service.ts`:

```tsx
async create(repoName: string, name: string): Promise<WorktreeState>
```

The implementation needs to:
1. Get the repo name from the repoId
2. Prompt the user for a worktree name (could use a simple modal or Spotlight)
3. Call `worktreeService.create(repoName, worktreeName)`
4. Refresh the tree menu

```tsx
const handleNewWorktree = useCallback(async (repoId: string) => {
  logger.info(`[MainWindowLayout] New worktree requested for repo ${repoId}`);

  // Option A: Use Spotlight to get worktree name
  // setSpotlightMode('create-worktree');
  // setSpotlightRepoContext(repoId);

  // Option B: Use a simple prompt/modal
  const worktreeName = await promptForWorktreeName(); // needs implementation
  if (!worktreeName) return;

  try {
    await worktreeService.create(repoId, worktreeName);
    await treeMenuService.hydrate();
    logger.info(`[MainWindowLayout] Created worktree ${worktreeName} in ${repoId}`);
  } catch (error) {
    logger.error(`[MainWindowLayout] Failed to create worktree:`, error);
  }
}, []);
```

**Required imports:**
```tsx
import { worktreeService } from "@/entities/worktrees";
```

### 3. UI Considerations

For a proper UX, the worktree creation should:
- Either use Spotlight with a "create worktree" mode
- Or add a simple modal/dialog component for name input

The repository creation can work with just the file picker dialog (no additional UI needed).

## Files to Modify

1. **`src/components/main-window/main-window-layout.tsx`** (lines 208-218)
   - Implement `handleNewRepo` with file picker dialog
   - Implement `handleNewWorktree` with worktree creation logic

2. **Optionally:** Add a simple input modal component for worktree naming, or extend Spotlight to handle worktree creation mode

## Priority

- **handleNewRepo:** High priority, straightforward implementation (copy from settings)
- **handleNewWorktree:** Medium priority, requires UX decision on how to prompt for name
