# Search Panel Polish & UX Improvements

Addresses UI/UX feedback items for the search panel: styling, icons, performance, navigation, and scope display.

## Phases

- [x] Fix search result indentation, text wrapping, font size, and font color
- [x] Use material file icons instead of generic lucide icons
- [x] Virtualize search results with @tanstack/react-virtual
- [x] Increase grep result limit and conditionally show collapse/expand buttons
- [x] Click-to-navigate: scroll to and highlight match in content pane
- [x] Add repo/worktree display with switchable worktree dropdown

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix search result indentation, text wrapping, font size, and font color

**Problem:** Result items under the chevron have too large indentation, text wraps, font color is too light, and font size could be smaller.

**Files:** `src/components/search-panel/file-result-group.tsx`, `thread-result-group.tsx`, `match-line.tsx`

**Changes:**
- **Indentation:** Reduce `ml-5` (20px) on match line containers to `ml-4` (16px) — just enough for visual nesting without wasting space
- **Text wrapping on MatchLine:** Change `whitespace-pre-wrap break-all` → `whitespace-nowrap overflow-hidden text-ellipsis` (single-line with ellipsis)
- **Text wrapping on match buttons:** Add `overflow-hidden` to the match line button containers and `truncate` / `min-w-0` as needed
- **Font color:** Change `text-surface-300` on match line text to `text-surface-200` for better readability
- **Font size:** Reduce match line text from `text-xs` (12px) to `text-[11px]` — one size smaller than headers

## Phase 2: Use material file icons instead of generic lucide icons

**Problem:** File results use generic `FileText`/`FileCheck` lucide icons instead of the material file icons already available in the codebase.

**Files:** `src/components/search-panel/file-result-group.tsx`

**Changes:**
- Import `getFileIconUrl` from `@/components/file-browser/file-icons`
- Extract filename from `group.filePath` (last segment after `/`)
- Replace `<Icon size={14} .../>` with `<img src={getFileIconUrl(filename)} alt="" className="w-3.5 h-3.5 shrink-0" />`
- Keep the blue tint for plan files via a CSS filter or just use the icon as-is (material icons already have distinct plan/markdown icons)

## Phase 3: Virtualize search results with @tanstack/react-virtual

**Problem:** Large result sets cause performance issues. The codebase already uses `@tanstack/react-virtual` in logs and archive views.

**Files:** `src/components/search-panel/search-panel.tsx` (main change), possibly `file-result-group.tsx`, `thread-result-group.tsx`

**Approach:**
- Flatten the result groups into a single list of items: `{ type: "file-header" | "file-match" | "thread-header" | "thread-match", ... }`
- Use `useVirtualizer` from `@tanstack/react-virtual` with `estimateSize` based on row type (headers ~24px, matches ~22px)
- Render only visible rows with absolute positioning (same pattern as logs-page.tsx)
- Collapse/expand still works by filtering items from the flat list
- This replaces the current `SearchResultsList` component internals

## Phase 4: Increase grep result limit and conditionally show collapse/expand buttons

**Problem:** The 500 result limit is too small. Collapse/expand toggles show even when there are no results.

**Files:**
- `src-tauri/src/git_commands.rs` — change `max_results.unwrap_or(500)` to `unwrap_or(5000)`
- `src/components/search-panel/search-controls.tsx` — conditionally render collapse/expand buttons only when results exist

**Changes:**
- Rust: Change default from 500 to 5000 in `git_grep`
- SummaryBar: Only render collapse/expand buttons when `fileCount > 0 || threadCount > 0`

## Phase 5: Click-to-navigate — scroll to and highlight match in content pane

**Problem:** Clicking a search result should scroll to that position in the already-open content pane and highlight the match. The content pane already has find-in-page infrastructure via `useContentSearch` (CSS Custom Highlight API).

**Files:**
- `src/components/main-window/main-window-layout.tsx` — update `handleSearchNavigateToFile` to pass line number
- `src/stores/navigation-service.ts` — extend `navigateToFile` to accept optional `lineNumber` and `searchQuery`
- `src/components/content-pane/` — file view component needs to scroll to line and activate find highlight

**Approach:**
- When a file search result is clicked, navigate to the file view AND pass `lineNumber` + `searchQuery` as part of the view state
- The file content pane (or a wrapper) receives these params and:
  1. Scrolls to the approximate line position
  2. Activates the find bar with the search query pre-filled
- For thread results, navigate to thread and trigger `Cmd+F` find with the query pre-filled (the thread content pane already supports this via `useContentSearch`)
- This requires extending `ContentPaneView` for the `file` type to include optional `lineNumber` and `searchQuery` fields
- For thread navigation, extend the thread view to accept an optional `initialSearchQuery` that auto-opens FindBar

**Note:** This is the most architecturally involved phase. The key insight is that `useContentSearch` already handles all the highlighting — we just need to pipe the search query and trigger it programmatically.

## Phase 6: Add repo AND worktree display with switchable dropdown

**Problem:** The search panel should display the repo AND the worktree, with the worktree being switchable via a dropdown. Currently `FileScope` shows worktree options but doesn't clearly separate repo from worktree.

**Files:** `src/components/search-panel/search-controls.tsx`

**Changes:**
- Redesign the `FileScope` component to show: `[RepoName] / [Worktree Dropdown]`
- The repo name is derived from the selected worktree option (split on `/`)
- When a repo has multiple worktrees, show a `<select>` for the worktree part
- When a repo has only one worktree, show just the repo name (no dropdown needed)
- Keep the "Files" checkbox toggle
