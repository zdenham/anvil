# Phase 1: Tauri Backend Commands

**Parallelism**: Can run in parallel with [02-content-pane-type.md](./02-content-pane-type.md). No frontend dependencies.

## Overview

Add new Rust commands to `src-tauri/src/git_commands.rs` for worktree-level git operations. These are generic, reusable commands — not specific to the Changes view.

**Existing code context**: All existing git commands in `git_commands.rs` follow this pattern:
- Use `shell::command("git")` (from `crate::shell`) to run git CLI commands
- Use `repo_path` or `worktree_path` as the directory parameter name (snake_case in Rust, camelCase in TS via Tauri's automatic conversion)
- Return `Result<T, String>` where errors are formatted with `String::from_utf8_lossy(&output.stderr)`
- Use `tracing::{info, warn, error, debug}` for logging (never `println!`)

## Phases

- [x] Implement Rust git commands
- [x] Register commands in Tauri invoke handler
- [x] Add frontend wrappers in `tauri-commands.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 1a. `git_get_branch_commits`

The `useGitCommits` hook (`src/hooks/use-git-commits.ts`) already calls `invoke("git_get_branch_commits", { branchName, workingDirectory, limit: 50 })` but the Rust command doesn't exist yet. The parameter names must match what the hook sends: `working_directory` and `branch_name` (Tauri auto-converts `workingDirectory` -> `working_directory`, `branchName` -> `branch_name`).

The hook validates the response with a Zod schema (`GitCommitSchema`) that expects camelCase fields: `hash`, `shortHash`, `message`, `author`, `authorEmail`, `date`, `relativeDate`. The Rust struct uses `#[serde(rename_all = "camelCase")]` to produce this.

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

Implementation: Run `git log --first-parent --format=<separator-delimited> <branch_name> -n <limit>` with format placeholders `%H`, `%h`, `%s`, `%an`, `%ae`, `%aI`, `%ar`. Use a separator that won't appear in commit messages (e.g., `%x00` null byte or a unique delimiter like `---FIELD---`). The `--first-parent` flag shows only the "spine" of the branch (excludes commits from merged branches), producing a cleaner list (key decision #29). Default limit to 50 if not provided.

## 1b. `git_diff_commit` (new)

Get the diff introduced by a single commit:

```rust
#[tauri::command]
pub async fn git_diff_commit(
    working_directory: String,
    commit_hash: String,
) -> Result<String, String>
```

Implementation: `git diff --no-color --no-ext-diff <commit>^..<commit>`. For root commits (no parent), fall back to `git diff --no-color --no-ext-diff --root <commit>` or `git show --format="" --no-color --no-ext-diff <commit>`. Returns raw unified diff string for `parseDiff()`. Binary files should be excluded via `--diff-filter=d` or by post-processing (key decision #26).

## 1c. `git_diff_range` (new)

Get the diff between a base commit and the current working tree (for full worktree diff):

```rust
#[tauri::command]
pub async fn git_diff_range(
    working_directory: String,
    base_commit: String,
) -> Result<String, String>
```

Implementation: `git diff --no-color --no-ext-diff <base_commit>` — shows all changes from base to current working tree (staged + unstaged). Also appends synthetic diffs for untracked files by reusing the existing `generate_new_file_diff()` function (private fn in `git_commands.rs`) combined with `git ls-files --others --exclude-standard` to list untracked files. Binary files should be excluded (key decision #26) — use `-G.` or check `--numstat` for binary markers and filter them out.

## 1d. `git_diff_uncommitted` (new)

Get the diff of uncommitted changes only (HEAD to working tree):

```rust
#[tauri::command]
pub async fn git_diff_uncommitted(
    working_directory: String,
) -> Result<String, String>
```

Implementation: `git diff --no-color --no-ext-diff HEAD` — shows staged + unstaged changes relative to HEAD. Also appends synthetic diffs for untracked files (same pattern as `git_diff_range`). Binary files should be excluded (key decision #26).

## 1e. `git_get_merge_base` (new)

Find the merge base between two branches:

```rust
#[tauri::command]
pub async fn git_get_merge_base(
    working_directory: String,
    branch_a: String,
    branch_b: String,
) -> Result<String, String>
```

Implementation: `git merge-base <branch_a> <branch_b>`. Returns the commit hash (trimmed). This can fail if branches have unrelated histories — the error should propagate so Phase 4 can show an error state (key decision #13).

## 1f. `git_get_remote_branch_commit` (new)

Get the commit hash that a remote branch points to (for fallback when on main):

```rust
#[tauri::command]
pub async fn git_get_remote_branch_commit(
    working_directory: String,
    remote: String,
    branch: String,
) -> Result<String, String>
```

Implementation: `git rev-parse <remote>/<branch>` (e.g., `origin/main`). This is needed when the worktree IS on the default branch — we diff against `origin/main` the way GitHub would (key decision #2). Returns the commit hash (trimmed). Fails if the remote branch doesn't exist (e.g., no remote configured, offline).

## 1g. `git_show_file` (new)

Get a file's contents at a specific git ref. This command already has a caller in `src/hooks/use-file-contents.ts` (line 104) which invokes `git_show_file` with `{ cwd, path, ref }`, but the Rust implementation does not exist yet. The parameter names must match what the hook sends: `cwd`, `path`, `ref_name` (note: `ref` is a reserved keyword in Rust, so use `ref_name` on the Rust side, but the Tauri serde rename will handle the mapping — actually, since the JS sends `ref`, the Rust parameter must be named `r#ref` or use `#[serde(rename = "ref")]`).

```rust
#[tauri::command]
pub async fn git_show_file(
    cwd: String,
    path: String,
    #[serde(rename = "ref")]
    git_ref: String,
) -> Result<String, String>
```

Implementation: `git show <ref>:<path>`. Returns the file content as a string. This is used by the existing `useFileContents` hook for deleted files (reading from HEAD) and will be used in Phase 4 for single commit diffs where context lines need the file at the correct version (key decision #19).

**Note on `#[serde(rename)]`**: Since `ref` is a Rust reserved keyword, the parameter must use a different name in Rust (e.g., `git_ref`) but be deserialized from the `ref` key sent by the frontend. Use `#[serde(rename = "ref")]` on the parameter. Alternatively, wrap in a struct with the rename. Test that the invoke works with the frontend's `{ cwd, path, ref: "HEAD" }`.

## Registration

Register all new commands in `src-tauri/src/lib.rs` in the `invoke_handler` block. Add them under the existing `// Git commands` section, after line 893 (`git_commands::git_diff_files`):

```rust
git_commands::git_get_branch_commits,
git_commands::git_diff_commit,
git_commands::git_diff_range,
git_commands::git_diff_uncommitted,
git_commands::git_get_merge_base,
git_commands::git_get_remote_branch_commit,
git_commands::git_show_file,
```

## Frontend Wrappers

Add to `src/lib/tauri-commands.ts` inside the existing `gitCommands` object (after the `diffFiles` entry, before the closing `}`):

```typescript
/**
 * Get branch commits for the commit list.
 * Note: useGitCommits hook calls invoke() directly with Zod validation,
 * but this wrapper is provided for other callers.
 */
getBranchCommits: (workingDirectory: string, branchName: string, limit?: number) =>
  invoke<unknown>("git_get_branch_commits", { workingDirectory, branchName, limit }),

/**
 * Get the diff introduced by a single commit.
 * Returns raw unified diff string for parseDiff().
 */
diffCommit: (workingDirectory: string, commitHash: string) =>
  invoke<string>("git_diff_commit", { workingDirectory, commitHash }),

/**
 * Get the diff between a base commit and the current working tree.
 * Includes staged, unstaged, and untracked file changes.
 */
diffRange: (workingDirectory: string, baseCommit: string) =>
  invoke<string>("git_diff_range", { workingDirectory, baseCommit }),

/**
 * Get the diff of uncommitted changes (HEAD to working tree).
 * Includes staged, unstaged, and untracked file changes.
 */
diffUncommitted: (workingDirectory: string) =>
  invoke<string>("git_diff_uncommitted", { workingDirectory }),

/**
 * Find the merge base between two branches.
 * Returns the commit hash of the common ancestor.
 */
getMergeBase: (workingDirectory: string, branchA: string, branchB: string) =>
  invoke<string>("git_get_merge_base", { workingDirectory, branchA, branchB }),

/**
 * Get the commit hash that a remote branch points to.
 * Used for GitHub-style fallback when on the default branch.
 */
getRemoteBranchCommit: (workingDirectory: string, remote: string, branch: string) =>
  invoke<string>("git_get_remote_branch_commit", { workingDirectory, remote, branch }),

/**
 * Get a file's contents at a specific git ref.
 * Used for viewing historical file versions in commit diffs.
 */
showFile: (cwd: string, path: string, ref: string) =>
  invoke<string>("git_show_file", { cwd, path, ref }),
```

**Note on parameter naming**: The new commands use `workingDirectory` (not `repoPath`) because they operate on worktree directories which may differ from the bare repo path. The `showFile` command uses `cwd`/`path`/`ref` to match the existing caller in `use-file-contents.ts`. This is intentionally different from the older commands that use `repoPath`.

## Wiring Points to Other Sub-Plans

- **Phase 2** (`02-content-pane-type.md`): No dependencies — Phase 2 is pure TypeScript types.
- **Phase 3** (`03-tree-menu.md`): The `getBranchCommits` wrapper and `useGitCommits` hook are used to populate commit sub-items in the tree menu.
- **Phase 4** (`04-changes-viewer.md`): The `diffRange`, `diffUncommitted`, `diffCommit`, `getMergeBase`, `getRemoteBranchCommit`, and `showFile` wrappers are consumed by the data-fetching hook in the Changes viewer.

## Completion Criteria

- All 7 Rust commands compile and are registered in the invoke handler
- Frontend wrappers added to `tauri-commands.ts`
- `git_get_branch_commits` returns structured `GitCommit` objects matching the existing `GitCommitSchema` in `use-git-commits.ts`
- `git_diff_commit`, `git_diff_range`, `git_diff_uncommitted` return raw unified diff strings compatible with `parseDiff()` in `src/lib/diff-parser.ts`
- `git_get_merge_base` and `git_get_remote_branch_commit` return commit hashes
- `git_show_file` returns file content at the given ref
- Untracked files included in `git_diff_range` and `git_diff_uncommitted` output (using `generate_new_file_diff()`)
- Binary files excluded from all diff outputs (key decision #26)
- All commands use `--no-color --no-ext-diff` flags for machine-parseable diff output
