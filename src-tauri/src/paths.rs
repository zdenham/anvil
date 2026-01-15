//! Centralized path resolution for the application.
//!
//! Provides suffix-based path derivation for data isolation between builds.
//! Uses baked APP_SUFFIX for defaults, with env var overrides for development.

use crate::build_info;
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{OnceLock, RwLock};

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();
// Use RwLock to allow updating SHELL_PATH after initialization
static SHELL_PATH: OnceLock<RwLock<String>> = OnceLock::new();
// Track whether shell initialization has been run (with login shell)
static SHELL_INITIALIZED: OnceLock<RwLock<bool>> = OnceLock::new();

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
/// The login shell is run later via `run_login_shell_initialization()` after Documents permission.
fn capture_shell_path() -> String {
    let current = env::var("PATH").unwrap_or_default();
    let fallback = format!("{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin", current);
    tracing::info!("Using static PATH fallback (shell init deferred): {}", fallback);
    fallback
}

/// Run the login shell to capture the user's PATH and trigger Documents permission.
/// This explicitly accesses ~/Documents to trigger the macOS permission prompt.
/// Should be called when user clicks "Grant Documents Access" in the UI.
/// Returns true if a valid PATH was captured from the shell.
pub fn run_login_shell_initialization() -> bool {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    tracing::info!(shell = %shell, "Running login shell initialization");

    // First, explicitly access ~/Documents to trigger macOS permission prompt
    // This is the critical step - without this, the permission dialog won't appear
    let docs_access = check_documents_access();
    tracing::info!(docs_access = docs_access, "Documents access check completed");

    if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    tracing::info!(shell = %shell, "Captured PATH from login shell");
                    // Update the shell path
                    if let Some(lock) = SHELL_PATH.get() {
                        if let Ok(mut guard) = lock.write() {
                            *guard = path.to_string();
                        }
                    }
                    // Mark as initialized
                    if let Some(lock) = SHELL_INITIALIZED.get() {
                        if let Ok(mut guard) = lock.write() {
                            *guard = true;
                        }
                    }
                    return true;
                }
            }
        }
    }

    tracing::warn!(shell = %shell, "Failed to capture PATH from login shell");
    // Still mark as initialized (user attempted it)
    if let Some(lock) = SHELL_INITIALIZED.get() {
        if let Ok(mut guard) = lock.write() {
            *guard = true;
        }
    }
    false
}

/// Check if shell initialization has been run.
pub fn is_shell_initialized() -> bool {
    SHELL_INITIALIZED
        .get()
        .and_then(|lock| lock.read().ok())
        .map(|guard| *guard)
        .unwrap_or(false)
}

/// Check if the app has Documents folder access.
/// This attempts to list ~/Documents to see if we have permission.
/// Returns true if we can access the folder, false otherwise.
///
/// WARNING: This WILL trigger the macOS permission prompt if Documents access
/// hasn't been determined yet. Do NOT call this proactively on UI mount.
/// Use `is_shell_initialized()` to check if permission has been granted previously.
pub fn check_documents_access() -> bool {
    if let Some(home) = dirs::home_dir() {
        let documents = home.join("Documents");
        // Try to read the directory - if we don't have permission, this will fail
        match std::fs::read_dir(&documents) {
            Ok(_) => {
                tracing::debug!("Documents access check: granted");
                true
            }
            Err(e) => {
                tracing::debug!(error = %e, "Documents access check: denied");
                false
            }
        }
    } else {
        tracing::warn!("Could not determine home directory for Documents check");
        false
    }
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

    // Initialize shell path with static fallback (login shell runs later via Documents permission UI)
    SHELL_PATH.get_or_init(|| RwLock::new(capture_shell_path()));

    // Initialize shell initialized flag
    SHELL_INITIALIZED.get_or_init(|| RwLock::new(false));

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



/// Get current paths info for debugging/display
pub fn get_paths_info() -> PathsInfo {
    PathsInfo {
        data_dir: data_dir().clone(),
        config_dir: config_dir().clone(),
        app_suffix: build_info::APP_SUFFIX.to_string(),
        is_alternate_build: build_info::is_alternate_build(),
    }
}

#[derive(Serialize)]
pub struct PathsInfo {
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
    pub app_suffix: String,
    pub is_alternate_build: bool,
}
