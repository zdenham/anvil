# Unified Right Panel with Tabbed Interface

Replace the current right panel (file browser OR search, opened ad-hoc) with a unified tabbed right panel containing three tabs: **Search**, **Files**, and **Changelog**.

## Problem

1. **Panel button always disabled** — The titlebar's `PanelRight` button only re-opens the *last* right panel state. If no panel was ever opened (`lastRightPanelRef` is null), clicking does nothing. There's no default behavior.
2. **Right panel is modal** — Only one of file-browser or search can be shown at a time, with no tab-switching between them.
3. **Commit history buried** — Commits are nested as children under the "Changes" item in the left tree menu. This makes the commit log hard to browse independently.

## Design

The right panel becomes a persistent tabbed container with three tabs:

```
┌─────────────────────────────────┐
│ [Search] [Files] [Changelog]    │
├─────────────────────────────────┤
│                                 │
│    (active tab content)         │
│                                 │
└─────────────────────────────────┘
```

- **Search** — Existing `SearchPanel` content (Cmd+Shift+F focuses this tab)
- **Files** — Existing `FileBrowserPanel` content, showing worktree files. Derived from `useActiveWorktreeContext` (current tab's worktree, fallback to MRU)
- **Changelog** — New commit history list for the active worktree. Clicking a commit opens its diff in the main content pane (same as the existing commit-item behavior)

### Behavior

- `PanelRight` button toggles the entire right panel open/closed (never disabled)
- When opened with no prior state, defaults to the **Files** tab
- `Cmd+Shift+F` opens panel + switches to Search tab (existing behavior preserved)
- `onOpenFiles` from tree menu opens panel + switches to Files tab for that worktree
- Tab selection persists across panel close/open within a session
- Panel width still resizable + persisted via `persistKey="right-panel-width"`

### Files Tab Worktree Context

Currently the file browser requires explicit `repoId/worktreeId/rootPath` from the tree menu's "Files" button. The new design should:

- Use `useActiveWorktreeContext` to derive worktree from the active tab (thread, plan, file, changes, terminal)
- Fall back to MRU worktree when active tab has no worktree context
- Still allow the tree menu "Files" button to override the worktree (switches to Files tab + sets explicit worktree)

### Changelog Tab

Reuses the existing `useCommitStore` / `useGitCommits` infrastructure. Shows:

- Commit list for the active worktree (same context derivation as Files)
- Each row: commit icon, truncated message, author first name, relative date (reuse `CommitItem` styling)
- Click navigates to `{ type: "changes", repoId, worktreeId, commitHash }` in main content pane

### Left Tree Menu Cleanup

- Remove commit children from the "Changes" tree item (no more `commit` / `uncommitted` sub-items)
- "Changes" item becomes a flat leaf node (no chevron, no expand/collapse)
- Clicking "Changes" still navigates to the full worktree diff view (unchanged)
- Remove `files` tree item type — file browsing is now always via the right panel

## Phases

- [ ] Create `RightPanelContainer` component with tab bar (Search/Files/Changelog) and tab switching

- [ ] Refactor `useRightPanel` hook to manage tab state (activeTab, open/close, worktree override for Files)

- [ ] Wire up `PanelRight` button in `WindowTitlebar` to always toggle (never disabled)

- [ ] Integrate `useActiveWorktreeContext` into Files tab for automatic worktree resolution

- [ ] Build `ChangelogPanel` component using `useCommitStore` / `useGitCommits`

- [ ] Update `MainWindowLayout` to render the single `RightPanelContainer` instead of conditional file-browser/search

- [ ] Remove commit/uncommitted children from the tree menu (flatten "Changes" to a leaf node)

- [ ] Remove `files` tree item type from tree menu (file browsing moves exclusively to right panel)

- [ ] Update keyboard shortcuts: Cmd+Shift+F opens panel + focuses Search tab

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Key Files

| Area | Files |
| --- | --- |
| Right panel hook | `src/hooks/use-right-panel.ts` |
| Active worktree | `src/hooks/use-active-worktree-context.ts` |
| MRU worktree | `src/hooks/use-mru-worktree.ts` |
| Main layout | `src/components/main-window/main-window-layout.tsx` |
| Titlebar | `src/components/window-titlebar/window-titlebar.tsx` |
| File browser | `src/components/file-browser/file-browser-panel.tsx`, `file-browser-header.tsx` |
| Search panel | `src/components/search-panel/search-panel.tsx` |
| Commit store | `src/stores/commit-store.ts` |
| Git commits hook | `src/hooks/use-git-commits.ts` |
| Tree menu types | `src/stores/tree-menu/types.ts` |
| Tree item renderer | `src/components/tree-menu/tree-item-renderer.tsx` |
| Changes item | `src/components/tree-menu/changes-item.tsx` |
| Commit item | `src/components/tree-menu/commit-item.tsx` |
| Files item | `src/components/tree-menu/files-item.tsx` |
| Content pane types | `src/components/content-pane/types.ts` |

## New Files

| File | Purpose |
| --- | --- |
| `src/components/right-panel/right-panel-container.tsx` | Tabbed container with tab bar + content switching |
| `src/components/right-panel/right-panel-tab-bar.tsx` | Tab bar component (Search / Files / Changelog) |
| `src/components/right-panel/changelog-panel.tsx` | Commit history list for active worktree |
