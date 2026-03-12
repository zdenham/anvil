# Track B: Changelog Panel Component

**Parent:** [unified-right-panel-tabs.md](../unified-right-panel-tabs.md)
**Parallel:** Yes — standalone component, no dependencies on Track A or C

## Goal

Build a new `ChangelogPanel` component that shows commit history for a worktree. This is a self-contained component that will be plugged into the right panel container by Track D.

## Phases

- [x] Build `ChangelogPanel` component with commit list rendering
- [x] Wire up commit click navigation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Build `ChangelogPanel`

**New file:** `src/components/right-panel/changelog-panel.tsx`

### Props

```typescript
interface ChangelogPanelProps {
  repoId: string | null;
  worktreeId: string | null;
  workingDirectory: string | null;
}
```

### Data Fetching

Reuse existing infrastructure — two options:

**Option A (preferred):** Use `useGitCommits` hook directly. It takes `branchName` and `workingDirectory`, returns `{ commits, loading, error, refresh }`. Need to resolve branch name for the worktree.

**Option B:** Use `useCommitStore` which is keyed by worktreeId and already debounces. But requires `branchName` + `worktreePath` to call `fetchCommits`. The store is already used by the tree builder.

Go with **Option A** (`useGitCommits`) for the panel since:
- It's a self-contained hook with local state
- The panel needs more commits (50 vs the tree's 5)
- No need to coordinate with the tree menu's commit fetching

To get the branch name, read from the repo-worktree lookup store:
```typescript
const branchName = useRepoWorktreeLookupStore((s) => {
  if (!repoId || !worktreeId) return null;
  return s.repos.get(repoId)?.worktrees.get(worktreeId)?.branchName ?? null;
});
```

### Rendering

Each commit row reuses the visual style from `CommitItem`:
- `GitCommit` icon (12px, flex-shrink-0)
- Truncated commit message (flex-1)
- Author first name + relative date (right-aligned, text-surface-500)

Add a loading skeleton state and an empty state ("No commits" / "No worktree selected").

### Scrolling

Simple overflow-y-auto with the full list. No virtualization needed for 50 items.

## Phase 2: Commit Click Navigation

Clicking a commit row navigates to the commit diff in the main content pane. Use `navigationService.navigateToView()`:

```typescript
const handleCommitClick = (commit: GitCommit) => {
  if (!repoId || !worktreeId) return;
  navigationService.navigateToView({
    type: "changes",
    repoId,
    worktreeId,
    commitHash: commit.hash,
  });
};
```

This matches the existing behavior in `tree-menu.tsx` → `onCommitClick`.

## Files Changed

| File | Change |
| --- | --- |
| `src/components/right-panel/changelog-panel.tsx` | **New**: commit history panel |

## Interface Contract (for Track D)

```typescript
<ChangelogPanel
  repoId={worktreeContext.repoId}
  worktreeId={worktreeContext.worktreeId}
  workingDirectory={worktreeContext.workingDirectory}
/>
```

## Existing Infrastructure to Reuse

| What | Where |
| --- | --- |
| Commit fetching | `src/hooks/use-git-commits.ts` — `useGitCommits(branchName, workingDirectory)` |
| Commit types | `GitCommit` / `GitCommitSchema` from same file |
| Branch name lookup | `useRepoWorktreeLookupStore` → `repos.get(repoId).worktrees.get(worktreeId).branchName` |
| Commit row styling | `src/components/tree-menu/commit-item.tsx` — visual reference for row layout |
| Navigation | `navigationService.navigateToView({ type: "changes", ... })` |
| Author shortening | `shortAuthor()` from `commit-item.tsx` (inline, can copy or extract) |
