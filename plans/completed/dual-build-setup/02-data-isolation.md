# 02: Data Isolation

## Current State

### Data Locations

| Data | Path | Defined In |
|------|------|------------|
| Repositories | `~/.anvil/repositories/` | `anvil_commands.rs` |
| Threads | `~/.anvil/threads/` | `anvil_commands.rs` |
| Config | `~/Library/Application Support/anvil/config.json` | `config.rs` |
| Clipboard DB | `~/Library/Application Support/anvil/clipboard.db` | `clipboard_db.rs` |
| Logs | `~/Library/Application Support/anvil/logs/` | `logging.rs` |
| Icon Cache | Tauri `app_data_dir/icon-cache/` | `icons.rs` |

### Path Resolution Code

**`config.rs`**:
```rust
fn config_dir() -> PathBuf {
    dirs::config_dir()  // ~/Library/Application Support on macOS
        .unwrap_or_else(|| PathBuf::from("."))
        .join("anvil")
}
```

**`anvil_commands.rs`**:
```rust
fn get_anvil_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".anvil")
}
```

## Design: Suffix-Based Path Derivation

**Key insight**: Instead of requiring separate env vars for each path, we derive paths from the baked `APP_SUFFIX`:

| Suffix | Data Dir | Config Dir |
|--------|----------|------------|
| _(none)_ | `~/.anvil` | `~/Library/Application Support/anvil` |
| `dev` | `~/.anvil-dev` | `~/Library/Application Support/anvil-dev` |
| `canary` | `~/.anvil-canary` | `~/Library/Application Support/anvil-canary` |

Runtime env vars (`ANVIL_DATA_DIR`, `ANVIL_CONFIG_DIR`) can still override for development flexibility.

## Implementation

### Add shellexpand dependency

**`src-tauri/Cargo.toml`**:
```toml
[dependencies]
shellexpand = "3.1"
```

### Centralized Path Resolution Module

**Create**: `src-tauri/src/paths.rs`

```rust
use std::path::PathBuf;
use std::env;
use std::sync::OnceLock;
use crate::build_info;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Expand shell variables and tilde in a path string
fn expand_path(path: &str) -> PathBuf {
    PathBuf::from(shellexpand::tilde(path).into_owned())
}

/// Get default data directory based on baked suffix
fn default_data_dir() -> PathBuf {
    let suffix = build_info::APP_SUFFIX;
    let dir_name = if suffix.is_empty() {
        ".anvil".to_string()
    } else {
        format!(".anvil-{}", suffix)
    };
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name)
}

/// Get default config directory based on baked suffix
fn default_config_dir() -> PathBuf {
    let suffix = build_info::APP_SUFFIX;
    let dir_name = if suffix.is_empty() {
        "anvil".to_string()
    } else {
        format!("anvil-{}", suffix)
    };
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name)
}

/// Initialize paths (call once at startup).
/// Uses baked suffix for defaults, with env var overrides for development.
pub fn initialize() {
    // Data directory: env override or suffix-derived default
    DATA_DIR.get_or_init(|| {
        env::var("ANVIL_DATA_DIR")
            .map(|s| expand_path(&s))
            .unwrap_or_else(|_| default_data_dir())
    });

    // Config directory: env override or suffix-derived default
    CONFIG_DIR.get_or_init(|| {
        env::var("ANVIL_CONFIG_DIR")
            .map(|s| expand_path(&s))
            .unwrap_or_else(|_| default_config_dir())
    });
}

/// Base directory for repository data and threads
pub fn data_dir() -> &'static PathBuf {
    DATA_DIR.get().expect("paths::initialize() not called")
}

/// Directory for repositories
pub fn repositories_dir() -> PathBuf {
    data_dir().join("repositories")
}

/// Directory for thread metadata
pub fn threads_dir() -> PathBuf {
    data_dir().join("threads")
}

/// Base config directory
pub fn config_dir() -> &'static PathBuf {
    CONFIG_DIR.get().expect("paths::initialize() not called")
}

/// Path to main config file
pub fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

/// Path to clipboard database
pub fn clipboard_db() -> PathBuf {
    config_dir().join("clipboard.db")
}

/// Path to logs directory
pub fn logs_dir() -> PathBuf {
    config_dir().join("logs")
}

/// Get current paths info for debugging/display
pub fn get_paths_info() -> PathsInfo {
    PathsInfo {
        data_dir: data_dir().clone(),
        config_dir: config_dir().clone(),
        app_suffix: build_info::APP_SUFFIX.to_string(),
        is_alternate_build: build_info::is_alternate_build(),
    }
}

#[derive(serde::Serialize)]
pub struct PathsInfo {
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
    pub app_suffix: String,
    pub is_alternate_build: bool,
}
```

### Update Existing Code

**`lib.rs`** - Initialize paths at startup:
```rust
mod paths;

fn main() {
    // Initialize paths before anything else
    paths::initialize();

    // ... rest of app setup
}
```

**`config.rs`**:
```rust
use crate::paths;

fn config_file_path() -> PathBuf {
    paths::config_file()
}

fn config_dir() -> &'static PathBuf {
    paths::config_dir()
}
```

**`anvil_commands.rs`**:
```rust
use crate::paths;

fn get_anvil_dir() -> &'static PathBuf {
    paths::data_dir()
}

fn get_repositories_dir() -> PathBuf {
    paths::repositories_dir()
}

fn get_threads_dir() -> PathBuf {
    paths::threads_dir()
}

#[tauri::command]
pub fn get_paths_info() -> paths::PathsInfo {
    paths::get_paths_info()
}
```

**`clipboard_db.rs`**:
```rust
use crate::paths;

fn get_db_path() -> PathBuf {
    let db_path = paths::clipboard_db();
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    db_path
}
```

**`logging.rs`**:
```rust
use crate::paths;

fn get_logs_dir() -> io::Result<PathBuf> {
    let logs_dir = paths::logs_dir();
    fs::create_dir_all(&logs_dir)?;
    Ok(logs_dir)
}
```

### Frontend Path Awareness

**Add Tauri command** to expose paths:

```rust
#[tauri::command]
pub fn get_paths_info() -> paths::PathsInfo {
    paths::get_paths_info()
}
```

**Frontend usage**:
```typescript
const paths = await invoke<PathsInfo>('get_paths_info');
console.log(`Data dir: ${paths.data_dir}`);
console.log(`Config dir: ${paths.config_dir}`);
console.log(`App suffix: ${paths.app_suffix}`);
```

## Files to Modify/Create

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | **MODIFY**: Add `shellexpand = "3.1"` dependency |
| `src-tauri/src/paths.rs` | **NEW**: Centralized path module with suffix-based defaults |
| `src-tauri/src/lib.rs` | **MODIFY**: Add `mod paths;`, call `paths::initialize()` |
| `src-tauri/src/config.rs` | **MODIFY**: Use `paths::config_dir()` |
| `src-tauri/src/anvil_commands.rs` | **MODIFY**: Use `paths::data_dir()`, add `get_paths_info` command |
| `src-tauri/src/clipboard_db.rs` | **MODIFY**: Use `paths::clipboard_db()` |
| `src-tauri/src/logging.rs` | **MODIFY**: Use `paths::logs_dir()` |

## Usage Examples

**Installed apps work automatically** - paths are derived from baked suffix:

```bash
# Production build (no env vars needed)
open /Applications/Anvil.app
# Uses: ~/.anvil, ~/Library/Application Support/anvil

# Dev build (suffix baked at build time)
open /Applications/Anvil\ Dev.app
# Uses: ~/.anvil-dev, ~/Library/Application Support/anvil-dev
```

**Development overrides** - env vars can still override for testing:

```bash
# Override paths during development
ANVIL_DATA_DIR=~/test-data ./Anvil\ Dev.app/Contents/MacOS/Anvil\ Dev
# Uses: ~/test-data instead of ~/.anvil-dev
```

## Verification

1. Build and install both production and dev apps
2. Launch production app, create a repository
3. Verify data appears in production paths:
   ```bash
   ls ~/.anvil/repositories/
   ls ~/Library/Application\ Support/anvil/
   ```
4. Launch dev app, create a repository
5. Verify data appears in dev paths (isolated):
   ```bash
   ls ~/.anvil-dev/repositories/
   ls ~/Library/Application\ Support/anvil-dev/
   ```
6. Verify no cross-contamination of data

## Migration Notes

- Existing users have data in `~/.anvil/` - no migration needed for production
- Alternate instances start fresh with empty directories
- Future enhancement: add "copy from production" utility for testing with real data
