# Diff Viewer Feedback

Addresses UI feedback for the diff viewer, sidebar, and related components.

## Phases

- [x] Fix Changes sidebar item to follow thread/plan chevron convention
- [x] Limit commits dropdown to 5 instead of 20
- [x] Replace merge-base hash with branch names in summary header
- [x] Sticky file headers while scrolling
- [x] File browser pane for changes view with auto-open
- [x] Polish commit items (icons, GitHub handle, relative date truncation)
- [x] Add collapse/expand controls to individual diff files

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix Changes sidebar item chevron behavior

**Problem:** The Changes item currently shows both the icon AND chevron at all times. It should follow the thread/plan convention: show only the icon normally, show the chevron only when selected, and expand on second click.

**Files:** `src/components/tree-menu/changes-item.tsx`

**Changes:**
- Follow the exact pattern from `thread-item.tsx` and `plan-item.tsx`:
  - When **not selected**: Show only the `GitCompare` icon (no chevron)
  - When **selected**: Replace icon with `ChevronRight` (with rotate-90 animation)
  - First click: select the item (navigate to changes view)
  - Second click (when selected): toggle expand/collapse of child items
- Remove the separate chevron button that currently always renders
- Use the same `flex-shrink-0 w-3 h-3` sizing pattern from thread/plan items

## Phase 2: Limit commits dropdown to 5

**Problem:** 20 commits is too many in the dropdown.

**Files:** `src/hooks/use-tree-data.ts`

**Changes:**
- Change `commits.slice(0, 20)` to `commits.slice(0, 5)` at line ~290

## Phase 3: Replace merge-base hash with branch names

**Problem:** The subtext `from 0965523 (merge base with main)` is not useful. Should display branch names like GitHub does, e.g. `feature-branch → main`, or just the current branch name with an arrow to the base branch.

**Files:** `src/components/changes/changes-view.tsx`, `src/components/changes/use-changes-data.ts`

**Changes:**
- Update `getSubtext()` in `changes-view.tsx` to show branch names instead of commit hash
  - Format: `current-branch → main` (or the default branch name)
  - Need the current branch name — check if `use-changes-data.ts` already has it, or fetch via `gitCommands.getCurrentBranch()` (or equivalent Tauri command)
  - For commit view, keep showing `Commit abcdef12` as-is
  - For uncommitted view, keep showing `relative to HEAD`
- If no branch info is available, show nothing rather than the hash

## Phase 4: Sticky file headers while scrolling

**Problem:** When scrolling through a large diff, you lose context of which file you're looking at. GitHub pins the current file's header to the top as you scroll.

**Files:** `src/components/changes/changes-diff-content.tsx`, `src/components/diff-viewer/file-header.tsx`, `src/components/diff-viewer/diff-file-card.tsx`

**Changes:**
- The `FileHeader` in `file-header.tsx` already has `sticky top-0 z-10` — this works in the thread diff viewer (`DiffFileCard`)
- The issue is in the changes view which uses `Virtuoso` for virtualization. Virtuoso unmounts off-screen items, which breaks native sticky positioning
- Investigate two approaches:
  1. Use Virtuoso's `stickyItemContent` or `topItemCount` features to pin the current file header
  2. Track which file card is in view (via `IntersectionObserver` or Virtuoso's `rangeChanged` callback) and render a separate pinned header overlay at the scroll container top
- The pinned header should show the same info as `FileHeader`: file icon, path, operation badge, +/- stats

## Phase 5: File browser pane for changes view

**Problem:** There's no way to see the full file list and jump to a specific file. The `FileJumpDropdown` exists but is tucked inside the diff header. GitHub shows a file tree sidebar. When opening the changes view, the file pane should auto-open.

**Files:** `src/components/changes/changes-view.tsx`, `src/components/changes/changes-diff-content.tsx`, `src/stores/changes-view-store.ts`

**Changes:**
- Add a button in the `SummaryHeader` to toggle a file list panel (reuse or extend `FileJumpDropdown` logic)
- When the changes view opens, auto-open this file pane
- The file pane should:
  - Have a clear label like "Changed files" or "Files changed" at the top
  - List all files with their icons, operation badges, and +/- stats
  - Highlight the currently-visible file
  - Click to scroll to that file in the diff
- Consider rendering as a sidebar within the changes view (left side) or as a slide-out panel
- The `useChangesViewStore` already has `selectedFilePath` and `selectFile()` — wire into that

## Phase 6: Polish commit items

**Problem:** Commit items in the tree menu lack icons, show the full name instead of GitHub handle, and the relative date gets cut off.

**Files:** `src/components/tree-menu/commit-item.tsx`, `src/hooks/use-tree-data.ts`, `src/stores/tree-menu/types.ts`

**Changes:**
- Add a commit icon (e.g. `GitCommit` from lucide) to each commit item, placed before the commit message
- Display the GitHub username/handle instead of the display name
  - Check what data is available from the git log output — `git log --format=%an` gives author name, `%ae` gives email. GitHub usernames aren't in git data natively
  - Option A: Use the email to derive the handle (strip `@users.noreply.github.com` suffix if present, or use a mapping)
  - Option B: Just show the email username portion as a short identifier
  - If the commit comes from a GitHub API response, the handle should already be available
- Fix the relative date truncation — the `max-w-[120px]` constraint on the metadata span is too small
  - Increase `max-w-[120px]` or remove the max-width and let it take the space it needs
  - Consider putting author and date on separate lines if needed, or abbreviating dates more aggressively (e.g. "2d" instead of "2 days ago")

## Phase 7: Collapse/expand controls for diff files

**Problem:** There is no way to collapse an entire file's diff. Also want a button to expand and show the full file content (not just the diff hunks) lazily.

**Files:** `src/components/thread/inline-diff-block.tsx`, `src/components/thread/inline-diff-header.tsx`, `src/components/changes/changes-diff-content.tsx`

**Changes:**
- Add a collapse/expand toggle to each file card's header (click the header or a chevron to collapse the entire diff body)
  - `InlineDiffBlock` already has `CollapsibleOutputBlock` for large diffs — extend this to allow manual collapse of any file
  - Add a chevron icon in `InlineDiffHeader` that toggles between collapsed (header-only) and expanded (showing diff lines)
- Add a "Show full file" button in the header
  - When clicked, lazily load the complete file contents from disk
  - Render the full file with syntax highlighting, with the diff changes still visually marked (additions/deletions highlighted inline)
  - This reuses the `buildAnnotatedFiles` pattern from `DiffViewer` — it already merges full file content with diff annotations
  - Show a loading state while the file is being fetched
