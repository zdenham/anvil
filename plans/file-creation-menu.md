# File Creation in File Browser

Create new files/folders from the file browser context menu and via `Cmd+Shift+N` keyboard shortcut.

## Context

**Existing infrastructure:**
- `FileBrowserPanel` (`src/components/file-browser/file-browser-panel.tsx`) — file tree with `rootPath`, `repoId`, `worktreeId`
- `FileTreeNode` / `EntryContextMenu` (`src/components/file-browser/file-tree-node.tsx`) — already has right-click context menus on files/folders with "Copy path", "Open in Cursor"
- `ContextMenu` UI primitives (`src/components/ui/context-menu.tsx`) — `useContextMenu`, `ContextMenu`, `ContextMenuItem`, `ContextMenuDivider`
- `FilesystemClient` (`src/lib/filesystem-client.ts`) — has `writeFile(path, contents)` and `mkdir(path)` methods
- `useFileTree` hook (`src/components/file-browser/use-file-tree.ts`) — auto-refreshes via file watcher when directory contents change on disk
- `Cmd+N` handler (`src/components/main-window/main-window-layout.tsx:164`) — creates new thread; checks `e.key === "n"` but does **not** guard against `e.shiftKey`, which is a bug since on macOS `e.key` is lowercase even with Shift held when metaKey is pressed

**Key insight:** The file watcher on `useFileTree` means we don't need to manually refresh the tree after creating a file — it will auto-update.

## Phases

- [x] Add "New File" and "New Folder" to the file tree context menu
- [x] Add inline rename input for entering the new file/folder name
- [x] Add `Cmd+Shift+N` keyboard shortcut for creating a file at root
- [x] Guard existing `Cmd+N` handler to exclude `Shift` key
- [x] Write tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add context menu items

In `file-tree-node.tsx`, add two new items to `EntryContextMenu`:

- **"New File…"** — visible on both files and folders
  - On a **folder**: creates inside that folder
  - On a **file**: creates in the file's parent directory
- **"New Folder…"** — same targeting logic

Add these items after the existing "Copy name" item and before the "Open in Cursor" divider. Use `FilePlus` and `FolderPlus` icons from lucide-react.

The menu items don't create the file directly — they trigger an inline creation mode (Phase 2).

## Phase 2: Inline rename input for new file/folder name

When the user clicks "New File…" or "New Folder…" from the context menu, show an inline text input at the target location in the file tree (similar to VS Code's inline rename).

**State management:** Add a `creatingEntry` state to `FileTreeNode` or `FileBrowserPanel`:
```ts
type CreatingEntry = {
  parentPath: string;   // directory where the new entry will be created
  type: "file" | "directory";
} | null;
```

**UI behavior:**
- The inline input appears at the top of the target folder's children (expand the folder if collapsed)
- Input gets auto-focus
- **Enter** → validate name, create file/folder via `FilesystemClient.writeFile(path, "")` or `FilesystemClient.mkdir(path)`, clear creating state. The file watcher handles tree refresh.
- **Escape** or blur → cancel, clear creating state
- Basic validation: non-empty, no path separators, no duplicate names in the target directory

**Prop threading:** The `creatingEntry` state and its setter need to flow from `FileBrowserPanel` (which owns the tree) down through `FileTreeNode`. When a context menu action triggers creation, it calls a callback like `onCreateEntry(parentPath, type)` which sets the state in `FileBrowserPanel`.

**After creation (file only):** Navigate to the newly created file via `navigationService.navigateToFile()` so it opens in the content pane.

## Phase 3: `Cmd+Shift+N` keyboard shortcut

In `FileBrowserPanel`, add a keydown listener for `Cmd+Shift+N`:

```ts
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "n") {
  e.preventDefault();
  e.stopPropagation();
  setCreatingEntry({ parentPath: rootPath, type: "file" });
}
```

This creates a new file at the **root** of the file browser. The file browser panel must be focused/open for this to work.

**Alternative:** If the file browser isn't open, add the handler in `main-window-layout.tsx` alongside the existing `Cmd+N` handler. When the file browser is open for the active worktree, `Cmd+Shift+N` triggers file creation at root. When it's not open, it could either open the file browser first or be a no-op. Recommend: only active when file browser is open (simplest, matches VS Code where the shortcut only works when explorer is focused).

## Phase 4: Guard existing `Cmd+N` handler

In `main-window-layout.tsx` line 164, the current check is:
```ts
if ((e.metaKey || e.ctrlKey) && e.key === "n") {
```

On macOS, `e.key` is `"n"` (lowercase) even when Shift is held with metaKey. Add a `!e.shiftKey` guard:
```ts
if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "n") {
```

This prevents `Cmd+Shift+N` from also creating a new thread.

## Phase 5: Tests

- **UI test for context menu items:** Verify "New File…" and "New Folder…" appear in the context menu for both files and folders
- **UI test for inline input:** Verify the input appears, Enter creates file, Escape cancels
- **UI test for keyboard shortcut:** Verify `Cmd+Shift+N` triggers file creation at root
- **Unit test for the Cmd+N guard:** Verify `Cmd+Shift+N` does NOT create a new thread

## Files to modify

| File | Change |
|------|--------|
| `src/components/file-browser/file-tree-node.tsx` | Add "New File…" / "New Folder…" context menu items, inline creation input |
| `src/components/file-browser/file-browser-panel.tsx` | Add `creatingEntry` state, `Cmd+Shift+N` handler, pass props down |
| `src/components/main-window/main-window-layout.tsx` | Add `!e.shiftKey` guard on Cmd+N handler |
| `src/components/file-browser/file-browser-panel.ui.test.tsx` | Add tests for new functionality |
