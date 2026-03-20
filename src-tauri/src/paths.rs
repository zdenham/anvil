//! Centralized path resolution for the application.
//!
//! Provides suffix-based path derivation for data isolation between builds.
//! Uses baked APP_SUFFIX for defaults, with env var overrides for development.

use crate::build_info;
use std::env;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();
// Use RwLock to allow updating SHELL_PATH after initialization
static SHELL_PATH: OnceLock<RwLock<String>> = OnceLock::new();

/// Expand shell variables and tilde in a path string
fn expand_path(path: &str) -> PathBuf {
    PathBuf::from(shellexpand::tilde(path).into_owned())
}

/// Get default data directory based on baked suffix
fn default_data_dir() -> PathBuf {
    let suffix = build_info::app_suffix();
    let dir_name = if suffix.is_empty() {
        ".mort".to_string()
    } else {
        format!(".mort-{}", suffix)
    };
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name)
}

/// Get default config directory based on baked suffix
fn default_config_dir() -> PathBuf {
    let suffix = build_info::app_suffix();
    let dir_name = if suffix.is_empty() {
        "mortician".to_string()
    } else {
        format!("mortician-{}", suffix)
    };
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name)
}

/// Returns a static PATH fallback (no login shell execution).
fn capture_shell_path() -> String {
    let current = env::var("PATH").unwrap_or_default();
    tracing::info!(
        current_path_len = current.len(),
        current_path_entries = current.split(':').count(),
        "capture_shell_path: Current PATH from env"
    );

    let mut paths: Vec<String> = vec![current];

    // Append common install locations
    for p in &["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/sbin"] {
        paths.push(p.to_string());
    }

    // Append node version manager paths
    if let Some(home) = dirs::home_dir() {
        for extra in node_version_manager_paths(&home) {
            paths.push(extra);
        }
    }

    let fallback = paths.join(":");
    tracing::info!(
        fallback_path_len = fallback.len(),
        fallback_path_entries = fallback.split(':').count(),
        "capture_shell_path: Using static PATH fallback (shell init deferred)"
    );
    tracing::debug!(fallback_path = %fallback, "Full fallback PATH");
    fallback
}

/// Discovers bin directories from common Node.js version managers.
fn node_version_manager_paths(home: &std::path::Path) -> Vec<String> {
    let mut extra = Vec::new();

    // nvm: try to resolve default alias, fall back to latest installed version
    let nvm_dir = home.join(".nvm");
    if nvm_dir.is_dir() {
        if let Some(bin) = nvm_resolve_default(&nvm_dir) {
            extra.push(bin);
        }
    }

    // fnm
    let fnm_dir = home.join(".fnm/node-versions");
    if fnm_dir.is_dir() {
        if let Some(bin) = latest_versioned_bin(&fnm_dir, "installation/bin") {
            extra.push(bin);
        }
    }

    // volta
    let volta_bin = home.join(".volta/bin");
    if volta_bin.is_dir() {
        extra.push(volta_bin.to_string_lossy().into_owned());
    }

    // asdf shims
    let asdf_shims = home.join(".asdf/shims");
    if asdf_shims.is_dir() {
        extra.push(asdf_shims.to_string_lossy().into_owned());
    }

    // mise
    let mise_shims = home.join(".local/share/mise/shims");
    if mise_shims.is_dir() {
        extra.push(mise_shims.to_string_lossy().into_owned());
    }
    let mise_installs = home.join(".local/share/mise/installs/node");
    if mise_installs.is_dir() {
        if let Some(bin) = latest_versioned_bin(&mise_installs, "bin") {
            extra.push(bin);
        }
    }

    tracing::debug!(paths = ?extra, "Discovered node version manager paths");
    extra
}

/// Resolves nvm's default node bin directory.
/// Reads ~/.nvm/alias/default to find the version, then locates the matching install.
fn nvm_resolve_default(nvm_dir: &std::path::Path) -> Option<String> {
    let versions_dir = nvm_dir.join("versions/node");
    if !versions_dir.is_dir() {
        return None;
    }

    // Try reading the default alias
    let alias_file = nvm_dir.join("alias/default");
    if let Ok(alias) = std::fs::read_to_string(&alias_file) {
        let version = alias.trim();
        // alias might be a full version like "v20.11.0" or a prefix like "20"
        if let Some(bin) = find_nvm_version(&versions_dir, version) {
            return Some(bin);
        }
    }

    // Fall back to latest installed version
    latest_versioned_bin(&versions_dir, "bin")
}

/// Finds an nvm node version matching a version string (exact or prefix).
fn find_nvm_version(versions_dir: &std::path::Path, version: &str) -> Option<String> {
    let entries = std::fs::read_dir(versions_dir).ok()?;
    let mut matches: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            name == version || name.starts_with(&format!("v{}", version.trim_start_matches('v')))
        })
        .collect();
    matches.sort();
    matches.last().map(|p| p.join("bin").to_string_lossy().into_owned())
}

/// Picks the latest version directory and appends a bin suffix.
/// E.g. for `~/.fnm/node-versions/v20.11.0/installation/bin`.
fn latest_versioned_bin(parent: &std::path::Path, bin_suffix: &str) -> Option<String> {
    let entries = std::fs::read_dir(parent).ok()?;
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs.last().map(|p| p.join(bin_suffix).to_string_lossy().into_owned())
}

/// Resolves the absolute path to the `node` binary by searching `shell_path()`.
///
/// This is necessary because `Command::new("node")` uses the parent process's PATH
/// for binary lookup (via posix_spawnp), not the child's env. When launched from the
/// Dock, the parent PATH is macOS's minimal launchd PATH which won't contain node.
pub fn resolve_node_binary() -> Result<PathBuf, String> {
    let search_path = shell_path();
    let searched_dirs: Vec<&str> = search_path.split(':').filter(|s| !s.is_empty()).collect();

    for dir in &searched_dirs {
        let candidate = PathBuf::from(dir).join("node");
        if candidate.is_file() {
            tracing::info!(node_path = %candidate.display(), "Resolved node binary");
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find 'node' binary. Searched {} directories in PATH. \
         Install Node.js (https://nodejs.org) or ensure it's available via \
         a version manager (nvm, fnm, volta, asdf, mise).\n\
         Searched PATH: {}",
        searched_dirs.len(),
        search_path
    ))
}

/// Initialize paths (call once at startup).
/// Uses baked suffix for defaults, with env var overrides for development.
pub fn initialize() {
    // Data directory: env override or suffix-derived default
    DATA_DIR.get_or_init(|| {
        env::var("MORT_DATA_DIR")
            .map(|s| expand_path(&s))
            .unwrap_or_else(|_| default_data_dir())
    });

    // Config directory: env override or suffix-derived default
    CONFIG_DIR.get_or_init(|| {
        env::var("MORT_CONFIG_DIR")
            .map(|s| expand_path(&s))
            .unwrap_or_else(|_| default_config_dir())
    });

    // Initialize shell path with static fallback
    SHELL_PATH.get_or_init(|| RwLock::new(capture_shell_path()));

    tracing::info!(
        data_dir = %data_dir().display(),
        config_dir = %config_dir().display(),
        shell_path = %shell_path(),
        app_suffix = %build_info::app_suffix(),
        "Paths initialized (shell init deferred)"
    );
}

/// Base directory for repository data and threads
pub fn data_dir() -> &'static PathBuf {
    DATA_DIR.get().expect("paths::initialize() not called")
}

/// Base config directory
pub fn config_dir() -> &'static PathBuf {
    CONFIG_DIR.get().expect("paths::initialize() not called")
}

/// Returns the shell PATH to use for external commands (git, etc.)
pub fn shell_path() -> String {
    SHELL_PATH
        .get()
        .expect("paths::initialize() not called")
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// Path to settings directory in .mort
pub fn settings_dir() -> PathBuf {
    data_dir().join("settings")
}

/// Path to databases directory in .mort
pub fn databases_dir() -> PathBuf {
    data_dir().join("databases")
}

/// Path to app config file in .mort/settings
pub fn app_config_file() -> PathBuf {
    settings_dir().join("app-config.json")
}

/// Path to clipboard database in .mort/databases
pub fn clipboard_database() -> PathBuf {
    databases_dir().join("clipboard.db")
}

/// Path to drain analytics database in .mort/databases
pub fn drain_database() -> PathBuf {
    databases_dir().join("drain.db")
}

