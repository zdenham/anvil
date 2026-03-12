# Right Panel Polish & Diff Overflow Fixes

Post-implementation fixes for the unified right panel tabs feature.

## Problems

1. **Files item missing from left tree menu** — The `files` tree item type was removed during the right panel refactor, but users expect a "Files" leaf node in each worktree section (like "Changes") that opens the right panel's Files tab for that worktree.

2. **Right panel icons left-aligned** — Tab bar icons in `right-panel-tab-bar.tsx` use `flex items-center gap-1` (left-aligned). They should be centered.

3. **Inconsistent sub-headers across right panel tabs** — Each tab has a different sub-header:

   - Search: `SearchHeader` with "Search" label + close button
   - Files: `FileBrowserHeader` with root dir name + refresh/close buttons
   - Changelog: No sub-header at all

   User wants a unified sub-header on all tabs showing: **tab name** + **worktree name with dropdown selector**.

4. **Right panel disappears when opening Changes** — The diff viewer's wide content (long code lines with `whitespace-pre`) pushes the flex layout beyond the viewport. Only happens when the diff view is open. Root cause: the diff content containers (`changes-diff-content.tsx`, `content-pane.tsx`) lack width constraints (`min-w-0`, `overflow-hidden`), so wide `whitespace-pre` code lines force the center panel to grow beyond its flex allotment, pushing the right panel off-screen. The `TerminalPanelLayout` outer div also needs `min-w-0` as a flex child of the horizontal row (belt-and-suspenders), but the primary fix is constraining the diff content.

5. **Diff viewer horizontal overflow** — Each diff file card in `ChangesDiffContent` has no max-width constraint. The `InlineDiffBlock` wraps content in `overflow-x-auto` internally, but its parent `<div className="py-2 px-4">` in `changes-diff-content.tsx` has no width constraint, and the scroller div above it only constrains height. Need `min-w-0` / `overflow: hidden` on the card wrapper and scroller containers.

## Phases

- [x] Fix diff viewer overflow (issues 4 & 5)

- [x] Add "Files" leaf node back to tree menu (issue 1)

- [x] Center right panel tab bar icons (issue 2)

- [x] Unified right panel sub-header with worktree dropdown (issue 3)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix diff viewer overflow

The most impactful fix — prevents the right panel from being pushed off-screen.

### Changes

`src/components/terminal-panel/terminal-panel-layout.tsx`

- Add `min-w-0` to the outer `<div className="flex flex-col flex-1 min-h-0">` → `"flex flex-col flex-1 min-h-0 min-w-0"`

`src/components/changes/changes-diff-content.tsx`

- Add `min-w-0 overflow-hidden` to the outer `<div className="h-full">` → `"h-full min-w-0 overflow-hidden"`
- This ensures the scroller container stays within its parent bounds

`src/components/content-pane/content-pane.tsx`

- The content ref wrapper `<div ref={contentRef} className="flex-1 min-h-0 relative">` should also get `min-w-0 overflow-hidden` to prevent any content pane from overflowing horizontally

## Phase 2: Add "Files" leaf node to tree menu

Re-add a "Files" leaf node per worktree (like "Changes") that opens the right panel's Files tab.

### Changes

`src/stores/tree-menu/types.ts`

- Add `"files"` back to the `TreeItemType` union

`src/hooks/tree-node-builders.ts`

- Add a `buildFilesNode(worktreeId: string)` function (mirrors `buildChangesNode`)
- Returns a TreeItemNode with `type: "files"`, `id: "files:{worktreeId}"`, `title: "Files"`, `parentId: worktreeId`

`src/hooks/use-tree-data.ts`

- In `buildUnifiedTree`, add Files nodes alongside Changes nodes per worktree:

  ```ts
  for (const wt of worktrees) {
    allNodes.push(buildChangesNode(wt.worktreeId));
    allNodes.push(buildFilesNode(wt.worktreeId));
  }
  ```

- Add `"files"` to `TYPE_SORT_PRIORITY` (e.g. priority 4, after terminal at 3)

`src/components/tree-menu/files-item.tsx` (new — recreate)

- Simple leaf component like `ChangesItem` — shows `FolderTree` icon + "Files" label
- Props: `item`, `isSelected`, `onNavigate`

`src/components/tree-menu/tree-item-renderer.tsx`

- Import `FilesItem` and add `case "files":` rendering in the switch
- The `onFilesClick` callback needs to be threaded through (similar to `onChangesClick`)

`src/components/tree-menu/tree-menu.tsx`

- Add `onFilesClick` prop (from parent) or derive internally
- When Files is clicked: call a callback that opens the right panel Files tab for that worktree

`src/components/main-window/main-window-layout.tsx`

- Thread through the files click handler that calls `rightPanel.openFileBrowser(repoId, worktreeId, worktreePath)`

## Phase 3: Center right panel tab bar icons

`src/components/right-panel/right-panel-tab-bar.tsx`

- Change the container from `flex items-center gap-1 px-2 py-1.5` to `flex items-center justify-center gap-1 px-2 py-1.5`

## Phase 4: Unified right panel sub-header with worktree dropdown

Replace the individual tab headers with a single unified sub-header component.

### Design

```
┌─────────────────────────────────┐
│     🔍  📁  📜    (tab icons)  │  ← tab bar (centered)
├─────────────────────────────────┤
│  Files  ·  main ▾              │  ← unified sub-header
├─────────────────────────────────┤
│                                 │
│    (tab content without own     │
│     header)                     │
└─────────────────────────────────┘
```

Sub-header shows:

- **Tab label** (left): "Search", "Files", or "Changelog"
- **Worktree name** (right): current worktree with a dropdown `<select>` or popover to switch worktrees
- Styled consistently: `px-3 py-2 border-b border-surface-700 min-h-[36px]`

### Changes

`src/components/right-panel/right-panel-subheader.tsx` (new)

- `RightPanelSubheader` component
- Props: `tabLabel: string`, `worktreeName: string | null`, `worktreeOptions: { id, name, repoId, path }[]`, `onWorktreeChange: (worktreeId) => void`
- Shows tab label on left, worktree name + dropdown on right
- Dropdown uses the same worktree options pattern as `SearchPanel`'s `FileScope` (uses `useRepoWorktreeLookupStore`)

`src/components/right-panel/right-panel-container.tsx`

- Add `RightPanelSubheader` between `RightPanelTabBar` and the tab content
- Derive `tabLabel` from `activeTab`
- Pass worktree info and change handler

`src/components/search-panel/search-panel.tsx`

- Remove `<SearchHeader onClose={onClose} />` — the unified sub-header replaces it

`src/components/file-browser/file-browser-panel.tsx`

- Remove `<FileBrowserHeader>` rendering — replaced by unified sub-header
- Keep the refresh logic accessible via the sub-header or a small inline button

`src/components/right-panel/changelog-panel.tsx`

- No changes needed — it already has no header

## Key Files

| File | Change |
| --- | --- |
| `src/components/terminal-panel/terminal-panel-layout.tsx` | Add `min-w-0` |
| `src/components/changes/changes-diff-content.tsx` | Add overflow constraints |
| `src/components/content-pane/content-pane.tsx` | Add overflow constraints |
| `src/stores/tree-menu/types.ts` | Re-add `"files"` type |
| `src/hooks/tree-node-builders.ts` | Add `buildFilesNode` |
| `src/hooks/use-tree-data.ts` | Add files nodes to tree |
| `src/components/tree-menu/files-item.tsx` | New leaf component |
| `src/components/tree-menu/tree-item-renderer.tsx` | Add files case |
| `src/components/tree-menu/tree-menu.tsx` | Add files click handler |
| `src/components/main-window/main-window-layout.tsx` | Thread files handler |
| `src/components/right-panel/right-panel-tab-bar.tsx` | Center icons |
| `src/components/right-panel/right-panel-subheader.tsx` | New unified sub-header |
| `src/components/right-panel/right-panel-container.tsx` | Wire sub-header |
| `src/components/search-panel/search-panel.tsx` | Remove SearchHeader |
| `src/components/file-browser/file-browser-panel.tsx` | Remove FileBrowserHeader |
