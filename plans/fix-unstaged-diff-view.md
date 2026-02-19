# Fix: Unstaged/Untracked Files Not Showing in Per-Thread Diff View

## Problem

Users report that the per-thread diff view does not display diffs for unstaged/untracked files. The Rust backend (`git_diff_files`) relies on an `operation` label from the agent to decide whether to use `git diff` or synthetic diff generation. This label is frequently wrong, causing untracked files to be routed through `git diff <base_commit>` which returns nothing for files git doesn't know about.

## Phases

- [ ] Simplify Rust backend to determine tracking status from git itself
- [ ] Remove operation-based routing from frontend caller
- [ ] Verify fix with manual testing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Root Cause

**File:** `src-tauri/src/git_commands.rs:535-537`

The backend partitions files by the `operation` field sent from the frontend:

```rust
let (new_files, tracked_files): (Vec<_>, Vec<_>) = requests
    .into_iter()
    .partition(|r| r.operation == "create");
```

- `"create"` → synthetic diff (read from disk, all lines as `+`)
- anything else → `git diff <base_commit> -- <file>`

The operation label comes from the agent's tool-call tracking (`shared.ts:690`), which naively assigns `"create"` for `Write` and `"modify"` for `Edit`. This is wrong in many cases (e.g., `Write` on existing file, `Edit` after `Write` on new file). When an untracked file gets labeled `"modify"`, `git diff` returns empty and no diff is shown.

**The operation label shouldn't matter for diff generation at all.** Git already knows which files exist at a given commit.

## Proposed Fix

### Phase 1: Simplify Rust backend (`src-tauri/src/git_commands.rs`)

Replace the operation-based partition with a git-based check. The function should:

1. Accept just file paths (ignore operations for routing purposes)
2. Use `git ls-tree <base_commit>` to determine which files exist at the base commit
3. Files in the tree → `git diff <base_commit> -- <file>` (shows working dir changes vs base)
4. Files NOT in the tree → `generate_new_file_diff()` (synthetic, all lines as additions)

```rust
pub async fn git_diff_files(
    repo_path: String,
    base_commit: String,
    file_paths: Vec<String>,
    file_requests: Option<Vec<FileDiffRequest>>,
) -> Result<String, String> {
    // Collect all paths (support both legacy and new calling conventions)
    let all_paths: Vec<String> = if let Some(requests) = file_requests {
        requests.into_iter().map(|r| r.path).collect()
    } else {
        file_paths
    };

    if all_paths.is_empty() {
        return Ok(String::new());
    }

    // Ask git which of these files exist at the base commit
    let ls_output = shell::command("git")
        .args(&["ls-tree", "--name-only", "-r", &base_commit])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to list files at base commit: {}", e))?;

    let tracked_at_base: HashSet<String> = String::from_utf8_lossy(&ls_output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();

    let (tracked, untracked): (Vec<_>, Vec<_>) = all_paths
        .into_iter()
        .partition(|p| tracked_at_base.contains(p));

    let mut all_diffs = Vec::new();

    // Tracked files: git diff <base> -- <files>
    if !tracked.is_empty() {
        let mut args = vec!["diff".to_string(), base_commit.clone(), "--".to_string()];
        args.extend(tracked);
        let output = shell::command("git")
            .args(&args)
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to execute git diff: {}", e))?;
        let diff_output = String::from_utf8_lossy(&output.stdout).to_string();
        if !diff_output.is_empty() {
            all_diffs.push(diff_output);
        }
    }

    // Untracked files: synthetic diff (all lines as additions)
    for path in untracked {
        match generate_new_file_diff(&repo_path, &path) {
            Ok(diff) if !diff.is_empty() => all_diffs.push(diff),
            Err(e) => tracing::warn!("Failed to generate diff for new file {}: {}", path, e),
            _ => {}
        }
    }

    Ok(all_diffs.join("\n"))
}
```

This is a straightforward refactor. The function signature stays the same (backward compatible), it just stops using `operation` for routing.

### Phase 2: Clean up frontend caller

In `thread-diff-generator.ts`, the `fileRequests` still sends operation info. This can be simplified — we can either:

- **Minimal change:** Keep sending `fileRequests` with operations (Rust just ignores them for routing). Operations are still useful metadata elsewhere.
- **Clean change:** Switch to the legacy `file_paths` param (just string array) since operations aren't needed for diff generation.

Recommend the minimal change — less churn, and the `FileDiffRequest` struct might be useful if we ever want the Rust side to know the operation for other reasons (e.g., delete files shouldn't generate diffs at all).

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/src/git_commands.rs` | Replace operation-based partition with `git ls-tree` check |

Optionally:
| File | Change |
|------|--------|
| `src/lib/utils/thread-diff-generator.ts` | Simplify to just pass file paths if desired |

## Notes

- The agent-side operation labels (`shared.ts:690`) are still slightly wrong but that's a separate concern — they're used for UI display in the changes tab, not for diff generation. Can be fixed independently if needed.
- `git ls-tree -r <base_commit>` lists all files recursively at that commit. For large repos this could be slow, but it's a single call and the output is just file paths. If perf is a concern, we could instead check individual files with `git cat-file -e <base_commit>:<path>`, but batch is simpler.
