# Command Palette: Add File Search from MRU Worktree

## Problem

Cmd+P currently only searches **threads and plans**. It should also include **files from the MRU worktree**, similar to VS Code's Cmd+P file picker. This would allow quick navigation to any file in the active project.

## Current State

- **Command Palette** (`src/components/command-palette/command-palette.tsx`): Builds a `PreviewableItem[]` of threads + plans, filters by substring match, navigates via `navigationService`
- **MRU Worktree** (`src/hooks/use-mru-worktree.ts`): Hook that loads all worktrees sorted by `lastAccessedAt`. Returns `workingDirectory` (path) and `repoId`/`worktreeId` for the most recent
- **File listing backend**: `git_ls_files` Tauri command already exists, exposed as `gitCommands.lsFiles(repoPath)` in `src/lib/tauri-commands.ts`. Returns relative paths of all tracked files
- **File navigation**: `navigationService.navigateToFile(filePath, { repoId, worktreeId })` already exists and opens a file view in the content pane
- **FileSearchService** (`src/lib/triggers/file-search-service.ts`): Singleton service used by the `@`-mention trigger handler. Currently calls `git ls-files` on **every** `.search()` invocation — no caching. Has good fuzzy subsequence matching and scoring logic.

## Design

### Approach: Cache file list in FileSearchService, share across consumers

Add a per-rootPath caching layer to `FileSearchService` so that `git ls-files` runs **once** per rootPath, and all subsequent searches filter the cached list in-memory. Both the existing `@`-mention trigger handler and the new command palette use the same service — one cache, two consumers.

### Key decisions

1. **Cache at the service level** — `FileSearchService` gets a `Map<rootPath, CachedFileList>` that stores the loaded file list per worktree. The first call to `search()` (or an explicit `load()`) populates the cache via `git ls-files`. All subsequent `search()` calls for the same rootPath filter in-memory — no git calls. Both the `@`-mention trigger and the command palette benefit automatically.

2. **Explicit `load(rootPath)` method** — The command palette calls `load()` on open to eagerly populate the cache, so the first keystroke filters instantly. The `@`-mention handler can continue calling `search()` directly — if the cache is cold, it loads on first call (lazy). Either way, git only runs once per rootPath.

3. **Simple invalidation** — Call `invalidate(rootPath?)` to clear one or all cached entries. The command palette can invalidate on close/reopen. No filesystem watchers needed for v1.

4. **Reuse `useMRUWorktree`** — Already provides `workingDirectory`, `repoId`, and `worktreeId` for the active project context. Used as the `rootPath` for `FileSearchService`.

5. **Files appear only when query is non-empty** — When the input is empty, show threads + plans sorted by MRU (current behavior). Files only appear when the user types a query, to avoid overwhelming the list with thousands of entries.

6. **Material icons for all types** — Replace the current colored dots with material icon SVGs rendered as `<img>` tags (consistent with the file browser). Threads use `/material-icons/folder-messages.svg`, plans use `/material-icons/todo.svg`, and files use `getFileIconUrl(filename)` for per-extension icons. The text label ("Thread", "Plan", "File") remains on the right side.

7. **No preview for files** — Files show the relative path as the name. The preview panel shows "File — {relativePath}" for file items.

## Phases

- [x] Add caching layer to `FileSearchService`
- [x] Extend `PreviewableItem` type with file support
- [x] Integrate cached file search into command palette
- [x] Wire up file navigation and add type indicator styling

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Add caching layer to FileSearchService

**`src/lib/triggers/file-search-service.ts`**

- Add a `Map<string, { files: Array<{ path: string; tracked: boolean }>; loadedAt: number }>` as an instance field on `FileSearchService`
- Add `async load(rootPath: string): Promise<void>` — calls `gitCommands.lsFiles()` + `lsFilesUntracked()`, stores result in cache map. If cache already exists for this rootPath, no-op (use `invalidate` first to force refresh)
- Add `invalidate(rootPath?: string): void` — clears one entry or the whole cache
- Refactor `search()` to check cache first: if cached, filter in-memory; if not, call `load()` then filter. This keeps the existing `@`-mention handler working without changes — it just gets caching for free.
- Existing scoring/fuzzy logic (`fuzzyScore`, `score`, `prioritizeTrackedFiles`) stays exactly as-is

**`src/lib/triggers/handlers/file-handler.ts`** — No changes needed. `FileTriggerHandler` calls `search()` which now auto-caches.

### Phase 2: Extend PreviewableItem type

**`src/lib/preview-content.ts`**
- Add `"file"` to the `PreviewableItem.type` union
- Add optional `filePath` field for file items

### Phase 3: Integrate file search into command palette

**`src/components/command-palette/command-palette.tsx`**
- Import `getFileSearchService` from `@/lib/triggers/file-search-service` and `useMRUWorktree` from `@/hooks/use-mru-worktree`
- **On mount**: call `getFileSearchService().load(workingDirectory)` to eagerly populate the cache. This is the only git call.
- **On each keystroke** (query changes): call `getFileSearchService().search(workingDirectory, query)` — this now filters the cached file list in-memory, no git calls.
- Convert `FileSearchResult[]` → `PreviewableItem[]` with `type: "file"` and `filePath: result.path`
- Append file items after thread/plan matches in `filteredItems`
- When query is empty: show only threads + plans (current behavior, unchanged)
- **On unmount/close**: optionally call `invalidate(workingDirectory)` so next open picks up new files
- Update placeholder text to `"Search threads, plans, and files..."`

### Phase 4: Navigation and styling

- In `navigateToItem`: handle `item.type === "file"` by calling `navigationService.navigateToFile(item.filePath, { repoId, worktreeId })` using context from `useMRUWorktree()`
- In `CommandPaletteItem`: replace colored dots with material icon `<img>` tags — `/material-icons/folder-messages.svg` (threads), `/material-icons/todo.svg` (plans), `getFileIconUrl(filename)` (files). Use `w-3.5 h-3.5` sizing consistent with file browser. Keep the text type label on the right.
- Preview panel: show "File — {relativePath}" for file items

## Files to modify

| File | Change |
|------|--------|
| `src/lib/triggers/file-search-service.ts` | Add per-rootPath cache, `load()`, `invalidate()`, refactor `search()` to use cache |
| `src/lib/preview-content.ts` | Extend `PreviewableItem` type with `"file"` and optional `filePath` |
| `src/components/command-palette/command-palette.tsx` | Call `load()` on mount, `search()` per keystroke, update navigation, add material icons |

## Existing code reused (DRY)

| Existing | Location | What it provides |
|----------|----------|-----------------|
| `FileSearchService` | `src/lib/triggers/file-search-service.ts` | Singleton with fuzzy scoring, now also caching — shared by `@`-mention trigger and command palette |
| `useMRUWorktree` | `src/hooks/use-mru-worktree.ts` | `workingDirectory`, `repoId`, `worktreeId` for active project context |
| `getFileIconUrl` | `src/components/file-browser/file-icons.ts` | Per-extension material icon URLs |
| `navigationService.navigateToFile` | `src/stores/navigation-service.ts` | Opens file in content pane with repo/worktree context |

## Risks / Considerations

- **Initial load latency**: The `git ls-files` call on first `load()` takes ~10-50ms. This is fast enough to be imperceptible, but if the worktree is very large, consider showing a loading state. All subsequent searches are synchronous in-memory and should be instant.
- **Stale cache**: The cache doesn't auto-refresh when files change on disk. For v1, invalidating on palette close is sufficient — files created mid-session will appear on next open. Filesystem watchers can be added later if needed.
- **No worktree available**: If `useMRUWorktree` returns null (no repos configured), file search is simply disabled — threads and plans still work as before.
