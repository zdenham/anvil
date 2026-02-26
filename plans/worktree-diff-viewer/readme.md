# Worktree Diff Viewer ("Changes" Tab)

A new content pane view that shows file changes scoped to a worktree (across all threads), with commit navigation integrated into the left sidebar tree menu and file browser integration for navigating diffs per-file. Called "Changes" in the sidebar.

## Context

Currently the diff viewer (`ChangesTab`) is thread-scoped: it shows file changes from a single thread's `initialCommitHash` to the current working tree state. There's no way to see the aggregate changes across an entire worktree.

The view must also support being opened with a specific commit or commit range, not just the default "all changes since merge base" mode.

The existing pieces we build on:
- **`ContentPaneView` union** (`src/components/content-pane/types.ts`) — add a new `"changes"` variant
- **`ContentPane`** (`src/components/content-pane/content-pane.tsx`) — render the new view
- **`ContentPaneHeader`** — add a header for the new view
- **Navigation service** (`src/stores/navigation-service.ts`) — add `navigateToChanges()`
- **`useGitCommits`** hook (`src/hooks/use-git-commits.ts`) — fetches commits via `git_get_branch_commits`
- **`InlineDiffBlock`** (`src/components/thread/inline-diff-block.tsx`) — reuse for rendering individual file diffs
- **`git_diff_files`** (Rust, `src-tauri/src/git_commands.rs`) — existing diff generation
- **`parseDiff`** (`src/lib/diff-parser.ts`) + **`buildAnnotatedFiles`** (`src/lib/annotated-file-builder.ts`) — existing diff parsing pipeline
- **`useRepoWorktreeLookupStore`** (`src/stores/repo-worktree-lookup-store.ts`) — resolves worktree paths from IDs
- **`WorktreeState`** (`core/types/repositories.ts`) — has `currentBranch` field
- **`RepositorySettings`** (`core/types/repositories.ts`) — has `defaultBranch` and `sourcePath`

## Phases

- [x] **Group 1 (parallel)**: Tauri backend + Content pane view type
- [x] **Group 2 (parallel)**: Tree menu integration + Changes viewer component
- [x] File browser integration

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Execution Graph

```
Group 1 (parallel — no dependencies):
  ├── 01-tauri-backend.md      (Rust git commands)
  └── 02-content-pane-type.md  (TS types + navigation stubs)

Group 2 (parallel — both depend on Group 1):
  ├── 03-tree-menu.md          (sidebar "Changes" item + commit sub-items)
  └── 04-changes-viewer.md     (diff content pane component)

Sequential (depends on Group 2):
  └── 05-file-browser.md       (file browser filtering + scroll-to-file)
```

## Sub-Plans

1. [Tauri Backend Commands](./01-tauri-backend.md) — New Rust commands for worktree-level git operations
2. [Content Pane View Type + Navigation](./02-content-pane-type.md) — Add `"changes"` to `ContentPaneView` union, navigation methods, rendering stub
3. [Tree Menu Integration](./03-tree-menu.md) — "Changes" item with commit sub-items in sidebar
4. [Changes Viewer Component](./04-changes-viewer.md) — Diff content pane (data hook + view + virtualized file cards)
5. [File Browser Integration](./05-file-browser.md) — Filter file browser to changed files, scroll-to-file on click

## Key Decisions

See [key-decisions.md](./key-decisions.md) for all architectural decisions.
