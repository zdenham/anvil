# Worktree Creation Spinner

## Problem

When creating a new worktree via the plus button in the tree menu, there is no visual feedback while the worktree is being created. The operation can take a few seconds (syncing existing worktrees, creating the new worktree, re-syncing, hydrating stores), leaving users uncertain if their action was registered.

## Solution

Add a loading spinner to the plus button while a worktree is being created for that specific repo. The spinner should replace the `Plus` icon during the operation.

## Implementation

### 1. Add loading state tracking to `RepoWorktreeSection`

**File:** `src/components/tree-menu/repo-worktree-section.tsx`

The `RepoWorktreeSection` component renders the plus button. We need to:

- Accept a new prop `isCreatingWorktree?: boolean` to indicate loading state
- When `isCreatingWorktree` is true, show a `Loader2` icon with `animate-spin` instead of the `Plus` icon
- Disable the button during creation to prevent double-clicks

```tsx
// Add to props interface
isCreatingWorktree?: boolean;

// Update the button rendering (around line 325-340)
<button
  ref={buttonRef}
  type="button"
  onClick={handlePlusClick}
  onDoubleClick={handlePlusDoubleClick}
  disabled={isCreatingWorktree}
  className="flex items-center justify-center w-5 h-5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed"
  aria-label="Add new thread, worktree, or repository (double-click for new thread)"
>
  {isCreatingWorktree ? (
    <Loader2 size={12} className="animate-spin" />
  ) : (
    <Plus size={12} />
  )}
</button>
```

### 2. Track worktree creation state in `MainWindowLayout`

**File:** `src/components/main-window/main-window-layout.tsx`

Add state to track which repo is currently having a worktree created:

```tsx
// Add state (near other useState calls)
const [creatingWorktreeForRepo, setCreatingWorktreeForRepo] = useState<string | null>(null);

// Update handleNewWorktree (around line 261)
const handleNewWorktree = useCallback(async (repoName: string) => {
  logger.info(`[MainWindowLayout] New worktree requested for repo ${repoName}`);
  setCreatingWorktreeForRepo(repoName);

  try {
    // ... existing logic ...
  } catch (error) {
    logger.error(`[MainWindowLayout] Failed to create worktree:`, error);
  } finally {
    setCreatingWorktreeForRepo(null);
  }
}, []);
```

### 3. Pass loading state through `TreeMenu`

**File:** `src/components/tree-menu/tree-menu.tsx`

The `TreeMenu` component receives props from `MainWindowLayout` and passes them to `RepoWorktreeSection`. Add the new prop:

```tsx
// Update TreeMenuProps interface
creatingWorktreeForRepo?: string | null;

// Pass to RepoWorktreeSection
<RepoWorktreeSection
  // ... existing props ...
  isCreatingWorktree={creatingWorktreeForRepo === repoName}
/>
```

### 4. Update `MainWindowLayout` to pass the state

**File:** `src/components/main-window/main-window-layout.tsx`

Pass the state to `TreeMenu`:

```tsx
<TreeMenu
  // ... existing props ...
  creatingWorktreeForRepo={creatingWorktreeForRepo}
/>
```

## Files to Modify

1. `src/components/tree-menu/repo-worktree-section.tsx` - Add spinner rendering
2. `src/components/main-window/main-window-layout.tsx` - Add state tracking and pass prop
3. `src/components/tree-menu/tree-menu.tsx` - Pass prop through to section component

## Existing Patterns to Follow

The codebase already uses this pattern in several places:

- `TreePanelHeader` - Refresh button uses `RefreshCw` with `animate-spin`
- `ThreadItem` - Archive button uses `Loader2` with `animate-spin`
- `PlanItem` - Archive button uses `Loader2` with `animate-spin`

All use the standard pattern:
- `Loader2` from `lucide-react`
- `animate-spin` Tailwind class
- `disabled:opacity-50 disabled:cursor-not-allowed` for disabled state
- State managed with `useState` and `try/finally` blocks
