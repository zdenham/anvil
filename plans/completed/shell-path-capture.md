# Shell PATH Capture for External Commands

## Summary

Capture the user's actual shell PATH at app startup and use it for all external command execution. This ensures the app can find tools installed via Homebrew or other package managers (git, git-lfs, node, pnpm, etc.), regardless of whether the app is launched from a terminal (dev) or Finder (prod).

## Problem

When the app runs from Finder/Launchpad in production, it gets a minimal system PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that doesn't include Homebrew's `/opt/homebrew/bin` or `/usr/local/bin`. This causes commands to fail when they depend on tools installed via package managers:

```
git-lfs filter-process: git-lfs: command not found
fatal: the remote end hung up unexpectedly
```

In dev, the app inherits the terminal's PATH, so everything works.

## Solution

1. At app startup, run the user's login shell to capture their actual PATH
2. Store it in a static variable (like existing `DATA_DIR`/`CONFIG_DIR`)
3. Provide a helper to create `Command` instances with the correct PATH
4. Use this helper for all external command execution

## Current State

- `paths.rs` uses `OnceLock` pattern for `DATA_DIR` and `CONFIG_DIR`
- Multiple files use `Command::new()` without setting PATH:
  - `filesystem.rs` - git commands (worktree, branch operations)
  - `git_commands.rs` - git commands (branch, checkout, etc.)
  - `process_commands.rs` - spawns agent runner process
- No existing PATH handling in the codebase

## Implementation

### Step 1: Add Shell PATH Capture to paths.rs

**File**: `src-tauri/src/paths.rs`

Add a new `OnceLock` for the shell PATH and capture it during initialization:

```rust
use std::process::Command;

static SHELL_PATH: OnceLock<String> = OnceLock::new();

/// Initialize paths (call once at startup).
pub fn initialize() {
    // ... existing DATA_DIR and CONFIG_DIR initialization ...

    // Capture user's shell PATH for git commands
    SHELL_PATH.get_or_init(|| {
        capture_shell_path()
    });

    tracing::info!(
        data_dir = %data_dir().display(),
        config_dir = %config_dir().display(),
        shell_path = %shell_path(),
        app_suffix = %build_info::APP_SUFFIX,
        "Paths initialized"
    );
}

/// Captures the user's actual PATH from their login shell.
/// Falls back to current PATH + common Homebrew locations if shell execution fails.
fn capture_shell_path() -> String {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Try to get PATH from user's login shell
    if let Ok(output) = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()
    {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    tracing::debug!(shell = %shell, "Captured PATH from login shell");
                    return path.to_string();
                }
            }
        }
    }

    // Fallback: current PATH + common Homebrew locations
    tracing::warn!(shell = %shell, "Failed to capture PATH from shell, using fallback");
    let current = env::var("PATH").unwrap_or_default();
    format!("{}:/opt/homebrew/bin:/usr/local/bin", current)
}

/// Returns the shell PATH to use for external commands (git, etc.)
pub fn shell_path() -> &'static str {
    SHELL_PATH.get().expect("paths::initialize() not called")
}
```

### Step 2: Create Shell Command Helper

**File**: `src-tauri/src/shell.rs` (new file)

Create a helper module for spawning external commands with the correct environment:

```rust
//! Utilities for running external commands with proper environment.
//!
//! GUI apps on macOS don't inherit the user's shell PATH, so commands like
//! git-lfs, node, pnpm etc. installed via Homebrew won't be found.
//! This module provides helpers that set up the correct PATH.

use crate::paths;
use std::process::Command;

/// Creates a Command with the user's shell PATH set.
/// Use this for any external command that might depend on tools
/// installed via Homebrew or other package managers.
///
/// # Example
/// ```
/// let output = shell::command("git")
///     .args(["status"])
///     .output()?;
/// ```
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", paths::shell_path());
    cmd
}
```

### Step 3: Update filesystem.rs

**File**: `src-tauri/src/filesystem.rs`

Replace `Command::new("git")` with `shell::command("git")`:

```rust
use crate::shell;

// In fs_git_worktree_add:
let _ = shell::command("git")
    .arg("-C")
    .arg(&repo_path)
    .arg("worktree")
    .arg("prune")
    .output();

let output = shell::command("git")
    .arg("-C")
    .arg(&repo_path)
    .arg("worktree")
    .arg("add")
    // ... rest of args
    .output()
    .map_err(|e| format!("Failed to run git: {}", e))?;

// Similarly for fs_git_worktree_remove, delete_git_branch, list_mort_branches
```

### Step 4: Update git_commands.rs

**File**: `src-tauri/src/git_commands.rs`

Same pattern - replace `Command::new("git")` with `shell::command("git")`.

### Step 5: Update process_commands.rs

**File**: `src-tauri/src/process_commands.rs`

Update process spawning to use `shell::command()`:

```rust
use crate::shell;

// When spawning the agent runner:
let child = shell::command(&runner_path)
    .args([...])
    .spawn()?;
```

### Step 6: Register Module

**File**: `src-tauri/src/lib.rs`

Add the new module:

```rust
mod shell;
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/paths.rs` | Add `SHELL_PATH`, `capture_shell_path()`, `shell_path()` |
| `src-tauri/src/shell.rs` | New file with `command()` helper |
| `src-tauri/src/filesystem.rs` | Use `shell::command("git")` for all git calls |
| `src-tauri/src/git_commands.rs` | Use `shell::command("git")` for all git calls |
| `src-tauri/src/process_commands.rs` | Use `shell::command()` for spawning processes |
| `src-tauri/src/lib.rs` | Add `mod shell;` |

## Dev/Prod Parity

This approach ensures the same code path runs in both environments:

1. **Dev (terminal launch)**: Shell PATH capture works, gets full PATH from `.zshrc`/`.bashrc`
2. **Prod (Finder launch)**: Shell PATH capture works, spawns login shell to get user's configured PATH
3. **Fallback**: If shell execution fails for any reason, falls back to current PATH plus common Homebrew locations

The key is that we always run `capture_shell_path()` regardless of environment - we don't try to detect dev vs prod and handle them differently.

## Edge Cases

1. **Non-standard shell locations**: Uses `$SHELL` env var which is set by the system based on the user's configured login shell
2. **Interactive-only PATH additions**: The `-l` flag runs a login shell which sources `.zprofile`/`.bash_profile`. Most PATH modifications live there.
3. **Very slow shell startup**: If the user has a slow shell config, this adds startup latency. Could be mitigated by running async, but for now keeping it simple and synchronous.
4. **No shell available**: Fallback handles this case

## Testing Checklist

- [ ] App starts successfully (PATH capture doesn't crash)
- [ ] Logs show captured PATH at startup (should include Homebrew paths)
- [ ] `git worktree add` works on LFS-enabled repo in prod build
- [ ] `git worktree add` still works on non-LFS repos
- [ ] Agent runner process spawns correctly in prod build
- [ ] Test in dev (terminal launch) - should work as before
- [ ] Test in prod (Finder launch) - should now work with Homebrew tools

## Future Considerations

- Could cache PATH to disk to avoid shell spawn on every app start
- Could run PATH capture async to reduce startup latency
- Could periodically refresh PATH in case user installs new tools while app is running
