# Auto-Identify via `gh` CLI

Replace the manual `identify(github_handle)` flow with automatic detection using `gh api user --jq .login`. The GitHub handle should be stored in `AppConfig` alongside `device_id`, and identification should happen automatically at startup — no user-facing UI required.

## Problem

The `identify` Tauri command exists but is never called because there's no frontend UI for it. The GitHub handle is stored in a separate `identity.json` file, adding unnecessary indirection. Since `gh` CLI is already installed on dev machines, we can detect the handle automatically and unify storage into `AppConfig`.

## Phases

- [x] Add `github_handle` to `AppConfig` and remove `identity.json`
- [x] Rewrite `identify` to shell out to `gh api user --jq .login`
- [x] Call `identify` automatically at startup
- [x] Clean up dead code

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `github_handle` to `AppConfig` and Remove `identity.json`

### `src-tauri/src/config.rs`

Add `github_handle` to `AppConfig`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "generate_device_id")]
    pub device_id: String,
    #[serde(default = "default_spotlight_hotkey")]
    pub spotlight_hotkey: String,
    #[serde(default = "default_clipboard_hotkey")]
    pub clipboard_hotkey: String,
    #[serde(default)]
    pub onboarded: bool,
    #[serde(default)]
    pub migration_version: u32,
    #[serde(default)]                    // NEW
    pub github_handle: Option<String>,   // NEW
}
```

Update `Default` impl to include `github_handle: None`.

Add accessors:

```rust
pub fn get_github_handle() -> Option<String> {
    load_config().github_handle
}

pub fn set_github_handle(handle: &str) -> Result<(), String> {
    let mut config = load_config();
    config.github_handle = Some(handle.to_string());
    save_config(&config)
}
```

### `src-tauri/src/paths.rs`

Remove `identity_file()` — no longer needed.

---

## Phase 2: Rewrite `identify` to Shell Out to `gh`

### `src-tauri/src/identity.rs`

Replace the entire module. The new `identify` function:

1. Shells out to `gh api user --jq .login` using `std::process::Command` with `paths::shell_path()` on `PATH` (so `gh` is found even when installed via Homebrew/version managers)
2. Trims the output to get the handle
3. Saves to `AppConfig` via `config::set_github_handle()`
4. Fires the server registration in a background thread (same fire-and-forget POST to `/identity` as before)

```rust
use crate::config;
use crate::paths;
use tracing::{info, warn};

const IDENTITY_SERVER_URL: &str = "https://mort-server.fly.dev/identity";

/// Detect the GitHub handle via `gh` CLI and persist it.
/// Returns the handle on success, or an error if `gh` is not authenticated.
pub fn identify() -> Result<String, String> {
    let output = std::process::Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .env("PATH", paths::shell_path())
        .output()
        .map_err(|e| format!("Failed to run `gh`: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`gh api user` failed: {}", stderr.trim()));
    }

    let handle = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if handle.is_empty() {
        return Err("`gh api user` returned empty login".to_string());
    }

    // Persist in app config
    config::set_github_handle(&handle)?;
    let device_id = config::get_device_id();
    info!(device_id = %device_id, github_handle = %handle, "Identity detected via gh CLI");

    // Register with server (best-effort, background)
    let did = device_id.clone();
    let gh = handle.clone();
    std::thread::spawn(move || {
        if let Err(e) = register_with_server(&did, &gh) {
            warn!(error = %e, "Failed to register identity with server");
        }
    });

    Ok(handle)
}

fn register_with_server(device_id: &str, github_handle: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("IDENTITY_SERVER_URL")
        .unwrap_or_else(|_| IDENTITY_SERVER_URL.to_string());

    #[derive(serde::Serialize)]
    struct Payload<'a> {
        device_id: &'a str,
        github_handle: &'a str,
    }

    ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(&Payload { device_id, github_handle })?;

    info!(device_id = %device_id, "Identity registered with server");
    Ok(())
}
```

### Tauri Commands

Keep a `get_github_handle` command (delegates to `config::get_github_handle()`). The old `identify(github_handle: String)` command is removed from the invoke handler since identification is now automatic.

```rust
#[tauri::command]
pub fn get_github_handle() -> Option<String> {
    config::get_github_handle()
}
```

---

## Phase 3: Call `identify` Automatically at Startup

### `src-tauri/src/lib.rs` — in the `setup` closure

Replace the current startup re-registration block (`lib.rs:997-1003`) with:

```rust
// Auto-identify via gh CLI (best-effort, don't block startup)
std::thread::spawn(|| {
    match identity::identify() {
        Ok(handle) => tracing::info!(github_handle = %handle, "Auto-identified via gh CLI"),
        Err(e) => tracing::warn!(error = %e, "Auto-identify failed (gh CLI not available or not authenticated)"),
    }
});
```

This runs once per startup in a background thread. If `gh` isn't installed or the user isn't authenticated, it logs a warning and moves on — the app works fine without identity.

### Remove old `identify` from invoke handler

In the `invoke_handler!` macro call, change:

```rust
// Before
identity::identify,
identity::get_github_handle,

// After
identity::get_github_handle,
```

---

## Phase 4: Clean Up Dead Code

- **`src-tauri/src/paths.rs`**: Remove `identity_file()` function
- **`src-tauri/src/identity.rs`**: Remove `Identity` struct, `load_identity()`, `save_identity()` (all replaced by `AppConfig`)
- **`identity.json` references**: The file at `~/.mort/settings/identity.json` is no longer written. Existing files on disk are harmless (ignored). No migration needed.
- **Frontend**: No changes — `invoke("identify", ...)` was never called, and `get_github_handle` still works

---

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/src/config.rs` | Add `github_handle: Option<String>` to `AppConfig`, add getter/setter |
| `src-tauri/src/identity.rs` | Rewrite — shell out to `gh`, remove `Identity` struct and file I/O |
| `src-tauri/src/lib.rs` | Replace startup re-registration with `identity::identify()` call, remove `identify` from invoke handler |
| `src-tauri/src/paths.rs` | Remove `identity_file()` |
