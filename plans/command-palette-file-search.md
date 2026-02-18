# Command Palette: Add File Search from MRU Worktree

## Problem

Cmd+P currently only searches **threads and plans**. It should also include **files from the MRU worktree**, similar to VS Code's Cmd+P file picker. This would allow quick navigation to any file in the active project.

## Current State

- **Command Palette** (`src/components/command-palette/command-palette.tsx`): Builds a `PreviewableItem[]` of threads + plans, filters by substring match, navigates via `navigationService`
- **MRU Worktree** (`src/hooks/use-mru-worktree.ts`): Hook that loads all worktrees sorted by `lastAccessedAt`. Returns `workingDirectory` (path) and `repoId`/`worktreeId` for the most recent
- **File listing backend**: `git_ls_files` Tauri command already exists, exposed as `gitCommands.lsFiles(repoPath)` in `src/lib/tauri-commands.ts`. Returns relative paths of all tracked files
- **File navigation**: `navigationService.navigateToFile(filePath, { repoId, worktreeId })` already exists and opens a file view in the content pane

## Design

### Approach: Extend PreviewableItem with a "file" type

Add files as a third item type alongside threads and plans. Files are searched via the existing `FileSearchService` singleton which already handles git ls-files, fuzzy subsequence matching, scoring, and result capping.

### Key decisions

1. **Reuse `FileSearchService`** — `getFileSearchService().search(rootPath, query)` already calls `gitCommands.lsFiles()` + `lsFilesUntracked()`, does subsequence matching with filename-priority scoring, and caps at 20 results. No new file loading or matching logic needed.

2. **Reuse `useMRUWorktree`** — Already provides `workingDirectory`, `repoId`, and `worktreeId` for the active project context. Used as the `rootPath` for `FileSearchService.search()`.

3. **Files appear only when query is non-empty** — When the input is empty, show threads + plans sorted by MRU (current behavior). Files only appear when the user types a query, to avoid overwhelming the list with thousands of entries.

4. **Material icons for all types** — Replace the current colored dots with material icon SVGs rendered as `<img>` tags (consistent with the file browser). Threads use `/material-icons/folder-messages.svg`, plans use `/material-icons/todo.svg`, and files use `getFileIconUrl(filename)` for per-extension icons. The text label ("Thread", "Plan", "File") remains on the right side.

5. **No preview for files** — Files show the relative path as the name. The preview panel shows "File — {relativePath}" for file items.

## Phases

- [ ] Extend `PreviewableItem` type and add file loading logic
- [ ] Update command palette to include file results with segment matching
- [ ] Wire up file navigation and add type indicator styling

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Extend PreviewableItem type

**`src/lib/preview-content.ts`**
- Add `"file"` to the `PreviewableItem.type` union
- Add optional `filePath` field for file items

### Phase 2: Integrate file search into command palette

**`src/components/command-palette/command-palette.tsx`**
- Import `getFileSearchService` from `@/lib/triggers/file-search-service`
- Import `useMRUWorktree` from `@/hooks/use-mru-worktree`
- When query is non-empty: call `getFileSearchService().search(workingDirectory, query)` to get scored file results (already capped at 20, already fuzzy-matched)
- Convert `FileSearchResult[]` → `PreviewableItem[]` with `type: "file"` and `filePath: result.path`
- Append file items after thread/plan matches in `filteredItems`
- When query is empty: show only threads + plans (current behavior, unchanged)
- Update placeholder text to `"Search threads, plans, and files..."`

### Phase 3: Navigation and styling

- In `navigateToItem`: handle `item.type === "file"` by calling `navigationService.navigateToFile(item.filePath, { repoId, worktreeId })` using context from `useMRUWorktree()`
- In `CommandPaletteItem`: replace colored dots with material icon `<img>` tags — `/material-icons/folder-messages.svg` (threads), `/material-icons/todo.svg` (plans), `getFileIconUrl(filename)` (files). Use `w-3.5 h-3.5` sizing consistent with file browser. Keep the text type label on the right.
- Preview panel: show "File — {relativePath}" for file items

## Files to modify

| File | Change |
|------|--------|
| `src/lib/preview-content.ts` | Extend `PreviewableItem` type with `"file"` and optional `filePath` |
| `src/components/command-palette/command-palette.tsx` | Integrate `FileSearchService` + `useMRUWorktree`, update navigation, add material icons |

## Existing code reused (DRY)

| Existing | Location | What it provides |
|----------|----------|-----------------|
| `FileSearchService` | `src/lib/triggers/file-search-service.ts` | `search(rootPath, query)` — git ls-files (tracked + untracked), fuzzy subsequence matching with filename priority, score-based sorting, 20-result cap |
| `useMRUWorktree` | `src/hooks/use-mru-worktree.ts` | `workingDirectory`, `repoId`, `worktreeId` for active project context |
| `getFileIconUrl` | `src/components/file-browser/file-icons.ts` | Per-extension material icon URLs |
| `navigationService.navigateToFile` | `src/stores/navigation-service.ts` | Opens file in content pane with repo/worktree context |

## Risks / Considerations

- **Async search on each keystroke**: `FileSearchService.search()` calls `git ls-files` on each invocation. For responsiveness, debounce the query or cache the file list inside the service. Git ls-files is fast (~10-50ms) so this may be acceptable for v1.
- **No worktree available**: If `useMRUWorktree` returns null (no repos configured), file search is simply disabled — threads and plans still work as before.
