# Fix File Creation Triggers

The context menu items ("New File…" / "New Folder…") and `Cmd+Shift+N` keyboard shortcut from the `file-creation-menu.md` plan are not working. All five phases were marked `[x]` but the implementation is incomplete — only the `InlineCreationInput` component was created; nothing else was wired up.

## Diagnosis

### 1. Context menu items never added

`EntryContextMenu` in `file-tree-node.tsx:50-103` only contains the original items (Copy relative path, Copy absolute path, Copy name, Open in Cursor). No "New File…" or "New Folder…" items exist. `FilePlus`/`FolderPlus` icons are not imported.

### 2. No `creatingEntry` state in `FileBrowserPanel`

`file-browser-panel.tsx` has no `creatingEntry` state, no setter, and passes no creation-related props to `FileTreeNode`. The plan called for:
```ts
type CreatingEntry = {
  parentPath: string;
  type: "file" | "directory";
} | null;
```
This was never added.

### 3. `FileTreeNode` doesn't accept creation props

`FileTreeNodeProps` in `file-tree-node.tsx:15-21` has no `creatingEntry`, `onCreateEntry`, or similar props. The component has no way to trigger or display inline creation.

### 4. `InlineCreationInput` is orphaned

`src/components/file-browser/inline-creation-input.tsx` exists and looks correct, but it is never imported or rendered by any other component. It's dead code.

### 5. No `Cmd+Shift+N` handler anywhere

`FileBrowserPanel` only has an `Escape` keydown handler (lines 81-91). `MainWindowLayout` has no `Cmd+Shift+N` handler either.

### 6. `Cmd+N` guard missing — `Cmd+Shift+N` creates a new thread

`main-window-layout.tsx:164`:
```ts
if ((e.metaKey || e.ctrlKey) && e.key === "n") {
```
No `!e.shiftKey` guard. On macOS, `e.key` is `"n"` (lowercase) even with Shift held when metaKey is pressed, so `Cmd+Shift+N` falls through to the `Cmd+N` handler and creates a new thread instead.

## Phases

- [x] Add `creatingEntry` state to `FileBrowserPanel`, pass down as props
- [x] Add "New File…" and "New Folder…" context menu items to `EntryContextMenu` in `file-tree-node.tsx`
- [x] Wire `InlineCreationInput` into `FileTreeNode` / `FolderEntry` to render when `creatingEntry` matches
- [x] Add `Cmd+Shift+N` handler (in `FileBrowserPanel` or `MainWindowLayout`)
- [x] Add `!e.shiftKey` guard to `Cmd+N` handler in `main-window-layout.tsx:164`
- [ ] Write/update tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `creatingEntry` state to `FileBrowserPanel`

In `file-browser-panel.tsx`:

1. Add state:
   ```ts
   const [creatingEntry, setCreatingEntry] = useState<{
     parentPath: string;
     type: "file" | "directory";
   } | null>(null);
   ```
2. Create a callback `handleCreateEntry(parentPath: string, type: "file" | "directory")` that sets this state
3. Create a callback `handleConfirmCreate(name: string)` that:
   - Calls `FilesystemClient.writeFile(path, "")` for files or `FilesystemClient.mkdir(path)` for directories
   - Clears `creatingEntry` state
   - For files: navigates to the new file via `navigationService.navigateToFile()`
4. Create a callback `handleCancelCreate()` that clears `creatingEntry` state
5. Pass `creatingEntry`, `onCreateEntry`, `onConfirmCreate`, `onCancelCreate` down to `FileTreeNode`

## Phase 2: Add context menu items

In `file-tree-node.tsx`:

1. Import `FilePlus`, `FolderPlus` from lucide-react
2. Add `onCreateEntry?: (parentPath: string, type: "file" | "directory") => void` to `EntryContextMenu` props
3. Add two new `ContextMenuItem`s after "Copy name" and before the divider:
   - "New File…" with `FilePlus` icon — onClick calls `onCreateEntry(targetDir, "file")` where `targetDir` is `entry.path` for directories, or the parent dir for files
   - "New Folder…" with `FolderPlus` icon — same logic with `"directory"`
4. Thread `onCreateEntry` through `FileTreeNodeProps` → `FileTreeEntry` → `FolderEntry` → `EntryContextMenu`

## Phase 3: Wire `InlineCreationInput` rendering

In `file-tree-node.tsx`:

1. Import `InlineCreationInput` from `./inline-creation-input`
2. Add `creatingEntry`, `onConfirmCreate`, `onCancelCreate` to `FileTreeNodeProps`
3. In `FileTreeNode`, before the children list, check if `creatingEntry?.parentPath` matches the current directory — if so, render `InlineCreationInput` at the top of the children
4. In `FolderEntry`, when `creatingEntry?.parentPath === entry.path`:
   - Auto-expand the folder if collapsed
   - Render `InlineCreationInput` as the first child inside the folder

## Phase 4: Add `Cmd+Shift+N` handler

In `file-browser-panel.tsx`, extend the existing keydown effect:

```ts
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "n") {
  e.preventDefault();
  e.stopPropagation();
  setCreatingEntry({ parentPath: rootPath, type: "file" });
}
```

This triggers file creation at the root of the file browser. Only active when the panel is mounted (i.e., file browser is open).

## Phase 5: Guard `Cmd+N` handler

In `main-window-layout.tsx:164`, change:
```ts
if ((e.metaKey || e.ctrlKey) && e.key === "n") {
```
to:
```ts
if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "n") {
```

## Phase 6: Tests

- Context menu: verify "New File…" and "New Folder…" appear for both files and folders
- Inline input: verify it renders, Enter creates file, Escape cancels
- Keyboard shortcut: verify `Cmd+Shift+N` triggers creation at root
- Guard: verify `Cmd+Shift+N` does NOT create a new thread

## Files to modify

| File | Change |
|------|--------|
| `src/components/file-browser/file-browser-panel.tsx` | Add `creatingEntry` state, creation callbacks, `Cmd+Shift+N` handler, pass props to `FileTreeNode` |
| `src/components/file-browser/file-tree-node.tsx` | Add context menu items, accept + thread creation props, render `InlineCreationInput` |
| `src/components/main-window/main-window-layout.tsx:164` | Add `!e.shiftKey` guard |
| Tests TBD | Add/update UI tests |
