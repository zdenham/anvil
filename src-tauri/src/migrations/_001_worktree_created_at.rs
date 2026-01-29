//! Migration v1: Add createdAt field to worktrees
//!
//! For existing worktrees without createdAt (null or missing), set it to lastAccessedAt.

use crate::paths;
use serde_json::Value;
use std::fs;

pub fn run() -> Result<(), String> {
    tracing::info!("Running migration v1: worktree createdAt");

    let repos_dir = paths::repositories_dir();
    if !repos_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&repos_dir).map_err(|e| e.to_string())?.flatten() {
        let settings_path = entry.path().join("settings.json");
        if settings_path.exists() {
            if let Err(e) = migrate_settings(&settings_path) {
                tracing::warn!(path = %settings_path.display(), error = %e, "Migration failed");
            }
        }
    }

    Ok(())
}

fn migrate_settings(path: &std::path::Path) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut settings: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut modified = false;

    if let Some(worktrees) = settings.get_mut("worktrees").and_then(|w| w.as_array_mut()) {
        for wt in worktrees.iter_mut().filter_map(|w| w.as_object_mut()) {
            // Check if createdAt is missing OR null
            let needs_migration = match wt.get("createdAt") {
                None => true,
                Some(Value::Null) => true,
                _ => false,
            };

            if needs_migration {
                let fallback = wt
                    .get("lastAccessedAt")
                    .and_then(|v| v.as_i64())
                    .unwrap_or_else(|| {
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as i64
                    });

                wt.insert("createdAt".to_string(), Value::Number(fallback.into()));
                modified = true;
            }
        }
    }

    if modified {
        let new_content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        fs::write(path, new_content).map_err(|e| e.to_string())?;
        tracing::info!(path = %path.display(), "Migrated worktree createdAt");
    }

    Ok(())
}
