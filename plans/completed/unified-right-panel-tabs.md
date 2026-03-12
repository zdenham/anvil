# Unified Right Panel with Tabbed Interface

Replace the current right panel (file browser OR search, opened ad-hoc) with a unified tabbed right panel containing three tabs: **Search**, **Files**, and **Changelog**.

## Problem

1. **Panel button always disabled** — The titlebar's `PanelRight` button only re-opens the *last* right panel state. If no panel was ever opened (`lastRightPanelRef` is null), clicking does nothing. There's no default behavior.
2. **Right panel is modal** — Only one of file-browser or search can be shown at a time, with no tab-switching between them.
3. **Commit history buried** — Commits are nested as children under the "Changes" item in the left tree menu. This makes the commit log hard to browse independently.

## Design

The right panel becomes a persistent container with a VS Code-style icon tab bar at the top — icons only, no text labels. Hovering shows a tooltip with the tab name.

```
┌─────────────────────────────────┐
│  🔍  📁  📜         (icons)    │
├─────────────────────────────────┤
│                                 │
│    (active tab content)         │
│                                 │
└─────────────────────────────────┘
```

The icon bar uses lucide-react icons displayed horizontally at the top of the panel:

| Tab | Icon | Lucide Component | Tooltip |
| --- | --- | --- | --- |
| Search | Magnifying glass | `Search` | "Search" |
| Files | Folder tree | `FolderTree` | "Files" |
| Changelog | Git commit graph | `GitCommitVertical` | "Changelog" |

**Icon styling** (matches existing codebase patterns — see titlebar and tree panel header):

- Size: `14` (slightly larger than the 12px titlebar icons since these are primary navigation)

- Inactive: `text-surface-500 hover:text-surface-200 hover:bg-surface-800`

- Active: `text-accent-400` with a 2px bottom border (`border-b-2 border-accent-400`) or a subtle background highlight (`bg-surface-800`)

- Container: horizontal row, `gap-1`, `px-2 py-1.5`, `border-b border-surface-700` (same border style as `FileBrowserHeader`)

- Each icon wrapped in `<Tooltip>` (reuse existing `Tooltip` component from `@/components/ui/tooltip`)

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

## Sub-Plans (Parallel Execution)

Three independent tracks that can execute in parallel, plus one sequential integration step:

| Track | Sub-Plan | Can Run In Parallel |
| --- | --- | --- |
| A | [01-right-panel-container.md](./unified-right-panel-tabs/01-right-panel-container.md) | Yes |
| B | [02-changelog-panel.md](./unified-right-panel-tabs/02-changelog-panel.md) | Yes |
| C | [03-tree-menu-cleanup.md](./unified-right-panel-tabs/03-tree-menu-cleanup.md) | Yes |
| D | [04-integration.md](./unified-right-panel-tabs/04-integration.md) | After A+B+C |

## Phases

- [x] Track A: Right panel container + hook + layout ([01-right-panel-container.md](http://01-right-panel-container.md))

- [x] Track B: Changelog panel component ([02-changelog-panel.md](http://02-changelog-panel.md))

- [x] Track C: Tree menu cleanup ([03-tree-menu-cleanup.md](http://03-tree-menu-cleanup.md))

- [x] Track D: Integration wiring — titlebar, keyboard shortcuts, final layout swap ([04-integration.md](http://04-integration.md))

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
| Tree node builders | `src/hooks/tree-node-builders.ts` |
| Tree data hook | `src/hooks/use-tree-data.ts` |
| Changes item | `src/components/tree-menu/changes-item.tsx` |
| Commit item | `src/components/tree-menu/commit-item.tsx` |
| Files item | `src/components/tree-menu/files-item.tsx` |
| Content pane types | `src/components/content-pane/types.ts` |

## New Files

| File | Purpose |
| --- | --- |
| `src/components/right-panel/right-panel-container.tsx` | Tabbed container with tab bar + content switching |
| `src/components/right-panel/right-panel-tab-bar.tsx` | VS Code-style icon bar (Search / Files / Changelog icons with tooltips) |
| `src/components/right-panel/changelog-panel.tsx` | Commit history list for active worktree |
