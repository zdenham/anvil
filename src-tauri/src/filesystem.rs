//! Generic filesystem operations exposed as Tauri commands.
//!
//! Provides low-level file and directory operations for use by TypeScript clients.
//! Keeps Rust thin - business logic stays in TypeScript.

use crate::shell;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Directory entry metadata returned by list_dir
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
}

/// Writes binary content (base64-encoded) to a file, creating parent directories if needed
#[tauri::command]
pub fn fs_write_binary(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    fs::write(path, bytes).map_err(|e| format!("Failed to write binary file: {}", e))
}

/// Writes text content to a file, creating parent directories if needed
#[tauri::command]
pub fn fs_write_file(path: String, contents: String) -> Result<(), String> {
    let path = Path::new(&path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    fs::write(path, contents).map_err(|e| format!("Failed to write file: {}", e))
}

/// Reads text content from a file (standalone, callable from WS server).
pub fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Reads text content from a file
#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    read_file(&path)
}

/// Creates a directory and all parent directories
#[tauri::command]
pub fn fs_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

/// Checks if a path exists (standalone, callable from WS server).
pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// Checks if a path exists
#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    exists(&path)
}

/// Removes a file or empty directory
#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let path = Path::new(&path);

    if path.is_dir() {
        fs::remove_dir(path).map_err(|e| format!("Failed to remove directory: {}", e))
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to remove file: {}", e))
    }
}

/// Removes a directory and all its contents recursively
#[tauri::command]
pub fn fs_remove_dir_all(path: String) -> Result<(), String> {
    fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove directory: {}", e))
}

/// Lists directory contents with metadata (standalone, callable from WS server).
pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }

    Ok(result)
}

/// Lists directory contents with metadata
#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    list_dir(&path)
}

/// Moves or renames a file or directory
#[tauri::command]
pub fn fs_move(from: String, to: String) -> Result<(), String> {
    let to_path = Path::new(&to);

    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    fs::rename(&from, &to).map_err(|e| format!("Failed to move: {}", e))
}

/// Copies a single file
#[tauri::command]
pub fn fs_copy_file(from: String, to: String) -> Result<(), String> {
    let to_path = Path::new(&to);

    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    fs::copy(&from, &to)
        .map_err(|e| format!("Failed to copy file: {}", e))
        .map(|_| ())
}

/// Recursively copies an entire directory tree
#[tauri::command]
pub fn fs_copy_directory(from: String, to: String) -> Result<(), String> {
    copy_dir_recursive(Path::new(&from), Path::new(&to))
}

/// Internal recursive directory copy implementation
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Failed to create directory {:?}: {}", to, e))?;

    let entries =
        fs::read_dir(from).map_err(|e| format!("Failed to read directory {:?}: {}", from, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = to.join(entry.file_name());

        // Get metadata without following symlinks to detect symlinks
        let metadata = match fs::symlink_metadata(&src_path) {
            Ok(m) => m,
            Err(e) => {
                // Skip entries we can't stat (e.g., permission denied)
                tracing::warn!(path = ?src_path, error = %e, "Skipping entry, could not read metadata");
                continue;
            }
        };

        if metadata.is_symlink() {
            // Copy symlink as symlink (preserve the link)
            match fs::read_link(&src_path) {
                Ok(target) => {
                    // Remove existing symlink/file at destination if present
                    let _ = fs::remove_file(&dst_path);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::symlink;
                        if let Err(e) = symlink(&target, &dst_path) {
                            tracing::warn!(dst = ?dst_path, target = ?target, error = %e, "Failed to create symlink");
                        }
                    }
                }
                Err(e) => {
                    // Broken or unreadable symlink - skip it
                    tracing::warn!(path = ?src_path, error = %e, "Skipping broken symlink");
                }
            }
        } else if metadata.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if metadata.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", src_path, dst_path, e))?;
        }
        // Skip other file types (sockets, devices, etc.)
    }

    Ok(())
}

/// Result of a grep match across files
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub path: String,
    pub line: String,
    pub line_number: usize,
}

/// Searches files matching a glob pattern under a directory for lines matching a regex.
/// All I/O happens in Rust — single IPC call for searching many files.
pub fn grep(dir: &str, pattern: &str, file_glob: &str) -> Result<Vec<GrepMatch>, String> {
    let re = regex::Regex::new(pattern).map_err(|e| format!("Invalid regex: {}", e))?;
    let base = Path::new(dir);
    let mut results = Vec::new();

    let entries = fs::read_dir(base).map_err(|e| format!("Failed to read dir: {}", e))?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let file_path = entry.path().join(file_glob);
        if !file_path.exists() {
            continue;
        }

        if let Ok(contents) = fs::read_to_string(&file_path) {
            for (i, line) in contents.lines().enumerate() {
                if re.is_match(line) {
                    results.push(GrepMatch {
                        path: file_path.to_string_lossy().to_string(),
                        line: line.to_string(),
                        line_number: i + 1,
                    });
                }
            }
        }
    }

    Ok(results)
}

/// Searches files matching a glob pattern under a directory for lines matching a regex.
#[tauri::command]
pub fn fs_grep(dir: String, pattern: String, file_glob: String) -> Result<Vec<GrepMatch>, String> {
    grep(&dir, &pattern, &file_glob)
}

/// Reads multiple files in a single IPC call.
/// Returns contents in the same order as paths. Null for files that fail to read.
pub fn bulk_read(paths: &[String]) -> Vec<Option<String>> {
    paths
        .iter()
        .map(|p| fs::read_to_string(p).ok())
        .collect()
}

/// Reads multiple files in a single IPC call.
#[tauri::command]
pub fn fs_bulk_read(paths: Vec<String>) -> Vec<Option<String>> {
    bulk_read(&paths)
}

/// Checks if a directory is a git repository
#[tauri::command]
pub fn fs_is_git_repo(path: String) -> bool {
    let git_dir = Path::new(&path).join(".git");
    git_dir.exists()
}

/// Creates a git worktree at the specified path.
/// Much faster than copying for git repositories - shares the .git directory.
#[tauri::command]
pub fn fs_git_worktree_add(repo_path: String, worktree_path: String) -> Result<(), String> {
    // Prune stale worktrees first (handles case where directory was deleted but still registered)
    let _ = shell::command("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("worktree")
        .arg("prune")
        .output();

    // Create a detached worktree at HEAD, using --force to override stale registrations
    let output = shell::command("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("worktree")
        .arg("add")
        .arg("--detach")
        .arg("--force")
        .arg(&worktree_path)
        .arg("HEAD")
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree add failed: {}", stderr));
    }

    Ok(())
}

/// Removes a git worktree
#[tauri::command]
pub fn fs_git_worktree_remove(repo_path: String, worktree_path: String) -> Result<(), String> {
    let output = shell::command("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git worktree remove failed: {}", stderr));
    }

    Ok(())
}
