//! Application discovery and searching for the spotlight launcher.
//!
//! This module indexes installed applications once at startup and provides
//! fast in-memory search. Background services are filtered out during indexing.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Instant;

use crate::icons;
use crate::panels::MAX_VISIBLE_RESULTS;

/// Global app index, built once at startup
static APP_INDEX: OnceLock<Vec<IndexedApp>> = OnceLock::new();

/// An indexed application entry (stored in memory)
#[derive(Debug, Clone)]
struct IndexedApp {
    name: String,
    name_lower: String, // Pre-computed for fast search
    path: String,
}

/// Represents an application search result (returned to frontend)
#[derive(Debug, Clone, Serialize)]
pub struct AppResult {
    pub name: String,
    pub path: String,
    pub icon_path: Option<String>,
}

/// Relevant fields from an app's Info.plist for filtering
#[derive(Debug, Deserialize, Default)]
struct AppInfoPlist {
    #[serde(rename = "LSUIElement", default)]
    ls_ui_element: Option<bool>,
    #[serde(rename = "LSBackgroundOnly", default)]
    ls_background_only: Option<bool>,
}

/// Initializes the app index. Should be called once during app setup.
pub fn initialize() {
    // Build index in background to not block startup
    std::thread::spawn(|| {
        let start = Instant::now();
        let apps = build_app_index();
        let count = apps.len();
        let _ = APP_INDEX.set(apps);
        tracing::info!(apps = count, duration_ms = start.elapsed().as_millis() as u64, "App index built");
    });
}

/// Searches for applications matching the query using the pre-built index.
#[tauri::command]
pub fn search_applications(query: String) -> Vec<AppResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let Some(index) = APP_INDEX.get() else {
        // Index not ready yet, return empty
        return Vec::new();
    };

    let query_lower = query.to_lowercase();

    let mut results: Vec<AppResult> = index
        .iter()
        .filter(|app| app.name_lower.contains(&query_lower))
        .map(|app| AppResult {
            name: app.name.clone(),
            path: app.path.clone(),
            icon_path: icons::get_cached_icon_path(&app.path),
        })
        .collect();

    // Sort by relevance (exact prefix match first, then alphabetically)
    results.sort_by(|a, b| {
        let a_starts = a.name.to_lowercase().starts_with(&query_lower);
        let b_starts = b.name.to_lowercase().starts_with(&query_lower);
        match (a_starts, b_starts) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    results.truncate(MAX_VISIBLE_RESULTS);
    results
}

/// Opens an application by its path
#[tauri::command]
pub fn open_application(path: String) -> Result<(), String> {
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open application: {}", e))?;
    Ok(())
}

/// Opens a directory in the specified application.
/// If the directory is already open in that app, focuses the existing window.
/// Defaults to "Cursor" if no app is specified.
#[tauri::command]
pub fn open_directory_in_app(path: String, app: Option<String>) -> Result<(), String> {
    let app_name = app.unwrap_or_else(|| "Cursor".to_string());
    Command::new("open")
        .args(["-a", &app_name, &path])
        .spawn()
        .map_err(|e| format!("Failed to open directory in {}: {}", app_name, e))?;
    Ok(())
}

/// Builds the complete app index by scanning all app directories.
fn build_app_index() -> Vec<IndexedApp> {
    let mut apps = Vec::new();

    let app_dirs = [
        "/Applications",
        "/System/Applications",
        "/System/Applications/Utilities",
        "/System/Library/CoreServices",
    ];

    for app_dir in app_dirs {
        index_apps_in_directory(app_dir, &mut apps);
    }

    // ~/Applications
    if let Some(home) = dirs::home_dir() {
        let user_apps = home.join("Applications");
        index_apps_in_directory(&user_apps, &mut apps);
    }

    apps
}

/// Indexes all user-facing apps in a directory.
fn index_apps_in_directory<P: AsRef<Path>>(app_dir: P, apps: &mut Vec<IndexedApp>) {
    let Ok(entries) = fs::read_dir(app_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().map_or(false, |ext| ext == "app") {
            continue;
        }

        // Skip non-user-facing apps (background agents, UI elements)
        if !is_user_facing_app(&path) {
            continue;
        }

        let Some(name) = path.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };

        apps.push(IndexedApp {
            name: name.to_string(),
            name_lower: name.to_lowercase(),
            path: path.to_string_lossy().to_string(),
        });
    }
}

/// Checks if an app is user-facing by reading its Info.plist.
fn is_user_facing_app(app_path: &Path) -> bool {
    let plist_path = app_path.join("Contents/Info.plist");

    let Some(plist) = read_app_plist(&plist_path) else {
        return true; // Assume user-facing if we can't read plist
    };

    // Filter out background-only apps and UI element apps
    if plist.ls_background_only == Some(true) || plist.ls_ui_element == Some(true) {
        return false;
    }

    true
}

/// Reads and parses an app's Info.plist directly using the plist crate.
fn read_app_plist(plist_path: &Path) -> Option<AppInfoPlist> {
    plist::from_file(plist_path).ok()
}
