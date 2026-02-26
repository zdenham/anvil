# Key Decisions

1. **Commits in the tree menu, not a content pane sidebar**: Commits appear as sub-items under a "Changes" folder in the left sidebar tree menu, consistent with how threads/plans/terminals are navigated. The content pane is full-width diff only. Max 20 commits shown; a "Show more" button (opening a separate panel) may be added later.

2. **Merge base as diff baseline with GitHub-style fallback**: Diff from the merge base of the current branch vs the default branch. If the worktree IS on the default branch, diff against `origin/<defaultBranch>` (like GitHub). If no merge base exists, also fall back to `origin/<defaultBranch>`.

3. **Caps + virtualization**: 20 commits max in sidebar, 300 files max in diff view (hard cap, no "load more"). File cards are virtualized with `react-virtuoso` (variable-height items, same as `MessageList`). Individual large files (>1000 lines) use `@tanstack/react-virtual` for line-level virtualization (existing pattern in `VirtualizedFileContent`). This two-layer approach keeps the DOM light even at the 300-file cap.

4. **Flexible view input**: The `"changes"` ContentPaneView supports three modes: all changes (default), single commit, or commit range. The tree menu commit items drive the selection.

5. **No new Zustand entity store**: The state is ephemeral UI (selected commit, scroll position). A simple Zustand store for cross-component coordination (file browser integration) is sufficient.

6. **Reuse existing diff pipeline**: All diff parsing, annotation, and rendering goes through `parseDiff()` → `buildAnnotatedFiles()` → `InlineDiffBlock`. No new diff rendering code needed. The file-level `react-virtuoso` wrapper is new, but the per-file rendering delegates entirely to existing components.

7. **File browser filters to changed files**: When Changes view is active, the file browser shows only changed files (with directory structure preserved and all folders expanded). Clicking a file scrolls to its diff. No colored dots or other visual modifications — the file browser looks the same, just filtered.

8. **Backend commands are generic**: The new git commands are general-purpose and reusable.

9. **"Changes" always visible in tree menu**: The "Changes" item always appears in the sidebar, even when there are no uncommitted changes. This provides a consistent navigation target for browsing recent commits.

10. **Empty state for no changes**: When the diff is empty (branch is up-to-date with merge base), the Changes content pane shows an empty state view with a message like "No changes from `<branch>`". The tree menu still shows recent commits underneath, so users can still browse commit history.

11. **Thread-scoped and worktree-scoped diffs coexist**: The existing thread-scoped `ChangesTab` (inside thread view) remains unchanged. The new worktree-scoped "Changes" view is a separate content pane type navigated from the tree menu. They serve different purposes: thread-level shows one thread's edits, worktree-level shows all changes across the branch.

12. **Refresh on re-select/expand**: Commit list and diff data refresh when the "Changes" tree menu item is re-selected or re-expanded. No polling or interval-based refresh.

13. **Error state for git failures**: When `git_get_merge_base` or `git_get_remote_branch_commit` fails (no remote, offline, unrelated histories with no fallback), the Changes content pane shows an error screen explaining the issue (e.g., "Could not determine base branch — no remote configured").

14. **Tree menu ordering**: "Changes" appears below Files and above Terminals in the tree menu sidebar, providing a natural position as a persistent navigation target.

15. **Single commit view is standalone**: Clicking a commit in the tree menu shows just that commit's diff in the content pane. No "back to all changes" button — clicking the parent "Changes" item in the sidebar returns to the full worktree diff.

16. **Tree items are selectable**: Both the "Changes" parent and individual commit items highlight when selected, consistent with how threads/plans work. The `navigateToChanges` method sets the corresponding tree item selection.

17. **Commit items show author**: Each commit row in the tree menu shows author name, commit message (truncated), and relative date.

18. **File browser filtering applies to all modes**: The file browser filters to changed files for both "All Changes" and single commit views. The filtered set updates when switching between views.

19. **Historical file content via `git_show_file`**: For single commit diffs, context lines use `git_show_file(cwd, path, commitHash)` to get the file at the correct version rather than reading the current working tree file. For "All Changes" mode, current disk content is used (existing behavior).

20. **Diff-first, full file on expand**: Files initially render with raw diff hunks via `InlineDiffBlock`'s `diff` prop (showing changed lines + limited context from the diff itself). Collapsed context regions between hunks can be expanded, which triggers a lazy fetch of the full file content (from disk or via `git_show_file`). This means initial load is fast (just the diff string), and full file content is only fetched for files the user actually inspects in detail.

21. **No badge on Changes item**: The "Changes" tree menu item shows no count badge — clean and minimal.

22. **Stale-while-revalidate for diff data**: When navigating back to the Changes view, stale data is shown immediately while a background refresh runs. Single commit diffs are immutable and can be cached. The "All Changes" diff re-fetches since the working tree may have changed.

23. **Three distinct views**: The tree menu drives three views: (a) **"Changes" parent** = all changes from merge base to working tree (committed + uncommitted — the "PR preview" view), (b) **"Uncommitted Changes"** = only the delta from HEAD to working tree (staged + unstaged + untracked — what hasn't been committed yet), (c) **Individual commit** = just that commit's diff. Each is a distinct `git diff` invocation.

24. **Single commit shows only committed changes**: When viewing a single commit via `git_diff_commit`, only that commit's changes are shown (no working tree state).

25. **Commit store for synchronous tree builds**: Commits are fetched asynchronously into a Zustand store (`commit-store`). The tree data hook reads from this store synchronously, ensuring the tree build is never blocked by async git calls. Store updates trigger reactive tree rebuilds. The commit store is standalone (not part of `changes-view-store`) and does not persist to disk — it's refreshed from git.

26. **Binary files excluded**: Binary files are filtered out from the diff output entirely and not counted in file totals. No "binary file changed" cards.

27. **No keyboard shortcut for Changes view**: Sidebar click is sufficient for now. No Cmd+Shift+D or similar.

28. **Detached HEAD falls back to `origin/<defaultBranch>`**: When in detached HEAD state (no branch name), diff against `origin/<defaultBranch>` to mimic GitHub PR behavior. No attempt to infer branch from reflog.

29. **`--first-parent` for cleaner commit list**: `git_get_branch_commits` uses `--first-parent` to show only the branch spine, excluding commits from merged branches. This produces a cleaner, more readable commit list.

30. **Header shows merge base info**: The "All Changes" header includes subtext indicating the diff baseline (e.g., "from `abc1234` (merge base with `main`)"), so the user knows what they're comparing against.

31. **Debounced commit fetching**: The commit store's `fetchCommits` is debounced (~300ms) to prevent rapid expand/collapse from triggering multiple git log calls.

32. **Large files auto-collapsed**: Files with >1000 changed lines are fully auto-collapsed (header + stats only), with diff content loaded lazily on expand. Lock files and other large generated files are included but effectively hidden until the user explicitly expands them.
