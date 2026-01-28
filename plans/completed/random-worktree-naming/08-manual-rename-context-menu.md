# Sub-Plan 08: Manual Rename via Context Menu

## Overview
Add a "Rename worktree" option to the right-click context menu that replaces the worktree name with an inline editable input field.

## Dependencies
- None (can run in parallel with Phase 1 plans)

## Reference Files
- Context menu: `src/components/tree-menu/repo-worktree-section.tsx`
- Worktree service (has rename method): `src/entities/worktrees/service.ts`
- Tree menu types: `src/stores/tree-menu/types.ts`

## Current State
- Context menu exists with: New thread, New worktree, New repository, Archive worktree
- Display format is `{section.repoName} / {section.worktreeName}` (line 207)
- `worktreeService.rename(repoName, oldName, newName)` already exists

## Steps

### Step 1: Add Rename State to RepoWorktreeSection

**File:** `src/components/tree-menu/repo-worktree-section.tsx`

Add state for inline editing:

```typescript
// Add to component state (near line 41)
const [isRenaming, setIsRenaming] = useState(false);
const [renameValue, setRenameValue] = useState(section.worktreeName);
const renameInputRef = useRef<HTMLInputElement>(null);
```

Add effect to focus input when renaming starts:

```typescript
useEffect(() => {
  if (isRenaming && renameInputRef.current) {
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }
}, [isRenaming]);
```

### Step 2: Add Rename Handler

```typescript
const handleStartRename = useCallback(() => {
  setRenameValue(section.worktreeName);
  setIsRenaming(true);
  setShowContextMenu(false);
}, [section.worktreeName]);

const handleRenameSubmit = useCallback(async () => {
  const trimmedName = renameValue.trim();

  // Validate: non-empty, valid characters
  if (!trimmedName || !/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
    // Reset to original on invalid input
    setRenameValue(section.worktreeName);
    setIsRenaming(false);
    return;
  }

  // Skip if unchanged
  if (trimmedName === section.worktreeName) {
    setIsRenaming(false);
    return;
  }

  try {
    await worktreeService.rename(section.repoName, section.worktreeName, trimmedName);
    // Refresh tree menu to reflect the change
    onRefresh?.();
  } catch (error) {
    console.error('Failed to rename worktree:', error);
    // Reset on error
    setRenameValue(section.worktreeName);
  }

  setIsRenaming(false);
}, [renameValue, section.repoName, section.worktreeName, onRefresh]);

const handleRenameCancel = useCallback(() => {
  setRenameValue(section.worktreeName);
  setIsRenaming(false);
}, [section.worktreeName]);

const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleRenameSubmit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handleRenameCancel();
  }
}, [handleRenameSubmit, handleRenameCancel]);
```

### Step 3: Update Display to Show Inline Input

Replace the static worktree name display with conditional rendering:

**Current (around line 207):**
```tsx
<span className="font-mono">
  {section.repoName} / {section.worktreeName}
</span>
```

**Updated:**
```tsx
<span className="font-mono">
  {section.repoName} /{' '}
  {isRenaming ? (
    <input
      ref={renameInputRef}
      type="text"
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onBlur={handleRenameSubmit}
      onKeyDown={handleRenameKeyDown}
      className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-24"
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    section.worktreeName
  )}
</span>
```

### Step 4: Add Context Menu Item

Add "Rename worktree" to the context menu (around line 318, before Archive):

```tsx
{/* Rename worktree - only for non-main worktrees */}
{section.worktreeName !== 'main' && (
  <button
    onClick={handleStartRename}
    className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700 transition-colors"
  >
    Rename worktree
  </button>
)}
```

### Step 5: Add onRefresh Prop

If not already present, add an `onRefresh` callback prop to refresh the tree after rename:

**File:** `src/components/tree-menu/repo-worktree-section.tsx`

```typescript
interface RepoWorktreeSectionProps {
  // ... existing props
  onRefresh?: () => void;
}
```

**File:** `src/components/tree-menu/tree-menu.tsx`

Pass the refresh handler down:

```tsx
<RepoWorktreeSection
  // ... existing props
  onRefresh={refreshTreeMenu}
/>
```

### Step 6: Style the Inline Input

Ensure the input blends seamlessly with the header:

```css
/* Inline rename input styling */
.rename-input {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--zinc-500);
  outline: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  width: 80px; /* Adjust based on typical worktree name length */
  min-width: 40px;
  max-width: 120px;
}
```

Or use Tailwind classes as shown in Step 3.

## Verification
1. Right-click on worktree section shows "Rename worktree" option
2. Clicking "Rename" replaces worktree name with editable input
3. Input is focused and text is selected
4. Enter submits the rename
5. Escape cancels and restores original name
6. Clicking outside (blur) submits the rename
7. Invalid names (empty, special chars) are rejected
8. "main" worktree cannot be renamed
9. Tree menu refreshes after successful rename

## Output
- Modified `src/components/tree-menu/repo-worktree-section.tsx`
- Modified `src/components/tree-menu/tree-menu.tsx` (if onRefresh prop needed)
