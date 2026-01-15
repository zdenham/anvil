# Documents Permission Request Investigation

## Symptom
macOS displays a Documents permission request immediately on first launch, before the app UI renders.

## Startup Sequence (pre-render)

From `src-tauri/src/lib.rs:511-778`, the setup runs in this order:

1. `logging::initialize()` - writes to `~/Library/Application Support/mortician/logs/`
2. `paths::initialize()` - **runs login shell**, creates `~/.mort` directories
3. `ensure_mort_directories()` - creates `~/.mort/settings` and `~/.mort/databases`
4. `config::initialize()` - reads/writes `~/.mort/settings/app-config.json`
5. `panels::initialize()` + panel creation - creates 6 webview panels
6. `icons::initialize()` - spawns background thread scanning `/Applications`, `~/Applications`
7. `app_search::initialize()` - spawns background thread building app index
8. `clipboard::initialize()` - starts clipboard monitoring with `arboard`

## Primary Hypothesis: Login Shell Execution

**`paths.rs:50-73` runs a login shell to capture PATH:**

```rust
fn capture_shell_path() -> String {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output() {
        // ...
    }
}
```

The `-l` flag makes this a login shell, which sources:
- `~/.zprofile`
- `~/.zlogin`
- `/etc/zprofile`
- `/etc/zshrc`

If any of these files reference `~/Documents` or run commands that access Documents, macOS will prompt for permission since the shell process inherits the app's sandbox context.

## Alternative Hypotheses

### 1. Clipboard Initialization (`clipboard.rs:88`)
```rust
let mut clipboard = match Clipboard::new() {
```
The `arboard` crate accesses the system pasteboard. If the last copied item was a file from Documents, this might trigger access.

### 2. Webview Panel Creation (`panels.rs`)
Creating webviews may trigger WebKit to access cached data or history that references Documents. Each panel calls `PanelBuilder::new(...).build()`.

### 3. Icon Extraction Thread (`icons.rs:30-33`)
```rust
std::thread::spawn(move || {
    extract_all_icons(&cache_dir);
});
```
Uses `NSWorkspace::sharedWorkspace().iconForFile()` which accesses app bundles. Unlikely to trigger Documents, but could interact with macOS privacy subsystem.

## Evidence Needed

To confirm which operation triggers the prompt:
1. Add timing logs before/after each startup operation
2. Comment out `capture_shell_path()` and test
3. Comment out `clipboard::initialize()` and test

## Recommended Fix

If login shell is the cause, avoid running a login shell:

```rust
// Instead of login shell
Command::new(&shell).args(["-l", "-c", "echo $PATH"])

// Use non-login interactive shell
Command::new(&shell).args(["-i", "-c", "echo $PATH"])

// Or read PATH from environment directly
env::var("PATH").unwrap_or_default()
```

## Files Involved

| File | Line | Operation |
|------|------|-----------|
| `src-tauri/src/paths.rs` | 50-73 | `capture_shell_path()` - login shell |
| `src-tauri/src/clipboard.rs` | 88 | `Clipboard::new()` - arboard init |
| `src-tauri/src/panels.rs` | 248-306 | `create_spotlight_panel()` - first webview |
| `src-tauri/src/lib.rs` | 680-778 | Setup sequence order |
