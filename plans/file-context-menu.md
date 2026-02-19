# File Browser Context Menu

Add a right-click context menu to file browser entries (files and folders), matching the visual style of the repo/worktree context menu.

## Phases

- [ ] Extract reusable context menu component
- [ ] Add context menu to file tree entries
- [ ] Wire up menu actions (copy path, copy name, open in Cursor)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extract reusable context menu component

The repo-worktree-section context menu is inline (~130 lines of portal + click-outside logic). Rather than duplicating all of that, extract a small shared component.

**Create `src/components/ui/context-menu.tsx`:**

```tsx
interface ContextMenuProps {
  position: { top: number; left: number };
  onClose: () => void;
  children: React.ReactNode;
}
```

- Renders via `createPortal` to `document.body`
- Fixed position at `position.top` / `position.left`
- Click-outside listener (`mousedown` on `document`) calls `onClose`
- Escape key closes
- Matches existing styling: `fixed z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-lg p-1.5 min-w-[180px]`

**Create `src/components/ui/context-menu-item.tsx`:**

```tsx
interface ContextMenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}
```

- Matches existing button styling: `w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap`
- Icon at `size={11}`
- `e.stopPropagation()` on click

Also export a `ContextMenuDivider` — just `<div className="h-px bg-surface-700 my-1" />`.

These can live in the same file since they're small. Consider also exporting a `useContextMenu` hook:

```tsx
function useContextMenu() {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ top: e.clientY, left: e.clientX });
    setShow(true);
  };

  const close = () => setShow(false);

  return { show, position, open, close };
}
```

## Phase 2: Add context menu to file tree entries

**Modify `src/components/file-browser/file-tree-node.tsx`:**

Add `onContextMenu` handler to both `FileTreeEntry` (file button, line 75) and `FolderEntry` (folder button, line 114).

- Import and use the `useContextMenu` hook in both entry components
- Attach `contextMenu.open` as the `onContextMenu` handler on the `<button>` elements
- Conditionally render `<ContextMenu>` when `contextMenu.show` is true
- The menu needs access to `entry.path` and `entry.name` for actions

The state lives in each `FileTreeEntry` / `FolderEntry` component — no lifting needed since each row manages its own menu.

## Phase 3: Wire up menu actions

**Menu items for files:**

| Action | Icon | Behavior |
|--------|------|----------|
| Copy path | `Copy` | `navigator.clipboard.writeText(entry.path)` |
| Copy name | `FileText` | `navigator.clipboard.writeText(entry.name)` |
| --- | divider | |
| Open in Cursor | `ExternalLink` | `Command.create("open", ["-a", "Cursor", entry.path])` (same pattern as repo-worktree-section line 232) |

**Menu items for folders:**

| Action | Icon | Behavior |
|--------|------|----------|
| Copy path | `Copy` | `navigator.clipboard.writeText(entry.path)` |
| Copy name | `Folder` | `navigator.clipboard.writeText(entry.name)` |
| --- | divider | |
| Open in Cursor | `ExternalLink` | `Command.create("open", ["-a", "Cursor", entry.path])` |

Both file and folder menus are identical for now. Use the same menu component for both. The "Open in Cursor" action uses `@tauri-apps/plugin-shell`'s `Command.create` — same import used in `repo-worktree-section.tsx`.

## Files to modify

| File | Change |
|------|--------|
| `src/components/ui/context-menu.tsx` | **New** — shared context menu primitives |
| `src/components/file-browser/file-tree-node.tsx` | Add context menu to file/folder entries |

## Notes

- The repo-worktree-section context menu could later be refactored to use the shared component, but that's out of scope for this task.
- Menu positioning: the existing pattern places the menu at cursor position. For edge cases (menu near viewport edge), we can add viewport clamping later if needed.
