# Refresh App Index on Application Install

## Problem

The app search index (`APP_INDEX` in `app-search.rs`) is built once at startup using `OnceLock` and never refreshed. When a user installs a new application, it doesn't appear in spotlight until Anvil is restarted.

## Approach: Non-Recursive FS Watch with Long Debounce

Watch `/Applications` and `~/Applications` with `NonRecursive` mode via `notify-debouncer-mini` (already in `Cargo.toml`). Non-recursive means we only get events when a direct child is added/removed/renamed — not when files inside existing `.app` bundles are modified. This fires maybe a few times per month for most users.

Use a **leading-edge** cooldown: rebuild immediately on the first event, then ignore further events for 60 seconds. This means the user sees the new app right away, and noisy install chatter during the cooldown window is silently dropped.

### Key Design Decisions

1. **Replace `OnceLock` with `RwLock`** — `OnceLock` only allows a single write. Switch to `RwLock<Vec<IndexedApp>>` so the index can be rebuilt in-place while readers continue using the old snapshot.

2. **Non-recursive watch** — Only fires when top-level entries in `/Applications` change. Internal `.app` bundle file writes (auto-updates, etc.) do NOT trigger events. Very quiet.

3. **60-second leading-edge cooldown** — Rebuild fires immediately on the first FS event. Subsequent events within the next 60 seconds are ignored. This gives instant feedback when an app is installed, while preventing redundant rebuilds from noisy multi-step installs. We skip `notify-debouncer-mini` and use raw `notify` events with a manual `Instant`-based cooldown.

4. **Extract icons for new apps** — After rebuilding the index, diff against the previous set and call `extract_icon_if_needed` for any new entries so icons are ready by the time the user searches.

5. **No system directory watching** — `/System/Applications` and `/System/Library/CoreServices` never change at runtime. Scanned once at startup, not watched.

## Phases

- [x] Replace `OnceLock` with `RwLock` in `app-search.rs` and update all read/write sites
- [x] Extract `rebuild_app_index()` function that can be called repeatedly (builds index, swaps into `RwLock`, extracts icons for new apps)
- [x] Add non-recursive FS watcher on `/Applications` and `~/Applications` with 60s leading-edge cooldown, triggers `rebuild_app_index()` immediately on first event then ignores for 60s

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### `app-search.rs` Changes

Replace the static:
```rust
// Before
static APP_INDEX: OnceLock<Vec<IndexedApp>> = OnceLock::new();

// After
use std::sync::RwLock;
static APP_INDEX: RwLock<Vec<IndexedApp>> = RwLock::new(Vec::new());
```

Update `search_applications` to read from `RwLock`:
```rust
// Before
let Some(index) = APP_INDEX.get() else { return Vec::new(); };

// After
let index = APP_INDEX.read().unwrap();
```

New `rebuild_app_index()` function:
```rust
/// Rebuilds the app index and extracts icons for any newly discovered apps.
/// Safe to call multiple times — uses RwLock for concurrent read access.
fn rebuild_app_index() {
    let start = Instant::now();
    let new_apps = build_app_index();
    let count = new_apps.len();

    // Collect new app paths before swapping, so we can extract their icons
    let new_paths: Vec<String> = {
        let old = APP_INDEX.read().unwrap();
        let old_set: HashSet<&str> = old.iter().map(|a| a.path.as_str()).collect();
        new_apps.iter()
            .filter(|a| !old_set.contains(a.path.as_str()))
            .map(|a| a.path.clone())
            .collect()
    };

    // Swap in the new index
    *APP_INDEX.write().unwrap() = new_apps;
    tracing::info!(apps = count, new = new_paths.len(),
        duration_ms = start.elapsed().as_millis() as u64,
        "App index rebuilt");

    // Extract icons for newly discovered apps
    if !new_paths.is_empty() {
        icons::extract_icons_for_paths(&new_paths);
    }
}
```

Simplify `initialize()` to use the reusable function, then start the watcher:
```rust
pub fn initialize() {
    std::thread::spawn(|| {
        rebuild_app_index(); // Initial build
        watch_app_directories(); // Blocks forever, rebuilds on changes
    });
}

/// Watches /Applications and ~/Applications for top-level changes.
/// Blocks the calling thread. Rebuilds the index when .app entries are added/removed.
/// Uses leading-edge cooldown: fires immediately, then ignores events for 60s.
fn watch_app_directories() {
    use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event};
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
```

### `icons.rs` Addition

Add a public function to extract icons for specific paths:
```rust
/// Extracts icons for a list of app paths (called when new apps are discovered).
pub fn extract_icons_for_paths(app_paths: &[String]) {
    let Some(cache_dir) = CACHE_DIR.get() else { return; };
    for app_path in app_paths {
        extract_icon_if_needed(cache_dir, app_path);
    }
}
```

## Files Changed

- `src-tauri/Cargo.toml` — add `notify = "8"` as explicit dependency (already in lockfile transitively)
- `src-tauri/src/app-search.rs` — `OnceLock` → `RwLock`, extract `rebuild_app_index()`, add `watch_app_directories()`
- `src-tauri/src/icons.rs` — add `extract_icons_for_paths()` public function

## What This Does NOT Do

- No recursive watching — only top-level directory entries, not internal bundle files
- No polling — uses native macOS FSEvents via `notify`
- No new binary dependencies — adds `notify = "8"` as an explicit dep but it's already in the lockfile via `notify-debouncer-mini`
- No frontend changes — fully backend, transparent to the UI
