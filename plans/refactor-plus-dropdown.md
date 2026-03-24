# Refactor "+" dropdown into dedicated actions

The "+" dropdown on worktree headers currently bundles 5 actions (new thread, new managed/TUI thread, new terminal, create PR, new workspace). We're breaking it apart so each action lives in the right place.

## Current state

- **PlusMenu** in `src/components/tree-menu/worktree-menus.tsx` — portal dropdown with 5 items
- **WorktreeItem** in `src/components/tree-menu/worktree-item.tsx` — renders PlusMenu on each worktree header
- **TabBar** in `src/components/split-layout/tab-bar.tsx` — has its own "+" that creates terminal/thread
- **ChangesView** in `src/components/changes/changes-view.tsx` — SummaryHeader with stats, no PR button
- **RepoItem** in `src/components/tree-menu/repo-item.tsx` — repo group header, no "new workspace" button
- Context menu (`WorktreeContextMenu`) duplicates all the same actions — will need parallel cleanup

## Phases

- [ ] Phase 1: Convert "+" button to "new thread +" pill
- [ ] Phase 2: Add "new workspace in [repo] +" to repo section footer
- [ ] Phase 3: Add "Create pull request" button to ChangesView header
- [ ] Phase 4: Scope bottom tab bar to show only terminals from active worktree
- [ ] Phase 5: Remove stale actions from context menu
- [ ] Phase 6: Clean up unused props threading

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Convert "+" button to "new thread +" pill

**Files:** `worktree-menus.tsx`, `worktree-item.tsx`

Replace the `PlusMenu` component with a simple pill button:
- Change the `<button>` from a 20×20 icon-only square to a pill: `"new thread +"` with rounded-full styling
- Single-click creates the preferred thread type (TUI or managed, based on `preferTerminalInterface`)
- Remove all dropdown/portal logic from PlusMenu — it becomes a direct-action button
- Keep double-click behavior (same as single-click now)
- Update `aria-label` to "New thread"
- PlusMenu props simplify: only needs `onNewThread` / `onNewClaudeSession` + `item` + `isCreatingWorktree`
- Suggested styling: `px-2 py-0.5 text-[11px] rounded-full bg-surface-800 hover:bg-surface-700 text-surface-300 hover:text-surface-100`

**PlusMenuProps cleanup:** Remove `onNewTerminal`, `onCreatePr`, `onNewWorktree`, `showMenu`/`setShowMenu`, `menuPosition`, `menuRef` — none needed for a simple button.

## Phase 2: Add "new workspace in [repo] +" to repo section footer

**Files:** `tree-menu.tsx`, `tree-item-renderer.tsx`, `repo-item.tsx` (or new `new-workspace-button.tsx`)

Add a "new workspace in [repo] +" row at the bottom of each repo's worktree list:

**Option A (preferred):** Render a synthetic footer item after the last worktree child of each repo in `tree-menu.tsx`:
- After iterating items, detect when a repo section ends (next item is a different repo or end of list)
- Insert a `<NewWorkspaceButton repoName={...} onNewWorktree={onNewWorktree} />` at that position
- Style it like a tree row at depth 1 with muted text: `"new workspace in {repoName} +"` with `GitBranch` icon
- Use the same indent as worktree items

**Option B:** Add it as a rendered element inside `RepoItem` that shows when expanded. Less clean because RepoItem currently doesn't know about its children.

The `onNewWorktree` callback is already threaded through `TreeMenu` → `TreeItemRenderer` → `WorktreeItem`. We just need to also pass it to the new button (or render it directly in `tree-menu.tsx`).

## Phase 3: Add "Create pull request" button to ChangesView header

**Files:** `changes-view.tsx`

Add a prominent "Create pull request" button to the `SummaryHeader`:
- Place it on the right side of the existing `flex items-center justify-between` header div
- Style: accent-colored pill/button, e.g. `px-3 py-1.5 text-xs font-medium rounded-md bg-accent-500 hover:bg-accent-400 text-white` with `GitPullRequest` icon
- Only show when viewing branch changes (not uncommitted-only and not single-commit view) — i.e. when `branchName` exists and `!uncommittedOnly && !commitHash`

**Wiring:** `ChangesView` needs an `onCreatePr` callback. This means:
- Add `onCreatePr?: () => void` to `ChangesContentProps` (in `src/components/content-pane/types.ts`)
- Thread it through from wherever `ChangesView` is rendered (likely `content-pane.tsx`)
- The actual PR creation logic already exists in `src/lib/pr-actions.ts` (`handleCreatePr`)
- Need to check how `content-pane.tsx` renders `ChangesView` and wire the callback from `main-window-layout.tsx`

## Phase 4: Scope bottom tab bar to show only terminals from active worktree

**Files:** `tab-bar.tsx`, `pane-group.tsx`

Currently the tab bar shows all tabs regardless of worktree. Terminal tabs should be filtered to only show terminals belonging to the active worktree. Non-terminal tabs (files, threads, etc.) remain unfiltered.

**Approach:**
- In `PaneGroup` (or `TabBar`), call `useActiveWorktreeContext()` to get the current `worktreeId`
- For each tab with `view.type === "terminal"`, look up the `TerminalSession` via `terminalSessionService.get(view.terminalId)` and check if `session.worktreeId` matches the active worktree
- Hide terminal tabs that don't match; show all non-terminal tabs as before
- The `useTerminalSessionsByWorktree(worktreeId)` hook already exists and can help here

**Edge cases:**
- When switching worktrees (e.g. clicking a thread in a different worktree), the tab bar should reactively update to show that worktree's terminals
- If the active tab is a terminal from worktree A and the user switches active worktree to B, the active tab disappears — auto-select the first visible tab in the group
- If a worktree has no terminals yet, the tab bar should still show the "+" button so the user can create one
- `useActiveWorktreeContext()` has MRU fallback when no tab provides context — this is fine

## Phase 5: Remove stale actions from context menu

**Files:** `worktree-menus.tsx`

In `WorktreeContextMenu`:
- Remove "New terminal" item (users use tab bar "+" or ⌘T)
- Remove "Create pull request" item (now in ChangesView header)
- Remove "New workspace" item (now in repo footer)
- Keep: New thread, New managed/Claude session, Open in Cursor, Pin/Unpin, Hide, New folder, Rename, Archive

## Phase 6: Clean up unused props threading

**Files:** `tree-menu.tsx`, `tree-item-renderer.tsx`, `worktree-item.tsx`, `worktree-menus.tsx`

Remove props that are no longer passed through the tree:
- `onNewTerminal` — no longer passed to PlusMenu or WorktreeContextMenu (but keep if tab bar still uses it via different path)
- `onCreatePr` — removed from worktree-level; now only in ChangesView
- Verify `onNewWorktree` is properly wired to the new repo footer button and removed from worktree items
- Clean up `WorktreeItemProps`, `TreeItemRendererProps`, `TreeMenuProps` interfaces

---

## "New terminal" placement options

The terminal creation action is being removed from the "+" dropdown and context menu. Here are placement options (not mutually exclusive):

1. **Tab bar "+" button (already exists)** — `tab-bar.tsx:103-110` already creates a terminal when the active tab is a terminal. This is the primary path.
2. **Keyboard shortcut ⌘T (already exists)** — `main-window-layout.tsx` handles this. No change needed.
3. **Command palette** — could add a "New Terminal" entry to `command-palette.tsx` if not already there. Worth checking.
4. **Worktree context menu (keep it there)** — actually, we could keep "New terminal" in the right-click context menu since it's a power-user action. The context menu is the right place for secondary actions.

**Recommendation:** Keep "New terminal" in the context menu (Phase 4 adjustment) and rely on ⌘T + tab bar "+" as primary paths. Add it to command palette if missing.
