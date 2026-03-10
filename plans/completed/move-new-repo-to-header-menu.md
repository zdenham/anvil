# Move "New repository" to header three-dot menu

Move the "New repository" action from the per-section `+` dropdown (and context menu) in `RepoWorktreeSection` to the `MenuDropdown` in the `TreePanelHeader`.

## Phases

- [x] Wire `onNewRepo` through `TreePanelHeader` → `MenuDropdown`

- [x] Remove `onNewRepo` from `RepoWorktreeSection` and `TreeMenu`

- [x] Clean up unused code

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Wire `onNewRepo` through `TreePanelHeader` → `MenuDropdown`

`menu-dropdown.tsx` — Add `onNewRepo` prop and a new menu item:

- Add `onNewRepo?: () => void` to `MenuDropdownProps`
- Add a `{ id: "new-repo", label: "New repository", icon: <FolderGit2 size={11} />, onClick: onNewRepo }` entry to `menuItems` (insert before "Settings")
- Import `FolderGit2` from `lucide-react`

`tree-panel-header.tsx` — Thread the prop:

- Add `onNewRepo?: () => void` to `TreePanelHeaderProps`
- Pass `onNewRepo` through to `<MenuDropdown>`

`main-window-layout.tsx` (\~line 756) — Pass `handleNewRepo` to `TreePanelHeader`:

- Add `onNewRepo={handleNewRepo}` to the `<TreePanelHeader>` JSX

## Phase 2: Remove `onNewRepo` from `RepoWorktreeSection` and `TreeMenu`

`repo-worktree-section.tsx`:

- Remove `onNewRepo` from the props interface (line 36)
- Remove destructured `onNewRepo` prop (line 70)
- Remove `handleNewRepo` handler (lines 192-195)
- Remove `handleContextNewRepo` handler (lines 227-230)
- Remove the "New repository" button from the `+` popup menu (lines 517-529)
- Remove the "New repository" button from the context menu (lines 639-651)
- Update the `+` button visibility condition (line 438) — remove `onNewRepo` from the guard
- Update the context menu divider condition (line 653) — remove `onNewRepo` from the guard

`tree-menu.tsx`:

- Remove `onNewRepo` from `TreeMenuProps` interface (line 26)
- Remove from destructured props (line 50)
- Remove `onNewRepo={onNewRepo}` from `<RepoWorktreeSection>` JSX (line 248)

`main-window-layout.tsx`:

- Remove `onNewRepo={handleNewRepo}` from `<TreeMenu>` JSX (line 768)

## Phase 3: Clean up unused code

- Verify no remaining references to `onNewRepo` in `repo-worktree-section.tsx` or `tree-menu.tsx`
- Verify `FolderGit2` import can be removed from `repo-worktree-section.tsx` if no longer used there (it's used in the removed menu items; check if anything else uses it)