# Fix: Sidecar WebSocket server fails when app launched from Dock

## Problem

When Anvil.app is opened from the Dock/Finder (not terminal), the Node.js sidecar fails to spawn, so the WebSocket server never starts and the client can't connect.

## Root Cause

`Command::new("node")` **resolves the** `node` **binary using the parent process's PATH, not the child's configured env.**

In `lib.rs:203`, the sidecar is spawned with:

```rust
Command::new("node")
    .env("PATH", paths::shell_path())  // only affects child's env, NOT binary lookup
    .spawn()
```

On macOS, `Command::new("node")` uses `posix_spawnp`, which searches for `node` in the **parent process's PATH** — not the PATH set via `.env()` for the child.

- **Terminal launch**: Parent inherits the shell's full PATH (includes nvm/homebrew/volta/etc.), so `node` is found.
- **Dock launch**: Parent gets macOS's minimal launchd PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). The fallback in `capture_shell_path()` appends `/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin`, but this is only passed to the *child's* env — it's never set on the parent process, so `posix_spawnp` can't find `node`.

Additionally, if node is installed via a version manager (nvm, fnm, volta, mise, asdf), it won't be in the fallback paths at all — even if the parent PATH were updated.

## Phases

- [x] Phase 1: Resolve `node` binary path explicitly before spawning

- [x] Phase 2: Add node version manager path discovery

- [x] Phase 3: Improve error reporting when node isn't found

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Resolve `node` binary path explicitly before spawning

**File**: `src-tauri/src/lib.rs` (and possibly `src-tauri/src/paths.rs`)

Instead of `Command::new("node")`, resolve the full path to `node` first using the constructed PATH, then use `Command::new(full_node_path)`.

Create a helper like `resolve_node_binary()` in `paths.rs` that:

1. Takes `shell_path()` and splits on `:`
2. For each dir, checks if `{dir}/node` exists and is executable
3. Returns the first match, or an error if not found

Then in `spawn_sidecar`:

```rust
let node_path = paths::resolve_node_binary()
    .map_err(|e| format!("Cannot find node: {}", e))?;
let child = Command::new(&node_path)
    .arg(&server_path)
    // ... rest unchanged
```

This decouples binary resolution from the process's inherited PATH.

## Phase 2: Add node version manager path discovery

**File**: `src-tauri/src/paths.rs`

Extend `capture_shell_path()` (or create a new function used by `resolve_node_binary`) to probe common node version manager locations:

```
~/.nvm/versions/node/*/bin         (nvm — pick latest or current)
~/.fnm/node-versions/*/installation/bin  (fnm)
~/.volta/bin                        (volta)
~/.asdf/shims                       (asdf)
~/.local/share/mise/installs/node/*/bin  (mise)
~/.local/share/mise/shims           (mise shims)
```

For nvm specifically, read `~/.nvm/alias/default` to find the default version, or look for a `.nvmrc` in the project root.

These paths should be appended to the fallback PATH so that `resolve_node_binary()` from Phase 1 can find node regardless of how it was installed.

**Alternative approach**: Run a login shell to capture the real PATH:

```rust
// One-shot PATH capture at startup
let output = Command::new("/bin/zsh")
    .args(["-l", "-c", "echo $PATH"])
    .output();
```

This is more robust (catches all version managers, custom PATH additions, etc.) but has a startup cost (\~200-500ms) and depends on shell config not being broken. Could be done async during app startup to avoid blocking.

**Recommendation**: Do both — try the login shell approach first (fast path), fall back to static probing if it fails.

## Phase 3: Improve error reporting when node isn't found

**File**: `src-tauri/src/lib.rs`

Currently, if the sidecar spawn fails, the error is logged but the app continues silently. The user has no idea why the WebSocket isn't connecting.

Changes:

1. When `resolve_node_binary()` fails, emit a user-visible notification (Tauri notification or dialog) explaining that Node.js wasn't found
2. Include the searched PATH in the error log for debugging
3. Consider adding a "Sidecar Status" indicator in the UI that shows connection state (connected / disconnected / error)

## Testing

- Verify from terminal: `PATH=/usr/bin:/bin /Applications/Anvil.app/Contents/MacOS/anvil` (simulates Dock environment)
- Verify with nvm: ensure node is found when only installed via nvm
- Verify fallback: ensure good error message when node genuinely isn't installed