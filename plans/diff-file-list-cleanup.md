# Diff File List Cleanup

Remove the redundant left sidebar file list from the changes/diff view. Enhance the sticky file header's file-jump dropdown to show +/- stats per file.

## Context

The changes view currently has **two** file lists:

1. **Left sidebar** (`ChangesFileList` in `changes-file-list.tsx`) — a 256px-wide panel showing file icons, operation badges (A/M/D/R), and +/- stats. Toggled via a `PanelLeft` button in `SummaryHeader`. This is **redundant** and should be removed.

2. **Sticky file header** (`StickyFileHeader` in `changes-diff-content.tsx`) — a pinned bar at the top of the diff content showing the currently-visible file. This already shows stats for the *current* file, but there's an existing `FileJumpDropdown` component (`diff-viewer/file-jump-dropdown.tsx`) that is **fully built but unused**. It already renders +/- stats per file in its dropdown. It just needs to be wired into the sticky header.

## Phases

- [ ] Remove left sidebar file list and related plumbing
- [ ] Wire FileJumpDropdown into the sticky file header

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove left sidebar file list and related plumbing

### Files to change

**`src/components/changes/changes-view.tsx`**
- Remove the `ChangesFileList` import (line 13)
- Remove `isFilePaneOpen` and `toggleFilePane` from store selectors (lines 21-22)
- Remove `selectedFilePath` usage and the scroll-to-file `useEffect` (lines 20, 33-45)
- Remove `isFilePaneOpen`/`onToggleFilePane` props from `SummaryHeader` (lines 69-70)
- Remove the `{isFilePaneOpen && <ChangesFileList .../>}` block (lines 74-79)
- Strip `SummaryHeader` of the toggle button and its props (`isFilePaneOpen`, `onToggleFilePane`) — remove the `PanelLeft` icon import
- Remove `PanelLeft` import from lucide-react (line 9)

**`src/components/changes/changes-file-list.tsx`**
- Delete this file entirely — it's no longer used anywhere

**`src/stores/changes-view-store.ts`**
- Remove `isFilePaneOpen` state field (line 11)
- Remove `toggleFilePane` action (line 22, lines 52-54)
- Remove the `isFilePaneOpen: true` reset in `clearActive` (line 44)
- Keep `selectedFilePath` and `selectFile` — still needed for file browser click-to-scroll (from the tree menu, not the removed sidebar)

**Wait** — actually `selectedFilePath` and the scroll-to-file `useEffect` in `changes-view.tsx` are used by the tree menu's file browser panel (clicking a changed file in the file browser scrolls to it in the diff). Keep that plumbing intact; only remove the `ChangesFileList`-specific code.

Revised: in `changes-view.tsx`, keep `selectedFilePath`, `diffContentRef`, and the scroll-to `useEffect`. Only remove `isFilePaneOpen`, `toggleFilePane`, the `ChangesFileList` render block, and the toggle button from `SummaryHeader`.

## Phase 2: Wire FileJumpDropdown into the sticky file header

### Goal

Replace the static file name in the `StickyFileHeader` with the `FileJumpDropdown`, letting users click to see all files with +/- stats and jump to any file.

### Files to change

**`src/components/changes/changes-diff-content.tsx`**

The `StickyFileHeader` currently shows a static file path. Replace it with `FileJumpDropdown`:

1. Import `FileJumpDropdown` and `FileJumpItem` from `@/components/diff-viewer/file-jump-dropdown`
2. Expand `StickyFileHeaderProps` to accept:
   - `files: ParsedDiffFile[]` (full file list)
   - `currentFileIndex: number`
   - `onJumpToFile: (index: number) => void`
3. Build the `FileJumpItem[]` array from `files` (map `path`, `type`, `additions`, `deletions`)
4. Render `<FileJumpDropdown>` in place of the static path + icon span
5. Keep the operation badge and stats display for the current file (these show in the header bar itself, not in the dropdown)

In the parent `ChangesDiffContent` component:
- Pass `files`, `topIndex`, and a `scrollToIndex` callback down to `StickyFileHeader`
- The `scrollToIndex` callback should use `virtuosoRef.current?.scrollToIndex()`

### Visual result

The sticky header will look like: `[FileIcon FileName ▼] [OperationBadge] [+N -N]`

Clicking the dropdown shows all files with their +/- stats, clicking one scrolls to it.
