# Investigation: Documents Directory Access at Application Startup

## Summary

The root cause of early Documents directory access has been identified: **`paths::run_login_shell_initialization()` is being called in the Tauri `.setup()` hook**, which executes before any window renders.

## Root Cause

**Location:** `src-tauri/src/lib.rs:948`

```rust
.setup(|app| {
    // Initialize paths first (before anything that might use them)
    paths::initialize();

    // Run login shell to capture user's full PATH (includes node from nvm/fnm/etc)
    // This is done eagerly at startup to avoid "node not found" errors when spawning agents
    paths::run_login_shell_initialization();  // <-- THIS IS THE PROBLEM
    ...
})
```

The comment says "eagerly at startup" which is the issue - this triggers Documents access before the user sees any UI.

## Why This Triggers Documents Access

The `run_login_shell_initialization()` function in `src-tauri/src/paths.rs:64-105` does two things that trigger Documents access:

### 1. Explicit Documents Check (lines 68-71)
```rust
// First, explicitly access ~/Documents to trigger macOS permission prompt
let docs_access = check_documents_access();
```

The `check_documents_access()` function (lines 123-141) attempts to read `~/Documents`:
```rust
pub fn check_documents_access() -> bool {
    if let Some(home) = dirs::home_dir() {
        let documents = home.join("Documents");
        match std::fs::read_dir(&documents) {  // <-- Triggers permission prompt
            Ok(_) => true,
            Err(e) => false,
        }
    }
    ...
}
```

### 2. Login Shell Execution (lines 73-95)
```rust
if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output()
```

Running a login shell (`-l` flag) sources user shell configuration files (`~/.zshrc`, `~/.zprofile`, etc.) which often reference `~/Documents` in various ways:
- Custom PATH entries
- Aliases
- Environment variables
- Version managers (nvm, fnm, rbenv, etc.)

## The Intended Architecture

The code shows a two-phase initialization was intended:

### Phase 1: Static Fallback (startup)
`paths::initialize()` (line 944) captures a static fallback PATH without running the login shell:
```rust
fn capture_shell_path() -> String {
    let current = env::var("PATH").unwrap_or_default();
    let fallback = format!("{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin", current);
    tracing::info!("Using static PATH fallback (shell init deferred): {}", fallback);
    fallback
}
```

### Phase 2: Full Shell Initialization (on-demand)
The `ensureShellInitialized()` function in the frontend was meant to defer the actual login shell execution until needed (before spawning agents).

## The Bug

Despite the deferred architecture being set up, line 948 **still calls `run_login_shell_initialization()` eagerly at startup**, which:
1. Defeats the entire purpose of the deferred initialization
2. Triggers the Documents permission prompt before UI renders
3. Bypasses the normal permission flow

## Impact

When Documents permission is triggered this early:
- User sees a system dialog before any app window appears
- The "normal grant access to documents flow" is bypassed
- If denied, the app may not properly handle the denial state
- Poor user experience - no context for why permission is being requested

## The `ensureShellPathInitialized` Workaround

The workaround you implemented addresses this by:
1. Checking if shell is already initialized before spawning agents
2. Only running the login shell when actually needed (first agent spawn)
3. Providing a controlled permission flow in the UI

However, **the root cause line 948 still exists** and still triggers early Documents access.

## Recommendation

To fully fix this issue, the line at `src-tauri/src/lib.rs:948` should be removed or commented out:

```rust
.setup(|app| {
    // Initialize paths first (before anything that might use them)
    paths::initialize();

    // REMOVED: This was triggering Documents access before UI rendered
    // paths::run_login_shell_initialization();

    // Ensure .anvil directories exist (NEW)
    if let Err(e) = ensure_anvil_directories() {
        tracing::error!("Failed to ensure .anvil directories: {}", e);
    }
    ...
})
```

The `ensureShellInitialized()` function in the frontend will handle initialization when actually needed.

## Other Startup Code That Does NOT Access Documents

For completeness, these were also checked but do NOT access Documents:

| Component | Location | What it Accesses |
|-----------|----------|------------------|
| App Search Indexing | `src-tauri/src/app-search.rs:45-53` | `/Applications`, `~/Applications` (background thread) |
| Icon Extraction | `src-tauri/src/icons.rs:25-32` | `/Applications`, `~/Applications` (background thread) |
| Clipboard Database | `src-tauri/src/clipboard.rs:73-93` | `~/.anvil/databases/clipboard.db` |
| Directory Creation | `src-tauri/src/lib.rs:950-953` | `~/.anvil/settings`, `~/.anvil/databases` |
| Frontend Bootstrap | `src/App.tsx:57-74` | Protected behind permissions check, runs after window renders |

## Files Involved

- `src-tauri/src/lib.rs` - Setup hook calling `run_login_shell_initialization()` (line 948)
- `src-tauri/src/paths.rs` - Shell initialization functions (lines 64-141)
- `src/lib/agent-service.ts` - `ensureShellInitialized()` workaround (lines 91-104)
