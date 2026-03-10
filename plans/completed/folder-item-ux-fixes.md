# Folder Item UX Fixes

Four UX issues with folder nodes in the sidebar tree. Root-level folders (issue 2) split to `root-level-folders.md`.

## Issues

### 1. Folder shows both chevron AND icon simultaneously

**Current**: `folder-item.tsx:154-174` always renders both the chevron toggle button and the `IconComponent`. **Expected**: Match `thread-item.tsx:259-283` and `plan-item.tsx:309-328` pattern — show chevron when selected, show icon otherwise. The two occupy the same slot conditionally.

### ~~2. Root-level folders~~ → Split to `root-level-folders.md`

### 3. Delete label should say "Archive folder and contents"

**Current**: `folder-context-menu.tsx:62-65` uses `"Delete folder and contents"` / `"Delete folder"`. **Expected**: Should say `"Archive folder and contents"` / `"Archive folder"` and call `folderService.archive()` instead of `folderService.delete()`. The destructive delete can remain as a secondary option or be removed.

### 4. Folder context menu shouldn't have "Move to" option

**Current**: `folder-context-menu.tsx:54` shows `"Move to..."` and optionally `"Move to root"`. **Expected**: Remove both "Move to..." and "Move to root" from the folder context menu. Folders are positioned via DnD only.

### 5. Rename + icon change should be a single inline edit

**Current**: Rename (`folder-context-menu.tsx:59`) and Change Icon (`folder-context-menu.tsx:60`) are separate context menu actions. Rename opens an inline text input; Change Icon opens a separate icon picker popover. **Expected**: A single "Edit" action (or double-click) that shows an inline editing row with both the icon picker and the name input together, so the user can change both in one gesture.

## Phases

- [x] Fix chevron/icon conditional rendering in folder-item (issue 1)

- [x] Change delete to archive and fix label wording (issue 3)

- [x] Remove "Move to" options from folder context menu (issue 4)

- [x] Combine rename + icon change into single inline edit (issue 5) &lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Chevron/icon conditional rendering

**Files**: `src/components/tree-menu/folder-item.tsx`

Replace the current always-show-both pattern (lines 155-174) with the conditional pattern used by thread-item and plan-item:

- When **selected**: show chevron toggle in the first slot (w-3), hide icon
- When **not selected**: show icon in the first slot (w-3), hide chevron

The folder icon should use the same `IconComponent` already resolved on line 41. The chevron should use the same button/ChevronRight pattern already present.

```tsx
{/* Chevron (when selected) or icon — both use same fixed width */}
{isSelected ? (
  <button
    type="button"
    className="flex-shrink-0 w-3 h-3 flex items-center justify-center rounded hover:bg-surface-700 text-surface-400"
    onClick={handleChevronToggle}
    aria-label={item.isExpanded ? "Collapse folder" : "Expand folder"}
  >
    <ChevronRight
      size={12}
      className={cn(
        "tree-chevron transition-transform duration-150",
        item.isExpanded && "rotate-90",
      )}
    />
  </button>
) : (
  <span className="flex-shrink-0 w-3 flex items-center justify-center">
    <IconComponent size={11} className="text-surface-400" />
  </span>
)}
```

Remove the separate "Folder icon" span that currently follows the chevron.

## Phase 2: Archive instead of delete, fix label

**Files**: `src/components/tree-menu/folder-context-menu.tsx`, `src/components/tree-menu/folder-item.tsx`

In `folder-context-menu.tsx`:

- Change the primary destructive action from delete to archive
- Label: `"Archive folder and contents"` when `hasChildren`, `"Archive folder"` when empty
- Use `Archive` icon instead of `Trash2`
- Change `FolderDeleteConfirm` prompt to `"Archive this folder and all contents?"`

In `folder-item.tsx`:

- Change `handleDeleteClick` to call `folderService.archive(item.id)` instead of `folderService.delete(item.id)`
- Change `handleConfirmDelete` similarly
- Rename to `handleArchiveClick` / `handleConfirmArchive` for clarity

## Phase 3: Remove "Move to" from folder context menu

**Files**: `src/components/tree-menu/folder-context-menu.tsx`, `src/components/tree-menu/folder-item.tsx`

In `folder-context-menu.tsx`:

- Remove `onMoveTo` and `onMoveToRoot` from `FolderContextMenuItemsProps`
- Remove the "Move to..." `ContextMenuItem` and "Move to root" `ContextMenuItem`
- Remove the `ContextMenuDivider` that preceded them

In `folder-item.tsx`:

- Remove the `onMoveTo` and `onMoveToRoot` props passed to `FolderContextMenuItems`
- Remove the `useMoveToStore` import and usage
- Remove the `updateVisualSettings` import if only used for move-to-root

## Phase 4: Combined inline rename + icon edit

**Files**: `src/components/tree-menu/folder-item.tsx`, `src/components/tree-menu/icon-picker.tsx`, `src/components/tree-menu/folder-context-menu.tsx`

Replace the two separate actions ("Rename" and "Change icon") with a single "Edit" action that shows an inline editing row containing both the icon and the name:

1. **Context menu**: Replace "Rename" + "Change icon" with single "Edit" item (Pencil icon)
2. **Inline edit UI**: When editing, the row shows:
   - A clickable icon button (shows current icon, click opens icon picker inline/dropdown)
   - The rename text input (existing `useInlineRename` behavior)
3. **Icon picker integration**: The icon picker appears anchored to the icon button when clicked during edit mode, or could be a small inline dropdown
4. **Commit behavior**: Blur/Enter commits both the name and icon changes together. If only icon changed, still commits. If only name changed, still commits.
5. **Double-click and F2**: Both enter this combined edit mode

Implementation approach:

- Add `pendingIcon` state to track icon selection during edit
- When edit mode activates, capture current icon as `pendingIcon`
- Icon button in edit row toggles icon picker
- On commit: if name changed, call `folderService.rename()`; if icon changed, call `folderService.updateIcon()`; could also add a single `folderService.update()` method
- Remove `onChangeIcon` from context menu props