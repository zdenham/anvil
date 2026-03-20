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
    let suffix = build_info::APP_SUFFIX;
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
    let suffix = build_info::APP_SUFFIX;
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

    let fallback = format!("{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin", current);
    tracing::info!(
        fallback_path_len = fallback.len(),
        fallback_path_entries = fallback.split(':').count(),
        "capture_shell_path: Using static PATH fallback (shell init deferred)"
    );
    tracing::debug!(fallback_path = %fallback, "Full fallback PATH");
    fallback
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
        app_suffix = %build_info::APP_SUFFIX,
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

