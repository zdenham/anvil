# Dev Logs to Repo Directory

## Problem
Dev build logs go to `~/.config/mortician-dev/logs/structured.jsonl`, which is far from the repo. During development it's more convenient to have them in the repo itself for quick access.

## Phases

- [ ] Add `MORT_LOG_DIR` env var support to `get_logs_dir()` in `src-tauri/src/logging/mod.rs`
- [ ] Set `MORT_LOG_DIR=logs` in `scripts/env-presets/dev.sh`
- [ ] Add `logs/` to `.gitignore`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach

### 1. `get_logs_dir()` — respect `MORT_LOG_DIR`

In `src-tauri/src/logging/mod.rs:360`, add a check at the top of `get_logs_dir()`:

```rust
fn get_logs_dir() -> io::Result<PathBuf> {
    // Allow explicit override (useful for dev builds)
    if let Ok(dir) = std::env::var("MORT_LOG_DIR") {
        let path = PathBuf::from(shellexpand::tilde(&dir).into_owned());
        fs::create_dir_all(&path)?;
        return Ok(path);
    }

    // ... existing suffix-based logic unchanged ...
}
```

This keeps it simple — one env var, no magic detection. Production builds never set it, so their behavior is unchanged.

### 2. Dev preset — set `MORT_LOG_DIR=logs`

In `scripts/env-presets/dev.sh`, add:

```sh
export MORT_LOG_DIR=logs
```

Since `dev-mort.sh` runs from the repo root (`pnpm dev`), the relative path `logs` resolves to `<repo>/logs/`. The log file ends up at `<repo>/logs/structured.jsonl`.

### 3. `.gitignore` — exclude `logs/`

Add `logs/` to `.gitignore` so the directory isn't committed.
