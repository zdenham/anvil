//! Application discovery and searching for the spotlight launcher.
//!
//! This module indexes installed applications once at startup and provides
//! fast in-memory search. Background services are filtered out during indexing.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::collections::HashSet;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use crate::icons;
use crate::panels::MAX_VISIBLE_RESULTS;

/// Global app index, rebuilt when applications change
static APP_INDEX: RwLock<Vec<IndexedApp>> = RwLock::new(Vec::new());

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

/// Initializes the app index and starts watching for changes.
pub fn initialize() {
    std::thread::spawn(|| {
        rebuild_app_index(); // Initial build
        watch_app_directories(); // Blocks forever, rebuilds on changes
    });
}

/// Rebuilds the app index and extracts icons for any newly discovered apps.
fn rebuild_app_index() {
    let _span = tracing::info_span!("app_search_index").entered();
    let start = Instant::now();
    let new_apps = build_app_index();
    let count = new_apps.len();

    // Collect new app paths before swapping, so we can extract their icons
    let new_paths: Vec<String> = {
        let old = APP_INDEX.read().unwrap();
        let old_set: HashSet<&str> = old.iter().map(|a| a.path.as_str()).collect();
        new_apps
            .iter()
            .filter(|a| !old_set.contains(a.path.as_str()))
            .map(|a| a.path.clone())
            .collect()
    };

    // Swap in the new index
    *APP_INDEX.write().unwrap() = new_apps;
    tracing::info!(
        apps = count,
        new = new_paths.len(),
        duration_ms = start.elapsed().as_millis() as u64,
        "App index rebuilt"
    );

    // Extract icons for newly discovered apps
    if !new_paths.is_empty() {
        icons::extract_icons_for_paths(&new_paths);
    }
}

/// Watches /Applications and ~/Applications for top-level changes.
/// Blocks the calling thread. Rebuilds the index when .app entries are added/removed.
/// Uses leading-edge cooldown: fires immediately, then ignores events for 60s.
fn watch_app_directories() {
    use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Event>();

    let mut watcher = match RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                let _ = tx.send(event);
            }
        },
        notify::Config::default(),
    ) {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!("Failed to create app directory watcher: {e}");
            return;
        }
    };

    // Watch /Applications (non-recursive — only top-level .app additions/removals)
    let _ = watcher.watch(Path::new("/Applications"), RecursiveMode::NonRecursive);

    // Watch ~/Applications if it exists
    if let Some(home) = dirs::home_dir() {
        let user_apps = home.join("Applications");
        if user_apps.exists() {
            let _ = watcher.watch(&user_apps, RecursiveMode::NonRecursive);
        }
    }

    tracing::info!("Watching /Applications for changes (non-recursive, 60s leading-edge cooldown)");

    let cooldown = Duration::from_secs(60);
    let mut last_rebuild = Instant::now() - cooldown; // Allow immediate first fire

    // Block and rebuild on first event, then ignore for cooldown period
    while rx.recv().is_ok() {
        if last_rebuild.elapsed() >= cooldown {
            tracing::info!("Applications directory changed, rebuilding index");
            rebuild_app_index();
            last_rebuild = Instant::now();
        }
        // Drain any queued events that arrived during the rebuild
        while rx.try_recv().is_ok() {}
    }
}

/// Searches for applications matching the query using the pre-built index.
#[tauri::command]
pub fn search_applications(query: String) -> Vec<AppResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let index = APP_INDEX.read().unwrap();
    if index.is_empty() {
        return Vec::new();
    }

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
