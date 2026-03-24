# Phase 5: File Browser Integration

**Dependencies**: Requires [04-changes-viewer.md](./04-changes-viewer.md) (needs `ChangesView` component mounted and `changedFilePaths` populated). Also requires [02-content-pane-type.md](./02-content-pane-type.md) (for the `"changes"` variant in `ContentPaneView`).

**Parallelism**: None — this is the final sequential phase.

## Overview

When the Changes view is active (including single commit views), the file browser filters down to show **only the changed files** (in their normal directory tree structure, with all folders expanded). Clicking a file scrolls to that file's diff in the content pane. The file browser otherwise looks and behaves exactly as normal — no dot indicators or visual modifications. The filtered file set updates when switching between "All Changes" and individual commits.

### How the file browser works today

The file browser is a standalone right-side panel rendered in `src/components/main-window/main-window-layout.tsx`. It uses a `useFileBrowserPanel` hook (`src/hooks/use-file-browser-panel.ts`) for open/close state, and the `FileBrowserPanel` component (`src/components/file-browser/file-browser-panel.tsx`) renders the tree. The tree is filesystem-driven: `useFileTree` (`src/components/file-browser/use-file-tree.ts`) lists directories from disk via `FilesystemClient`, lazily expanding folders on click. Each entry is a `DirEntry` (`{ name, path, isDirectory, isFile }`). File clicks call `navigationService.navigateToFile(entry.path, { repoId, worktreeId })` in `FileBrowserPanel.handleFileClick`.

The filtering approach must work **on top of** this existing filesystem-based tree. We do NOT replace `useFileTree` — instead we add a filtering layer in `FileBrowserPanel` that hides entries not in the changed set and auto-expands relevant folders.

## Phases

- [x] Create Zustand store for cross-component state
- [x] Implement file browser filtering
- [x] Wire file browser click to scroll to diff
- [x] Implement scroll-to-file in diff content

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 5a. Zustand store for cross-component state

**File:** `src/stores/changes-view-store.ts` (new file, <60 lines)

This store bridges the `ChangesView` content pane (which knows the changed file paths) with the `FileBrowserPanel` (which needs to filter and redirect clicks). It is ephemeral UI state — not persisted to disk (key decision #5).

```typescript
import { create } from "zustand";

interface ChangesViewState {
  /** Worktree ID that has an active Changes view, or null */
  activeWorktreeId: string | null;
  /** Set of changed file paths (relative to worktree root) in the active diff */
  changedFilePaths: Set<string>;
  /** Currently selected file path for scroll-to, or null */
  selectedFilePath: string | null;
}

interface ChangesViewActions {
  /** Called by ChangesView on mount / when diff data changes */
  setActive: (worktreeId: string, changedPaths: string[]) => void;
  /** Called by ChangesView on unmount */
  clearActive: () => void;
  /** Called by FileBrowserPanel when a file is clicked during Changes view */
  selectFile: (filePath: string | null) => void;
}

export const useChangesViewStore = create<ChangesViewState & ChangesViewActions>((set) => ({
  activeWorktreeId: null,
  changedFilePaths: new Set(),
  selectedFilePath: null,

  setActive: (worktreeId: string, changedPaths: string[]) => {
    set({
      activeWorktreeId: worktreeId,
      changedFilePaths: new Set(changedPaths),
      selectedFilePath: null,
    });
  },

  clearActive: () => {
    set({
      activeWorktreeId: null,
      changedFilePaths: new Set(),
      selectedFilePath: null,
    });
  },

  selectFile: (filePath: string | null) => {
    set({ selectedFilePath: filePath });
  },
}));
```

### Wiring from Phase 4

In `src/components/changes/changes-view.tsx` (built in Phase 4), the `ChangesView` component must call:

```typescript
import { useChangesViewStore } from "@/stores/changes-view-store";

// On mount and when changedFilePaths changes:
useEffect(() => {
  useChangesViewStore.getState().setActive(worktreeId, changedFilePaths);
  return () => {
    useChangesViewStore.getState().clearActive();
  };
}, [worktreeId, changedFilePaths]);
```

Phase 4's plan already notes this wiring point (section "Phase 5 wiring" in 4b). If Phase 4 was implemented with a conditional guard, replace it with the real import now.

---

## 5b. File browser filtering

**File:** `src/components/file-browser/file-browser-panel.tsx` (modify existing)

The file browser uses `useFileTree` which returns `rootChildren: DirEntry[]`, `expandedPaths: Set<string>`, `childrenCache: Map<string, DirEntry[]>`, etc. These are filesystem-sourced arrays of `DirEntry` objects with absolute paths.

### Strategy: filter `DirEntry` arrays at render time

Rather than modifying `useFileTree` (which manages filesystem watchers and caching), add a filtering utility that takes the tree data and the set of changed file paths, and returns filtered arrays. This keeps the filtering concern local to `FileBrowserPanel`.

### New utility function

**File:** `src/components/file-browser/filter-changed-files.ts` (new file, <80 lines)

```typescript
import type { DirEntry } from "@/lib/filesystem-client";

/**
 * Given a flat set of changed file paths (relative to rootPath) and a list
 * of DirEntry items, returns only entries that are either:
 * - Files that match a changed path
 * - Directories that contain (recursively) at least one changed file
 *
 * Also computes the set of directory absolute paths that should be auto-expanded.
 */
export function filterChangedEntries(
  entries: DirEntry[],
  changedAbsolutePaths: Set<string>,
  childrenCache: Map<string, DirEntry[]>,
): { filtered: DirEntry[]; expandPaths: Set<string> } {
  const filtered: DirEntry[] = [];
  const expandPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.isFile) {
      if (changedAbsolutePaths.has(entry.path)) {
        filtered.push(entry);
      }
    } else if (entry.isDirectory) {
      // Check if this directory (recursively) contains any changed files
      if (directoryContainsChangedFile(entry.path, changedAbsolutePaths, childrenCache)) {
        filtered.push(entry);
        expandPaths.add(entry.path);
      }
    }
  }

  return { filtered, expandPaths };
}

/**
 * Recursively check if a directory contains any changed files.
 * Uses childrenCache for already-loaded directories.
 * Falls back to path prefix matching for unloaded directories.
 */
function directoryContainsChangedFile(
  dirPath: string,
  changedAbsolutePaths: Set<string>,
  childrenCache: Map<string, DirEntry[]>,
): boolean {
  // Fast check: does any changed path start with this directory?
  const dirPrefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  for (const changedPath of changedAbsolutePaths) {
    if (changedPath.startsWith(dirPrefix)) {
      return true;
    }
  }
  return false;
}
```

**Path conversion**: The `changedFilePaths` in the store are **relative** to the worktree root (e.g., `src/foo.ts`). The `DirEntry.path` values are **absolute** (e.g., `/Users/zac/.anvil/worktrees/abc/src/foo.ts`). Convert relative paths to absolute by prepending `rootPath + "/"` when building the `changedAbsolutePaths` set. Do this once in `FileBrowserPanel` (not inside the filter function) using a `useMemo`:

```typescript
const changedAbsolutePaths = useMemo(() => {
  if (!isChangesViewActive) return new Set<string>();
  const abs = new Set<string>();
  const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  for (const relPath of changedFilePaths) {
    abs.add(prefix + relPath);
  }
  return abs;
}, [isChangesViewActive, changedFilePaths, rootPath]);
```

### Modify `FileBrowserPanel`

In `src/components/file-browser/file-browser-panel.tsx`, add the filtering logic:

```typescript
import { useChangesViewStore } from "@/stores/changes-view-store";
import { filterChangedEntries } from "./filter-changed-files";

// Inside FileBrowserPanel:
const activeWorktreeId = useChangesViewStore((s) => s.activeWorktreeId);
const changedFilePaths = useChangesViewStore((s) => s.changedFilePaths);
const isChangesViewActive = activeWorktreeId === worktreeId && changedFilePaths.size > 0;
```

When `isChangesViewActive`:
1. Compute `changedAbsolutePaths` from the relative paths + `rootPath` (as shown above).
2. Filter `tree.rootChildren` using `filterChangedEntries(tree.rootChildren, changedAbsolutePaths, tree.childrenCache)`.
3. Pass the filtered entries to `FileTreeNode` instead of `tree.rootChildren`.
4. For the filtered view, auto-expand all directories by ensuring any directory in the filtered set is expanded. Use a modified version of the `tree` state object that overrides `expandedPaths` with the union of `tree.expandedPaths` and the `expandPaths` set from the filter. Also, trigger `tree.toggleFolder` for unexpanded directories that need loading.

### Auto-expansion approach

When the changes view activates, directories containing changed files need to be expanded so their children are loaded from disk. The simplest approach:

```typescript
// Effect to auto-expand directories when changes view activates
useEffect(() => {
  if (!isChangesViewActive) return;
  // For each changed file path, expand all ancestor directories
  const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
  const dirsToExpand = new Set<string>();
  for (const relPath of changedFilePaths) {
    const parts = relPath.split("/");
    // Build each ancestor directory path
    for (let i = 1; i < parts.length; i++) {
      dirsToExpand.add(prefix + parts.slice(0, i).join("/"));
    }
  }
  // Toggle open any directories that aren't already expanded
  for (const dirPath of dirsToExpand) {
    if (!tree.expandedPaths.has(dirPath)) {
      tree.toggleFolder(dirPath);
    }
  }
}, [isChangesViewActive, changedFilePaths, rootPath]);
```

This triggers `useFileTree.toggleFolder` for each ancestor directory, which loads children from disk and adds watchers. When the changes view deactivates, the directories remain expanded (acceptable UX — no need to re-collapse).

### Filtering in the render

Pass filtered entries to `FileTreeNode`. When `isChangesViewActive`, also filter the children of expanded directories:

```typescript
// Create a filtered tree proxy that filters childrenCache entries too
const filteredTree = useMemo((): FileTreeState => {
  if (!isChangesViewActive) return tree;
  return {
    ...tree,
    rootChildren: filterChangedEntries(tree.rootChildren, changedAbsolutePaths, tree.childrenCache).filtered,
    childrenCache: new Map(
      Array.from(tree.childrenCache.entries()).map(([dirPath, children]) => [
        dirPath,
        filterChangedEntries(children, changedAbsolutePaths, tree.childrenCache).filtered,
      ])
    ),
  };
}, [isChangesViewActive, tree, changedAbsolutePaths]);
```

Then replace the existing `tree` usage in the render with `filteredTree`:

```tsx
<FileTreeNode
  entries={filteredTree.rootChildren}
  depth={0}
  tree={filteredTree}
  rootPath={rootPath}
  onFileClick={handleFileClick}
/>
```

The `FileTreeNode` component (`src/components/file-browser/file-tree-node.tsx`) reads `tree.expandedPaths`, `tree.childrenCache`, and `tree.toggleFolder` — by passing the filtered proxy, directory children are automatically filtered without modifying `FileTreeNode` or `useFileTree`.

---

## 5c. File browser click to scroll to diff

**File:** `src/components/file-browser/file-browser-panel.tsx` (modify existing)

Replace the `handleFileClick` callback to redirect clicks when the Changes view is active:

```typescript
const selectFile = useChangesViewStore((s) => s.selectFile);

const handleFileClick = useCallback(
  (entry: DirEntry) => {
    if (isChangesViewActive) {
      // Convert absolute path back to relative for the store
      const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
      const relativePath = entry.path.startsWith(prefix)
        ? entry.path.slice(prefix.length)
        : entry.path;
      selectFile(relativePath);
    } else {
      navigationService.navigateToFile(entry.path, { repoId, worktreeId });
    }
  },
  [isChangesViewActive, rootPath, repoId, worktreeId, selectFile]
);
```

When `isChangesViewActive` is true, clicking a file calls `selectFile(relativePath)` instead of `navigateToFile`. This sets `selectedFilePath` in the store, which Phase 5d picks up.

When `isChangesViewActive` is false (normal mode), the existing `navigateToFile` behavior is preserved.

---

## 5d. Scroll-to-file in diff content

**File:** `src/components/changes/changes-diff-content.tsx` (modify, built in Phase 4)

Phase 4 exposes a `ChangesDiffContentRef` interface via `forwardRef` + `useImperativeHandle`:

```typescript
export interface ChangesDiffContentRef {
  scrollToIndex: (index: number) => void;
}
```

The scroll-to-file wiring happens in the parent `ChangesView` component (`src/components/changes/changes-view.tsx`), which holds both the `files` array and the ref to `ChangesDiffContent`.

### Add scroll watcher in `changes-view.tsx`

```typescript
import { useChangesViewStore } from "@/stores/changes-view-store";
import type { ChangesDiffContentRef } from "./changes-diff-content";

// Inside ChangesView:
const diffContentRef = useRef<ChangesDiffContentRef>(null);
const selectedFilePath = useChangesViewStore((s) => s.selectedFilePath);

// Watch selectedFilePath and scroll to the file's index
useEffect(() => {
  if (!selectedFilePath || !diffContentRef.current) return;

  const index = files.findIndex(
    (f) => (f.newPath ?? f.oldPath) === selectedFilePath
  );
  if (index >= 0) {
    diffContentRef.current.scrollToIndex(index);
  }

  // Clear selection after scrolling (one-shot trigger)
  useChangesViewStore.getState().selectFile(null);
}, [selectedFilePath, files]);
```

And pass the ref to `ChangesDiffContent`:

```tsx
<ChangesDiffContent
  ref={diffContentRef}
  files={files}
  rawDiffsByFile={rawDiffsByFile}
  totalFileCount={totalFileCount}
  worktreePath={worktreePath}
  commitHash={commitHash}
  uncommittedOnly={uncommittedOnly}
/>
```

The `files` array is the capped `ParsedDiffFile[]` from the `useChangesData` hook (Phase 4). Each file has `newPath` and `oldPath` fields (relative paths). The `selectedFilePath` from the store is also relative, so the match is direct.

---

## File size guidelines

Per coding conventions (`docs/agents.md`):
- `src/stores/changes-view-store.ts`: under 60 lines (simple Zustand store)
- `src/components/file-browser/filter-changed-files.ts`: under 80 lines (pure utility)
- Modifications to `file-browser-panel.tsx`: the file is currently 83 lines and will grow to ~120 lines with the filtering logic. If it exceeds 250 lines, extract a `useChangesFiltering` hook.
- Use `logger` from `@/lib/logger-client` for any logging, never `console.log`.

---

## Wiring Points to Other Sub-Plans

- **Phase 2** (`02-content-pane-type.md`): The `"changes"` variant in `ContentPaneView` must exist so the content pane store can reflect that a Changes view is active. However, this phase does NOT read `ContentPaneView` directly — it reads from `changes-view-store` which is populated by Phase 4's component.
- **Phase 4** (`04-changes-viewer.md`): The `ChangesView` component calls `useChangesViewStore.getState().setActive(worktreeId, changedFilePaths)` on mount / data change, and `clearActive()` on unmount (section "Phase 5 wiring" in 4b). Phase 4 also exposes `ChangesDiffContentRef.scrollToIndex` from `ChangesDiffContent` via `forwardRef` (section 4c). Both must exist before this phase's filtering and scroll features work end-to-end.
- **Phase 3** (`03-tree-menu.md`): No direct dependency. The tree menu drives which Changes view mode is active (all changes vs. single commit), which causes Phase 4 to update `changedFilePaths`, which flows through the store to the file browser.

## Completion Criteria

- `useChangesViewStore` correctly tracks active state, changed file paths, and selected file path
- File browser filters to only changed files when Changes view is active for the same worktree
- Directory structure preserved with all ancestor folders of changed files auto-expanded
- Filtering works correctly with absolute-to-relative path conversion
- Clicking a file in the file browser scrolls to its diff card in `ChangesDiffContent`
- Normal file browser behavior (`navigateToFile`) resumes when Changes view is closed
- Filtered file set updates when switching between diff modes (all changes vs. single commit) because `changedFilePaths` in the store updates
- No visual modifications to the file browser (no dots, badges, or color changes)
- `FileTreeNode` and `useFileTree` are NOT modified — filtering is applied in `FileBrowserPanel` via a proxy `FileTreeState` object
- All new files under 250 lines, all new functions under 50 lines
