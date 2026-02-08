# Workspace Checkout Remote Main

When a workspace is created, it should checkout `origin/main` (or the remote's default branch) rather than local `main`. This ensures workspaces always start from the latest remote state, not potentially stale local branches.

## Problem

Currently when a workspace is created:
1. `WorktreeService.create()` calls `git.createWorktree(sourcePath, worktreePath)` with no branch options
2. The `NodeGitAdapter.createWorktree()` runs `git worktree add <path>` without specifying a commit
3. This checks out the current HEAD of the local repository, not the remote default branch

This means if the local `main` is behind `origin/main`, the workspace starts with stale code.

## Solution

Modify workspace creation to:
1. Fetch the latest from origin before creating the workspace
2. Get the commit hash of `origin/<default-branch>`
3. Create the worktree at that specific commit (detached HEAD)

## Phases

- [ ] Update `NodeGitAdapter` to support fetching and remote branch resolution
- [ ] Update `WorktreeService.create()` to fetch and checkout remote default branch
- [ ] Update Rust backend `git_create_worktree` to match the behavior (if used via Tauri)
- [ ] Add tests for the new behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: Update NodeGitAdapter

Add a method to get the remote default branch's commit:

```typescript
// In core/adapters/node/git-adapter.ts

getRemoteDefaultBranchCommit(repoPath: string): string {
  // First fetch to ensure we have latest
  this.fetch(repoPath, 'origin');

  // Get the remote default branch name
  const defaultBranch = this.getDefaultBranch(repoPath);

  // Get the commit of origin/<branch>
  return this.exec(['rev-parse', `origin/${defaultBranch}`], repoPath);
}
```

The `fetch()` method already exists in the adapter.

### Phase 2: Update WorktreeService.create()

Modify the create method to checkout the remote branch commit:

```typescript
// In core/services/worktree/worktree-service.ts

create(repoName: string, name: string): WorktreeState {
  return this.withLock(repoName, () => {
    const settings = this.settingsService.load(repoName);

    // ... existing validation ...

    // Fetch latest from origin and get remote default branch commit
    this.git.fetch(settings.sourcePath, 'origin');
    const defaultBranch = this.git.getDefaultBranch(settings.sourcePath);
    const remoteCommit = this.git.getBranchCommit(
      settings.sourcePath,
      `origin/${defaultBranch}`
    );

    const worktreePath = `${this.mortDir}/repositories/${repoName}/${name}`;

    // Create worktree at the remote commit (detached HEAD)
    this.git.createWorktree(settings.sourcePath, worktreePath, {
      commit: remoteCommit
    });

    // ... rest of method ...
  });
}
```

### Phase 3: Rust Backend Updates (if needed)

If the Tauri commands are used directly (e.g., from the frontend), update `git_create_worktree` in `src-tauri/src/git_commands.rs`:

1. Add a new command `git_fetch`:
```rust
#[tauri::command]
pub async fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let output = shell::command("git")
        .args(["fetch", &remote])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "Failed to fetch: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}
```

2. Add `git_get_remote_branch_commit`:
```rust
#[tauri::command]
pub async fn git_get_remote_branch_commit(
    repo_path: String,
    remote: String,
    branch: String
) -> Result<String, String> {
    let ref_name = format!("{}/{}", remote, branch);
    git_get_branch_commit(repo_path, ref_name).await
}
```

### Phase 4: Testing

Add tests to verify:
1. Workspace creation fetches from origin
2. Workspace is created at the remote commit, not local
3. Works correctly when local main is behind origin/main
4. Works correctly when origin/HEAD points to a non-main branch

## Files to Modify

- `core/adapters/node/git-adapter.ts` - Add remote branch resolution
- `core/services/worktree/worktree-service.ts` - Update create() to use remote
- `src-tauri/src/git_commands.rs` - Add fetch command (if Tauri path is used)
- `src-tauri/src/lib.rs` - Register new commands (if Tauri path is used)

## Edge Cases

| Case | Handling |
|------|----------|
| No remote configured | Fall back to local default branch |
| Fetch fails (no network) | Log warning, fall back to local default branch |
| Remote branch doesn't exist | Fall back to local default branch |
| origin/HEAD not set | Use first of: origin/main, origin/master, local default |

## Notes

- The fetch operation adds a small delay to workspace creation, but ensures fresh code
- Consider making fetch optional via a flag for offline scenarios
- The `getDefaultBranch()` already prioritizes `refs/remotes/origin/HEAD` so it returns the correct branch name
