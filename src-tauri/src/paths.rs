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

/// Run the login shell to capture the user's PATH and trigger Documents permission.
/// This explicitly accesses ~/Documents to trigger the macOS permission prompt.
/// Should be called when user clicks "Grant Documents Access" in the UI.
/// Returns true if a valid PATH was captured from the shell.
pub fn run_login_shell_initialization() -> bool {
    tracing::info!("═══════════════════════════════════════════════════════════════");
    tracing::info!("run_login_shell_initialization: START");
    tracing::info!("═══════════════════════════════════════════════════════════════");

    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    tracing::info!(shell = %shell, "Detected user shell from $SHELL env var");

    // First, explicitly access ~/Documents to trigger macOS permission prompt
    // This is the critical step - without this, the permission dialog won't appear
    tracing::info!("Checking Documents folder access (may trigger macOS permission prompt)...");
    let docs_access = check_documents_access();
    tracing::info!(docs_access = docs_access, "Documents access check completed");

    // Log the command we're about to run
    // Use -i -l to source both .zprofile (login) and .zshrc (interactive)
    // This ensures we capture PATH from version managers like nvm that initialize in .zshrc
    let shell_cmd = format!("{} -i -l -c \"echo $PATH\"", shell);
    tracing::info!(command = %shell_cmd, "Executing interactive login shell command to capture PATH");

    let start_time = std::time::Instant::now();
    let result = Command::new(&shell).args(["-i", "-l", "-c", "echo $PATH"]).output();
    let elapsed = start_time.elapsed();

    match result {
        Ok(output) => {
            tracing::info!(
                elapsed_ms = elapsed.as_millis(),
                exit_code = ?output.status.code(),
                success = output.status.success(),
                stdout_len = output.stdout.len(),
                stderr_len = output.stderr.len(),
                "Login shell command completed"
            );

            // Log stderr if there's any content (could indicate shell errors)
            if !output.stderr.is_empty() {
                if let Ok(stderr_str) = String::from_utf8(output.stderr.clone()) {
                    tracing::warn!(stderr = %stderr_str, "Login shell produced stderr output");
                }
            }

            if output.status.success() {
                match String::from_utf8(output.stdout) {
                    Ok(path) => {
                        let path = path.trim();
                        let path_entries: Vec<&str> = path.split(':').collect();
                        tracing::info!(
                            path_length = path.len(),
                            path_entries_count = path_entries.len(),
                            path_preview = %path.chars().take(200).collect::<String>(),
                            "Parsed PATH from login shell output"
                        );

                        // Log first 10 path entries for debugging
                        for (i, entry) in path_entries.iter().take(10).enumerate() {
                            tracing::debug!(index = i, entry = %entry, "PATH entry");
                        }

                        if !path.is_empty() {
                            tracing::info!(shell = %shell, "Successfully captured PATH from login shell");

                            // Update the shell path
                            if let Some(lock) = SHELL_PATH.get() {
                                match lock.write() {
                                    Ok(mut guard) => {
                                        *guard = path.to_string();
                                        tracing::info!("Updated SHELL_PATH global with captured PATH");
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to acquire write lock on SHELL_PATH");
                                    }
                                }
                            } else {
                                tracing::error!("SHELL_PATH OnceLock not initialized");
                            }

                            // Mark as initialized
                            if let Some(lock) = SHELL_INITIALIZED.get() {
                                match lock.write() {
                                    Ok(mut guard) => {
                                        *guard = true;
                                        tracing::info!("Marked shell as initialized");
                                    }
                                    Err(e) => {
                                        tracing::error!(error = %e, "Failed to acquire write lock on SHELL_INITIALIZED");
                                    }
                                }
                            } else {
                                tracing::error!("SHELL_INITIALIZED OnceLock not initialized");
                            }

                            tracing::info!("═══════════════════════════════════════════════════════════════");
                            tracing::info!("run_login_shell_initialization: SUCCESS");
                            tracing::info!("═══════════════════════════════════════════════════════════════");
                            return true;
                        } else {
                            tracing::warn!("Login shell returned empty PATH");
                        }
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to parse PATH as UTF-8");
                    }
                }
            } else {
                tracing::warn!(
                    exit_code = ?output.status.code(),
                    "Login shell command exited with non-zero status"
                );
            }
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                error_kind = ?e.kind(),
                shell = %shell,
                elapsed_ms = elapsed.as_millis(),
                "Failed to execute login shell command"
            );
        }
    }

    tracing::warn!(shell = %shell, "Failed to capture PATH from login shell, marking as initialized anyway");

    // Still mark as initialized (user attempted it)
    if let Some(lock) = SHELL_INITIALIZED.get() {
        match lock.write() {
            Ok(mut guard) => {
                *guard = true;
                tracing::info!("Marked shell as initialized (fallback)");
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to acquire write lock on SHELL_INITIALIZED");
            }
        }
    }

    tracing::info!("═══════════════════════════════════════════════════════════════");
    tracing::info!("run_login_shell_initialization: FAILED (using fallback PATH)");
    tracing::info!("═══════════════════════════════════════════════════════════════");
    false
}

/// Check if shell initialization has been run.
pub fn is_shell_initialized() -> bool {
    let result = SHELL_INITIALIZED
        .get()
        .and_then(|lock| lock.read().ok())
        .map(|guard| *guard)
        .unwrap_or(false);
    tracing::debug!(is_initialized = result, "is_shell_initialized check");
    result
}

/// Check if the app has Documents folder access.
/// This attempts to list ~/Documents to see if we have permission.
/// Returns true if we can access the folder, false otherwise.
///
/// WARNING: This WILL trigger the macOS permission prompt if Documents access
/// hasn't been determined yet. Do NOT call this proactively on UI mount.
/// Use `is_shell_initialized()` to check if permission has been granted previously.
pub fn check_documents_access() -> bool {
    tracing::info!("check_documents_access: START");

    if let Some(home) = dirs::home_dir() {
        let documents = home.join("Documents");
        tracing::info!(path = %documents.display(), "Attempting to read Documents directory");

        // Try to read the directory - if we don't have permission, this will fail
        match std::fs::read_dir(&documents) {
            Ok(entries) => {
                // Count entries to verify we actually have access
                let count = entries.count();
                tracing::info!(
                    path = %documents.display(),
                    entry_count = count,
                    "Documents access check: GRANTED"
                );
                true
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    error_kind = ?e.kind(),
                    path = %documents.display(),
                    "Documents access check: DENIED"
                );
                false
            }
        }
    } else {
        tracing::error!("Could not determine home directory for Documents check");
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
