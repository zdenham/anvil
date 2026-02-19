# Worktree Diff Viewer

A new content pane view that shows all file changes scoped to a worktree (across all threads), with a commit list sidebar and integration with the file browser for navigating diffs per-file.

## Context

Currently the diff viewer (`ChangesTab`) is thread-scoped: it shows file changes from a single thread's `initialCommitHash` to the current working tree state. There's no way to see the aggregate changes across an entire worktree.

The existing pieces we build on:
- **`ContentPaneView` union** (`src/components/content-pane/types.ts`) — add a new `"worktree-diff"` variant
- **`ContentPane`** (`src/components/content-pane/content-pane.tsx`) — render the new view
- **`ContentPaneHeader`** — add a header for the new view
- **Navigation service** (`src/stores/navigation-service.ts`) — add `navigateToWorktreeDiff()`
- **`GitCommitsList`** (`src/components/workspace/git-commits-list.tsx`) — reuse/adapt for the commit sidebar
- **`useGitCommits`** hook — fetches commits from `git_get_branch_commits` (Tauri command)
- **`InlineDiffBlock`** — reuse for rendering individual file diffs
- **`FileBrowserPanel`** — adapt click behavior when worktree diff is open
- **`git_diff_files`** (Rust) — existing diff generation, works with base commit
- **`parseDiff` + `buildAnnotatedFiles`** — existing diff parsing pipeline

## Phases

- [ ] Add new Tauri backend commands for worktree-level git operations
- [ ] Add `"worktree-diff"` content pane view type and navigation
- [ ] Build the worktree diff viewer component with commit sidebar
- [ ] Integrate file browser to navigate diffs when worktree diff view is open
- [ ] Wire up entry points (tree menu, keyboard shortcut)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Tauri Backend Commands

We need two new Rust commands that don't exist yet:

### 1a. `git_get_branch_commits`

The `useGitCommits` hook already calls `invoke("git_get_branch_commits", ...)` but the Rust command doesn't exist yet. Implement it:

**File:** `src-tauri/src/git_commands.rs`

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub relative_date: String,
}

#[tauri::command]
pub async fn git_get_branch_commits(
    working_directory: String,
    branch_name: String,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, String>
```

Implementation: `git log --format=...separator... <branch_name> -n <limit>` with a parseable format string. Use `%H` (hash), `%h` (short hash), `%s` (subject), `%an` (author name), `%ae` (author email), `%aI` (ISO date), `%ar` (relative date).

### 1b. `git_diff_commit` (new)

Get the diff introduced by a single commit:

```rust
#[tauri::command]
pub async fn git_diff_commit(
    working_directory: String,
    commit_hash: String,
) -> Result<String, String>
```

Implementation: `git diff <commit>^..<commit>` (or `git show --format="" <commit>` for first commit handling). Returns raw diff string that feeds into the existing `parseDiff()` pipeline.

### 1c. `git_diff_range` (new)

Get the diff between a base commit and working tree (for full worktree diff):

```rust
#[tauri::command]
pub async fn git_diff_range(
    working_directory: String,
    base_commit: String,
) -> Result<String, String>
```

Implementation: `git diff <base_commit>` — shows all changes from base to current working tree, including staged and unstaged. Also include untracked files by appending synthetic diffs (reuse `generate_new_file_diff`). To find untracked files: `git ls-files --others --exclude-standard`.

### 1d. `git_get_merge_base` (new)

Find the merge base between the worktree branch and the default branch:

```rust
#[tauri::command]
pub async fn git_get_merge_base(
    working_directory: String,
    branch_a: String,
    branch_b: String,
) -> Result<String, String>
```

Implementation: `git merge-base <branch_a> <branch_b>`.

Register all new commands in `src-tauri/src/main.rs` (or wherever the Tauri builder registers handlers).

**Frontend wrappers:** Add to `src/lib/tauri-commands.ts`:

```typescript
export const gitCommands = {
  // ... existing ...

  getBranchCommits: (workingDirectory: string, branchName: string, limit?: number) =>
    invoke<unknown>("git_get_branch_commits", { workingDirectory, branchName, limit }),

  diffCommit: (workingDirectory: string, commitHash: string) =>
    invoke<string>("git_diff_commit", { workingDirectory, commitHash }),

  diffRange: (workingDirectory: string, baseCommit: string) =>
    invoke<string>("git_diff_range", { workingDirectory, baseCommit }),

  getMergeBase: (workingDirectory: string, branchA: string, branchB: string) =>
    invoke<string>("git_get_merge_base", { workingDirectory, branchA, branchB }),
};
```

---

## Phase 2: Content Pane View Type + Navigation

### 2a. Add `"worktree-diff"` to `ContentPaneView`

**File:** `src/components/content-pane/types.ts`

```typescript
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?: string; worktreeId?: string }
  | { type: "worktree-diff"; repoId: string; worktreeId: string };
```

### 2b. Add navigation method

**File:** `src/stores/navigation-service.ts`

```typescript
async navigateToWorktreeDiff(repoId: string, worktreeId: string): Promise<void> {
  await treeMenuService.setSelectedItem(null);
  await contentPanesService.setActivePaneView({
    type: "worktree-diff",
    repoId,
    worktreeId,
  });
},
```

Also update `navigateToView()` to handle the new type.

### 2c. Add rendering in ContentPane

**File:** `src/components/content-pane/content-pane.tsx`

Add a new branch for `view.type === "worktree-diff"` that renders the new `WorktreeDiffView` component (built in Phase 3).

### 2d. Add header for worktree-diff

**File:** `src/components/content-pane/content-pane-header.tsx`

Add a `WorktreeDiffHeader` function component. Shows breadcrumb with repo/worktree context, no tabs needed (the commit sidebar serves as tab-like navigation). Include a close button.

---

## Phase 3: Worktree Diff Viewer Component

This is the main UI. Create a new component directory:

```
src/components/worktree-diff/
├── worktree-diff-view.tsx        # Main container (split: sidebar + diff area)
├── commit-sidebar.tsx            # Left column: commit list
├── commit-item.tsx               # Individual commit row (clickable)
├── worktree-diff-content.tsx     # Right column: diff display
└── use-worktree-diff.ts          # Hook: fetches merge base, commits, diffs
```

### 3a. `use-worktree-diff.ts` — Data hook

```typescript
interface UseWorktreeDiffResult {
  /** All commits on the branch since merge base */
  commits: GitCommit[];
  /** Currently selected commit hash, or null for "all changes" */
  selectedCommit: string | null;
  /** Select a specific commit to view its diff */
  selectCommit: (hash: string | null) => void;
  /** The parsed diff for current selection */
  diff: ParsedDiff | null;
  /** Annotated files for rendering */
  annotatedFiles: AnnotatedFile[];
  /** The list of changed file paths (for file browser integration) */
  changedFilePaths: string[];
  /** Loading states */
  loading: boolean;
  commitsLoading: boolean;
  /** Error */
  error: string | null;
  /** Refresh */
  refresh: () => void;
  /** Branch name */
  branchName: string | null;
  /** Merge base commit */
  mergeBase: string | null;
}
```

Logic:
1. Resolve worktree path from `repoId` + `worktreeId` via `useRepoWorktreeLookupStore`
2. Get the worktree's current branch (from worktree state)
3. Get the repo's default branch
4. Compute merge base: `git merge-base <current-branch> <default-branch>`
5. Fetch commits: `git_get_branch_commits` with the current branch
6. Default view ("all changes"): `git_diff_range` from merge base
7. When a commit is selected: `git_diff_commit` for that specific commit
8. Parse diffs through existing `parseDiff()` + `buildAnnotatedFiles()` pipeline
9. Extract `changedFilePaths` from the parsed diff

### 3b. `worktree-diff-view.tsx` — Main container

Layout: horizontal split with `ResizablePanel` or simpler flex layout.

```
┌─────────────────────────────────────────────┐
│ [All Changes]  ← toggle back to full diff   │
│                                              │
│  ┌──────────┐  ┌──────────────────────────┐  │
│  │ Commits  │  │ Diff content             │  │
│  │          │  │                          │  │
│  │ abc123   │  │ file-a.ts                │  │
│  │ def456   │  │ + added line             │  │
│  │ ghi789   │  │ - removed line           │  │
│  │          │  │                          │  │
│  │          │  │ file-b.ts                │  │
│  │          │  │ + added line             │  │
│  └──────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────┘
```

- Left: `CommitSidebar` (commit list, ~200px, resizable)
- Right: `WorktreeDiffContent` (scrollable diff cards)
- Top of sidebar: "All Changes" button (selects null commit = full worktree diff)
- Clicking a commit shows only that commit's diff

### 3c. `commit-sidebar.tsx`

Adapts the existing `GitCommitsList` pattern but:
- Renders in a sidebar (narrower, denser)
- Has an "All Changes" item at the top with summary stats
- Highlights the selected commit
- Clicking a commit calls `selectCommit(hash)`

### 3d. `commit-item.tsx`

A compact commit row: short hash, truncated message, relative date. Highlighted when selected.

### 3e. `worktree-diff-content.tsx`

Renders the diff for the current selection:
- Reuses `InlineDiffBlock` for each file in the parsed diff
- Shows a summary header (files changed, additions, deletions)
- Scrollable list of file diff cards

---

## Phase 4: File Browser Integration

When the worktree diff view is open and the file browser is also open for the same worktree, clicking a file in the file browser should navigate to that file's diff instead of opening the file.

### 4a. Expose changed file paths from worktree diff view

The `WorktreeDiffView` component exposes `changedFilePaths` to its parent. We need a lightweight way for the file browser to know:
1. That a worktree-diff view is active
2. Which files have changes

Options:
- **Option A (preferred):** Add a Zustand store or context that tracks active worktree-diff state. The file browser reads this to modify click behavior.
- **Option B:** Thread state through props from `ContentPane` → layout → `FileBrowserPanel`.

Go with Option A: create a small Zustand store `worktree-diff-store.ts`:

```typescript
interface WorktreeDiffStore {
  /** Worktree ID that has an active diff view, or null */
  activeWorktreeId: string | null;
  /** Set of changed file paths (relative) in the active diff */
  changedFilePaths: Set<string>;
  /** Currently selected file path for scrolling to, or null */
  selectedFilePath: string | null;

  setActive: (worktreeId: string, changedPaths: string[]) => void;
  clearActive: () => void;
  selectFile: (filePath: string | null) => void;
}
```

### 4b. Modify `FileBrowserPanel` click behavior

In `file-browser-panel.tsx`, the `handleFileClick` callback currently calls `navigationService.navigateToFile()`. When the worktree diff view is active for the same worktree:

```typescript
const handleFileClick = useCallback((entry: DirEntry) => {
  const diffStore = useWorktreeDiffStore.getState();

  if (diffStore.activeWorktreeId === worktreeId) {
    // Navigate to this file's diff within the worktree diff view
    diffStore.selectFile(entry.path);
    return;
  }

  // Default: navigate to file view
  navigationService.navigateToFile(entry.path, { repoId, worktreeId });
}, [repoId, worktreeId]);
```

### 4c. Visual indicators in file browser

When worktree diff is active, mark files that have changes in the file browser tree:
- Changed files get a colored dot or icon (similar to git status indicators in VS Code)
- This uses the `changedFilePaths` from the store
- Files without changes are rendered normally but clicking them does nothing (or shows "no changes")

### 4d. Scroll-to-file in diff content

When `selectedFilePath` changes in the store, the `WorktreeDiffContent` component scrolls to that file's diff card. Use `useEffect` + `scrollIntoView()` with a ref map.

---

## Phase 5: Entry Points

### 5a. Tree menu action

In `RepoWorktreeSection`, add a "View Changes" action (or icon button) alongside the existing "Files" button. This calls `navigationService.navigateToWorktreeDiff(repoId, worktreeId)`.

### 5b. File browser header action

When in the file browser for a worktree, add a "Diff" button in the `FileBrowserHeader` that switches to worktree diff view.

### 5c. Navigation from existing diff views

In the thread `ChangesTab`, add a link/button "View all worktree changes" that navigates to the worktree-level diff.

---

## Key Decisions

1. **Merge base as diff baseline**: The worktree diff shows changes from the merge base of the current branch vs the default branch. This gives a meaningful "what did this worktree change" view. If no merge base exists (new repo, detached HEAD), fall back to showing uncommitted changes only.

2. **No new Zustand entity store**: The worktree diff state is ephemeral UI state (which commit is selected, which file is scrolled to). It doesn't need disk persistence or the full entity store pattern. A simple Zustand store suffices.

3. **Reuse existing diff pipeline**: All diff parsing, annotation, and rendering goes through the existing `parseDiff()` → `buildAnnotatedFiles()` → `InlineDiffBlock` pipeline. No new rendering code needed.

4. **File browser integration is opt-in**: The file browser only changes behavior when a worktree-diff view is active for the same worktree. Otherwise it works exactly as before.

5. **Backend commands are generic**: The new git commands (`diff_commit`, `diff_range`, `get_merge_base`) are general-purpose and can be reused elsewhere.
