//! Utilities for running external commands with proper environment.
//!
//! GUI apps on macOS don't inherit the user's shell PATH, so commands like
//! git-lfs, node, pnpm etc. installed via Homebrew won't be found.
//! This module provides helpers that set up the correct PATH.

use crate::paths;
use std::process::Command;

/// Creates a Command with the user's shell PATH set.
/// Use this for any external command that might depend on tools
/// installed via Homebrew or other package managers.
///
/// # Example
/// ```ignore
/// let output = shell::command("git")
///     .args(["status"])
///     .output()?;
/// ```
pub fn command(program: &str) -> Command {
    let shell_path = paths::shell_path();
    tracing::debug!(
        program = %program,
        path_length = shell_path.len(),
        path_entries = shell_path.split(':').count(),
        "Creating command with shell PATH"
    );
    let mut cmd = Command::new(program);
    cmd.env("PATH", shell_path);
    cmd
}

/// Gets the shell PATH captured at startup.
/// This is the user's actual PATH from their login shell.
#[tauri::command]
pub fn get_shell_path() -> String {
    let path = paths::shell_path();
    tracing::info!(
        path_length = path.len(),
        path_entries = path.split(':').count(),
        path_preview = %path.chars().take(150).collect::<String>(),
        "get_shell_path called"
    );
    path.to_string()
}

/// Finds the full path to a binary using the captured shell PATH.
/// Returns None if the binary is not found.
#[tauri::command]
pub fn which_binary(name: String) -> Option<String> {
    tracing::info!(binary_name = %name, "which_binary: searching for binary");

    let path_var = paths::shell_path();
    let path_entries: Vec<&str> = path_var.split(':').collect();
    tracing::debug!(
        path_entries_count = path_entries.len(),
        "which_binary: searching through PATH entries"
    );

    for (i, dir) in path_entries.iter().enumerate() {
        let candidate = std::path::Path::new(dir).join(&name);
        if candidate.exists() && candidate.is_file() {
            tracing::info!(
                binary_name = %name,
                found_at = %candidate.display(),
                path_entry_index = i,
                "which_binary: FOUND"
            );
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    tracing::warn!(
        binary_name = %name,
        path_entries_searched = path_entries.len(),
        "which_binary: NOT FOUND in any PATH entry"
    );

    // Log the first 10 PATH entries for debugging
    for (i, entry) in path_entries.iter().take(10).enumerate() {
        tracing::debug!(index = i, entry = %entry, "which_binary: PATH entry checked");
    }

    None
}

/// Runs the internal update script in the background.
/// The script downloads a new version and restarts the app, so it must be detached.
#[tauri::command]
pub fn run_internal_update() -> Result<(), String> {
    use std::process::Stdio;

    tracing::info!("run_internal_update: Starting update process");

    let script_url = "https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh";
    let shell_command = format!("curl -sL {} | bash &", script_url);

    tracing::info!(
        script_url = %script_url,
        shell_command = %shell_command,
        "run_internal_update: Preparing to execute update command"
    );

    // Use sh -c to run the pipeline, with & to background the entire operation
    // The script will quit and restart the app, so we don't wait for it
    tracing::debug!("run_internal_update: Spawning sh process with backgrounded curl|bash pipeline");

    let spawn_result = std::process::Command::new("sh")
        .args(["-c", &shell_command])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    match spawn_result {
        Ok(child) => {
            tracing::info!(
                pid = %child.id(),
                "run_internal_update: Successfully spawned update process"
            );
            tracing::info!("run_internal_update: Update script started in background - app should restart shortly");
            Ok(())
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                error_kind = ?e.kind(),
                "run_internal_update: Failed to spawn update process"
            );
            Err(format!("Failed to start update: {}", e))
        }
    }
}
