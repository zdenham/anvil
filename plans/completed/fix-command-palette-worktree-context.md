# Fix Command Palette Worktree Context

## Problem

The command palette (`Cmd+P`) uses `useMRUWorktree()` to determine which worktree's files to search. This hook sorts worktrees globally by `lastAccessedAt` — but `lastAccessedAt` is **only updated when a thread is created** (via `worktreeService.touch()` in `thread-creation-service.ts:127`). It is never updated when:

- The user clicks on a thread in a different worktree
- The user switches tabs to a thread/plan/terminal in a different worktree
- The user opens a file browser for a different worktree
- The user interacts with the changes view of a different worktree

This means the command palette will keep searching files from whichever worktree most recently had a thread created in it, not whichever worktree the user is currently working in.

### Root Cause Chain

1. `CommandPalette` **(line 29)**: `const { workingDirectory, repoId, worktreeId } = useMRUWorktree()`
2. `useMRUWorktree` **(line 98)**: sorts by `b.worktree.lastAccessedAt - a.worktree.lastAccessedAt`
3. `lastAccessedAt` **only updated via**: `worktreeService.touch()` → `invoke("worktree_touch")` (Rust backend)
4. **Only call site**: `thread-creation-service.ts:127` — fire-and-forget during thread creation

### Secondary Issue

The command palette also has no visible indicator of which worktree it's searching in. Unlike the Spotlight (which has a `WorktreeOverlay` showing the selected worktree and arrow-key cycling), the command palette gives no feedback about file search context.

## Proposed Fix

### Part 1: Derive worktree from active tab context (not MRU)

Replace the `useMRUWorktree()` call in the command palette with a new approach that derives the worktree from the **currently active tab**:

1. **Read the active tab's view** from `usePaneLayoutStore` (active group → active tab → view)

2. **Derive worktree context from the view**:

   - `thread` view → look up thread's `repoId`/`worktreeId` from thread store
   - `plan` view → look up plan's `repoId`/`worktreeId` from plan store
   - `file` view → already has `repoId`/`worktreeId` on the view object
   - `changes` view → already has `repoId`/`worktreeId` on the view object
   - `terminal` view → look up terminal's `worktreeId` from terminal session store
   - `empty`/`settings`/`logs`/`archive`/`pull-request` → fall back to MRU worktree

3. **Create a** `useActiveWorktreeContext()` **hook** that encapsulates this logic:

   - Returns `{ workingDirectory, repoId, worktreeId }` (same shape as MRU hook's output)
   - Uses `useRepoWorktreeLookupStore` to resolve worktree path from `(repoId, worktreeId)`
   - Falls back to `useMRUWorktree()` when the active tab has no worktree context

4. **Update** `CommandPalette` to use `useActiveWorktreeContext()` instead of `useMRUWorktree()`

This also fixes `EmptyPaneContent`, which uses `useMRUWorktree()` for thread creation — though there it makes more sense since there's no active context.

### Part 2: Also touch worktree on navigation (fix MRU staleness)

The MRU worktree data should reflect actual usage, not just thread creation. Add `worktreeService.touch()` calls when the user navigates to content in a different worktree:

- In `paneLayoutService.setActiveTab()` or the `_applySetActiveGroup` flow — when the active tab has a worktree context, fire-and-forget touch the worktree
- This makes the MRU fallback (for empty/settings tabs) actually reflect the most recently *interacted-with* worktree

Implementation: add a listener in `pane-layout/listeners.ts` that subscribes to active tab changes and calls `worktreeService.touch()` when the worktree changes. This needs the thread/plan stores to resolve worktreeId → repoName/worktreePath, so it should be async and fire-and-forget.

### Part 3: Show worktree context indicator in command palette

Add a small worktree indicator to the command palette UI so the user knows which worktree's files are being searched:

- Below the search input (or inline on the right), show the current worktree name (e.g., `main`, `feature-auth`)
- Use `useRepoWorktreeLookupStore.getWorktreeName()` to resolve the display name
- Style it as a subtle `text-surface-500 text-xs` label

### Part 4 (optional): Worktree switcher in bottom gutter

The user mentioned wanting a more explicit worktree switcher in the "bottom preview component on the right side." The bottom of the command palette currently shows a preview panel. Two options:

**Option A — Command palette footer worktree selector**: Add a clickable worktree badge in the command palette's preview footer area. Clicking cycles through available worktrees (similar to Spotlight's arrow-key cycling). This keeps the switcher contextual to when you're searching.

**Option B — Bottom gutter worktree indicator**: Add a worktree name to the `BottomGutter` component (the thin bar at the very bottom with StatusLegend + QuickActionsPanel). This would show the active worktree at all times, and clicking could open a dropdown to switch. This is more discoverable but broader in scope.

**Recommendation**: Option A for the command palette specifically, since the bug is about command palette file search context. Option B could be a separate follow-up for general worktree awareness.

## Phases

- [x] Create `useActiveWorktreeContext` hook that derives worktree from active tab

- [x] Update `CommandPalette` to use the new hook instead of `useMRUWorktree`

- [x] Add worktree touch on tab navigation (fix MRU staleness)

- [x] Add worktree context indicator to command palette UI

- [x] Add worktree switcher to command palette preview footer (Option A)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Modify

| File | Change |
| --- | --- |
| `src/hooks/use-active-worktree-context.ts` | **NEW** — hook deriving worktree from active pane tab |
| `src/components/command-palette/command-palette.tsx` | Replace `useMRUWorktree()` with `useActiveWorktreeContext()`, add worktree indicator |
| `src/stores/pane-layout/listeners.ts` | Add worktree touch on active tab change |
| `src/entities/worktrees/service.ts` | No changes needed (touch API already exists) |

## Key Architectural Decisions

- **Active tab → worktree** is the correct mental model for the command palette. When I'm looking at a thread in worktree X, `Cmd+P` should search files in worktree X.
- **MRU remains as fallback** for tabs with no worktree context (settings, logs, empty, archive).
- **Touch on navigation** is fire-and-forget to avoid blocking tab switches.
- The new hook should be **synchronous-first** — it reads from Zustand stores that are already hydrated, only falling back to async MRU when needed.