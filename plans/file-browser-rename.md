# File Browser: Add Rename to Context Menu

Add a "Rename" option to the right sidebar (file browser) context menu, reusing the `useTabInlineRename` hook from `src/components/split-layout/use-tab-inline-rename.ts`.

## Key Files

| File | Role |
|------|------|
| `src/components/file-browser/file-tree-node.tsx` | Tree rows + context menu — main change target |
| `src/components/file-browser/file-browser-panel.tsx` | Panel root — add `onRename` handler using `fsClient.move()` |
| `src/components/split-layout/use-tab-inline-rename.ts` | Inline rename hook to reuse (already decoupled from left sidebar) |
| `src/lib/filesystem-client.ts` | `fsClient.move(from, to)` — the rename API (already exists) |

## Design

When the user clicks "Rename" in the context menu, the entry's name `<span>` swaps to an inline `<input>` (same pattern as left sidebar's `folder-item.tsx` / `thread-item.tsx`). On Enter/blur the file is moved via `fsClient.move(oldPath, newPath)` and the tree refreshes.

The `useTabInlineRename` hook is a perfect fit — it's already decoupled from `treeMenuService`, has no space-to-hyphen transform, and handles focus/select/submit/cancel/blur.

## Phases

- [ ] Wire `onRename` callback through the component tree
- [ ] Add inline rename UI to file and folder rows
- [ ] Add "Rename" context menu item

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Wire `onRename` callback through the component tree

**`file-browser-panel.tsx`**

Add a `handleRename` callback:

```ts
const handleRename = useCallback(async (entry: DirEntry, newName: string) => {
  const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
  const newPath = `${parentDir}/${newName}`;
  try {
    await fsClient.move(entry.path, newPath);
  } catch (err) {
    logger.error("[FileBrowserPanel] Failed to rename:", err);
  }
}, []);
```

Pass `onRename={handleRename}` to `<FileTreeNode>`.

**`file-tree-node.tsx`**

- Add `onRename: (entry: DirEntry, newName: string) => Promise<void>` to `FileTreeNodeProps`, `FileTreeEntryProps`, and `FolderEntryProps`
- Thread it through `FileTreeNode` -> `FileTreeEntry` -> `FolderEntry` and `EntryContextMenu`

## Phase 2: Add inline rename UI to file and folder rows

In `FileTreeEntry` (for files) and `FolderEntry` (for folders), use `useTabInlineRename`:

```ts
import { useTabInlineRename } from "@/components/split-layout/use-tab-inline-rename";

// Inside FileTreeEntry / FolderEntry:
const rename = useTabInlineRename({
  currentName: entry.name,
  onRename: async (newName) => { await onRename(entry, newName); },
});
```

Replace the name `<span>` with a conditional:

```tsx
{rename.isRenaming ? (
  <input
    ref={rename.inputRef}
    type="text"
    value={rename.renameValue}
    onChange={rename.handleChange}
    onBlur={rename.handleBlur}
    onKeyDown={rename.handleKeyDown}
    autoCorrect="off"
    autoCapitalize="off"
    spellCheck={false}
    className="bg-transparent border-b border-zinc-500 outline-none px-0 py-0 text-inherit font-inherit w-full min-w-[60px]"
    onClick={(e) => e.stopPropagation()}
  />
) : (
  <span className="truncate flex-1 text-left">{entry.name}</span>
)}
```

For **files** (`FileTreeEntry`): the hook lives directly in the component since it already renders the file button.

For **folders** (`FolderEntry`): same pattern, replace `<span className="truncate">{entry.name}</span>` with the conditional input.

Also add F2 keyboard shortcut on the button's `onKeyDown` to trigger `rename.startRename()`.

## Phase 3: Add "Rename" context menu item

**`EntryContextMenu`**

- Add `onStartRename: () => void` prop
- Add a `Pencil` icon import from lucide-react
- Insert a new menu item after the "Copy name" group:

```tsx
<ContextMenuDivider />
<ContextMenuItem
  icon={Pencil}
  label="Rename"
  onClick={() => { handleClose(); onStartRename(); }}
/>
```

Wire `onStartRename` from `FileTreeEntry`/`FolderEntry` to pass `rename.startRename`.

### Escape key consideration

The panel currently closes on Escape (`file-browser-panel.tsx` line 96-98). When renaming, Escape should cancel the rename, not close the panel. The `useTabInlineRename` hook already calls `e.preventDefault()` on Escape, but the panel's keydown listener is on the panel div. Two options:

1. **Preferred**: Add a `renamingRef` that tracks whether any rename is active, and skip the panel-close in the Escape handler when renaming. Thread this via a callback like `onRenameStateChange` or check a ref.
2. **Simpler**: The input's `onKeyDown` already stops propagation implicitly via the hook's `preventDefault()`. Verify this is sufficient — if not, add `e.stopPropagation()` in the input's keyDown handler.

Approach (2) is simpler — just ensure `e.stopPropagation()` is called alongside `e.preventDefault()` in the rename input's Escape handler. This can be done by wrapping the hook's `handleKeyDown`:

```tsx
onKeyDown={(e) => {
  e.stopPropagation();
  rename.handleKeyDown(e);
}}
```
