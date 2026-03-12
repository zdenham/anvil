# File Browser: Delete Files and Folders

Add "Delete" to the file browser's right-click context menu, with a two-click confirmation pattern matching the existing plan-item and folder-archive flows.

## Phases

- [x] Add delete handler to `FileBrowserPanel`

- [x] Add "Delete" item to `EntryContextMenu` with confirmation

- [x] Wire up file tree refresh after deletion

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Context

The file browser (`src/components/file-browser/`) already has a context menu on right-click with actions like copy path, new file, new folder, and open in Cursor. There's no delete option. The backend already supports deletion via `FilesystemClient.remove()` (single file/empty dir) and `FilesystemClient.removeAll()` (recursive directory delete).

## Design

### Confirmation pattern

Follow the existing two-click confirmation used in `plan-item.tsx:363-379` and `folder-context-menu.tsx:16-26`:

1. First click shows "Delete" (red, using `ContextMenuItemDanger`)
2. Menu replaces with confirmation text + "Confirm delete" / "Cancel"

For **files**: immediate delete (single file, low risk) — skip confirmation. For **directories**: always show two-click confirmation since it's recursive and destructive.

### Changes

#### 1. `file-tree-node.tsx` — `EntryContextMenu`

- Add `onDelete: (entry: DirEntry) => void` prop
- Add `confirmingDelete` state to track whether we're in confirmation mode
- After the "Open in Cursor" divider, add another divider + delete item:
  - **Files**: `<ContextMenuItemDanger icon={Trash2} label="Delete" onClick={...} />`
  - **Directories**: First click sets `confirmingDelete = true`, which swaps menu content to confirmation view (same pattern as plan-item)
- Import `Trash2` from lucide-react

When `confirmingDelete` is true, render:

```tsx
<>
  <div className="px-2.5 py-1 text-[11px] text-surface-400">
    Delete this folder and all contents?
  </div>
  <ContextMenuItemDanger icon={Trash2} label="Confirm delete" onClick={() => { onDelete(entry); menu.close(); }} />
  <ContextMenuItem icon={ChevronRight} label="Cancel" onClick={() => setConfirmingDelete(false)} />
</>
```

Since `EntryContextMenu` is currently a plain function component, it will need to become stateful (add `useState` for `confirmingDelete`). Reset `confirmingDelete` to `false` whenever the menu closes.

#### 2. `file-browser-panel.tsx` — delete handler

Add a `handleDelete` callback:

```ts
const handleDelete = useCallback(async (entry: DirEntry) => {
  try {
    if (entry.isDirectory) {
      await fsClient.removeAll(entry.path);
    } else {
      await fsClient.remove(entry.path);
    }
  } catch (err) {
    logger.error("[FileBrowserPanel] Failed to delete:", err);
  }
}, []);
```

Pass `onDelete={handleDelete}` down through `FileTreeNode` → `FileTreeEntry` → `EntryContextMenu`.

#### 3. Props threading

- `FileTreeNodeProps` — add `onDelete: (entry: DirEntry) => void`
- `FileTreeEntryProps` — add `onDelete: (entry: DirEntry) => void`
- `EntryContextMenu` — add `onDelete: (entry: DirEntry) => void`
- Thread from `FileBrowserPanel` → `FileTreeNode` → `FileTreeEntry` → `EntryContextMenu`

#### 4. Auto-refresh

The file watcher integration in `use-file-tree.ts` already watches root and expanded directories. After deletion, the watcher should automatically detect the change and refresh the tree. No additional refresh logic needed — the existing `fileWatcherClient.onChanged` callbacks handle this.

## Files touched

| File | Change |
| --- | --- |
| `src/components/file-browser/file-tree-node.tsx` | Add delete to context menu with confirmation for dirs |
| `src/components/file-browser/file-browser-panel.tsx` | Add `handleDelete` callback, pass through props |

## Not in scope

- Undo/trash (move to OS trash) — can add later if desired
- Multi-select delete
- Keyboard shortcut for delete