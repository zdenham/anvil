# Fix Search Panel Worktree Selector

The global file search (Cmd+Shift+F) worktree selector is broken — it locks you into a single repo/worktree instead of letting you switch between **any** repo/worktree combination.

## Current Behavior (Broken)

The `FileScope` component renders a split UI: `repoName / <select of worktrees>`. This has multiple problems:

1. **Dropdown is hidden unless a repo has 2+ worktrees** — `useWorktreeOptions` only adds a `/` to the label when `repo.worktrees.size > 1`. `FileScope` splits on `/` to get `worktreeName`, and when it's empty the `hasMultiple && worktreeName` guard (line 93) hides the `<select>` entirely. So if you have 3 repos each with 1 worktree, the dropdown never renders.

2. **Even when visible, it only shows worktrees from one repo** — the dropdown renders `opt.label.split("/").slice(1)` for each option, which means all options display as worktree names stripped of their repo prefix. The `repoName` part is rendered as static text outside the `<select>`, so you can never switch repos.

3. **No MRU default** — always starts at index 0 regardless of which worktree the user was last working in.

## Expected Behavior

A **single dropdown** that lists every repo/worktree combination (e.g. `mortician / main`, `other-project / feature-branch`). Selecting any option switches the search scope to that worktree. When there's only one option total, show it as a plain label (no dropdown needed).

## Root Cause

`useWorktreeOptions()` (`search-controls.tsx:172-189`) builds a flat array of all repo/worktree combos — this part is correct. The bug is in how `FileScope` renders the selection:

- It splits `selected.label` on `/` and renders the first part as static `<span>`, the rest as a `<select>` dropdown
- The dropdown options also split-and-slice, so they only show worktree names (no repo context)
- The guard `hasMultiple && worktreeName` prevents the dropdown when labels have no `/`

## Fix

### Files to Change

- `src/components/search-panel/search-controls.tsx` — Rewrite `FileScope` + `useWorktreeOptions`
- `src/components/search-panel/search-panel.tsx` — MRU-based initial selection

### Approach

**1. Single dropdown for all repo/worktree combos** (`search-controls.tsx`)

- `useWorktreeOptions`: Always use `repo.name / wt.name` as the label format, even for single-worktree repos. This gives clear, consistent labels like `mortician / main`.
- `FileScope`: Replace the `repoName` + `/` + `<select>` split rendering with a single `<select>` that shows `option.label` for every entry. Guard: show `<select>` when `worktreeOptions.length > 1`, otherwise show a plain `<span>` with the single option's label. Remove the `/`-splitting logic entirely.

**2. Default to MRU worktree** (`search-panel.tsx`)

Instead of `useState(0)`, compute the initial index by finding the worktree option matching the current thread's worktree (from context) or, failing that, the MRU worktree from `useMRUWorktree`. Fall back to 0 if neither matches.

## Phases

- [x] Fix dropdown visibility and label logic in `FileScope` and `useWorktreeOptions`
- [x] Default selection to MRU worktree in `SearchPanel`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
