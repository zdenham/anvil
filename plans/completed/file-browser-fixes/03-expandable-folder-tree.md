# 03 — Expandable Folder Tree (Replace Breadcrumb Navigation)

**Parent**: [readme.md](./readme.md)

## Problem

The current file browser uses breadcrumb-based single-directory navigation: clicking a folder navigates into it, replacing the entire view. This means the user can only see one directory at a time and cannot view files in two sibling folders simultaneously.

The intended behavior is VS Code-style expandable folders: clicking a folder expands/collapses it inline, showing its children indented beneath it. The root directory's contents are always visible, and multiple folders can be expanded at once.

## Current Architecture

- `FileBrowserPanel` holds `currentPath` state — the single visible directory
- `FileEntryList` renders a flat list of entries for that one directory
- `FileBrowserHeader` renders breadcrumbs for navigating back up
- `handleNavigate` in the panel either `setCurrentPath` (for dirs) or `navigateToFile` (for files)
- `DirEntry` type: `{ name, path, isDirectory }`

## Design

### Tree State

Introduce a `useFileTree` hook that manages:
- **Expanded set**: `Set<string>` of expanded folder paths
- **Children cache**: `Map<string, DirEntry[]>` mapping directory paths to their sorted children
- **Loading set**: `Set<string>` of paths currently being fetched

The root directory is always loaded and its children always visible (it's implicitly "expanded").

### Toggling a Folder

1. If not expanded: add to expanded set, fetch children via `FilesystemClient.listDir()`, cache result
2. If expanded: remove from expanded set (keep cache for instant re-expand)

### Rendering

Replace the flat `FileEntryList` with a recursive `FileTreeNode` component:

```
<FileTreeNode entry={rootEntry} depth={0} />
  ├── <FileTreeEntry entry={file} depth={1} />        — file row
  ├── <FileTreeEntry entry={folder} depth={1} />       — folder row (clickable to toggle)
  │   └── <FileTreeNode entry={folder} depth={1} />    — children if expanded
  │       ├── <FileTreeEntry entry={file} depth={2} />
  │       └── ...
  └── ...
```

### Indentation

Each depth level indents by a fixed step (matching tree menu pattern). Use inline `paddingLeft` with a depth multiplier.

### Chevron Behavior

- Collapsed folder: `ChevronRight` (pointing right)
- Expanded folder: `ChevronDown` (pointing down)
- Files: no chevron, just the file icon (indented to align with folder names, not chevrons)

### File Watcher Integration

The existing file watcher watches `currentPath`. With the tree model:
- Watch the root path (non-recursive, as today)
- Optionally watch each expanded directory so changes auto-refresh
- On watcher event for a directory: re-fetch that directory's children and update the cache
- Teardown watchers when folders collapse or panel closes

### Header Changes

- Remove breadcrumb navigation entirely (no longer needed)
- Keep the header bar with: root directory name (static label), refresh button, close button
- Refresh re-fetches all currently expanded directories

## Files to Change

### New Files

- `src/components/file-browser/use-file-tree.ts` — hook managing expanded state, children cache, loading state, toggle logic, and watcher lifecycle
- `src/components/file-browser/file-tree-node.tsx` — recursive component rendering a directory's children with indentation

### Modified Files

- `src/components/file-browser/file-browser-panel.tsx` — replace `currentPath` + flat list with `useFileTree` hook + `FileTreeNode`; simplify `handleNavigate` to only handle file clicks
- `src/components/file-browser/file-browser-header.tsx` — remove breadcrumb logic, show static root label
- `src/components/file-browser/file-entry-list.tsx` — may be deleted or repurposed into single-entry row component
- `src/components/file-browser/dir-utils.ts` — `buildBreadcrumbSegments` and `truncateBreadcrumbs` become dead code; delete them, keep `sortDirEntries`

### Potentially Unused After

- `getFolderIconUrl` in `file-icons.ts` (if phase 1 already removed folder icons)
- Breadcrumb types and functions in `dir-utils.ts`

## Verification

- Expanding a folder shows its children indented beneath it
- Collapsing a folder hides children
- Multiple sibling folders can be expanded simultaneously
- Clicking a file still opens it in the content pane
- File watcher updates the correct directory's listing when files change
- Deep nesting renders correctly with increasing indentation
- Panel stays performant with many expanded directories
