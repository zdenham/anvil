# 02 — Rust File Watcher Module

**Parallel track B** — no dependencies on other sub-plans. Can run simultaneously with 01 and 03.

See [decisions.md](./decisions.md) for rationale on custom `notify`-based watcher vs `tauri-plugin-fs`, debounce strategy, and manual refresh fallback.

## Phases

- [ ] Add `notify-debouncer-mini` dependency and create `file_watcher.rs` module
- [ ] Register file watcher state and commands in `lib.rs`
- [ ] Create frontend TypeScript client

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Rust file watcher module

### 1a. Add dependency

**File: `src-tauri/Cargo.toml`**

Add to the existing `[dependencies]` section (after `fs2 = "0.4"`):

```toml
notify-debouncer-mini = "0.7"
```

This crate wraps `notify` v8 and provides 200ms debounce out of the box. No need to add `notify` separately — `notify-debouncer-mini` re-exports what we need. This fulfills the "Rust-side debounce — 200ms buffer" decision without us writing custom debounce logic.

### 1b. New module

**New file: `src-tauri/src/file_watcher.rs`**

Follow the patterns in `terminal.rs` for state management: `Arc<Mutex<Manager>>` type alias, `create_*_state()` constructor, `cleanup_all()` for shutdown.

**Target: ~100 lines.** Keep it thin — just plumbing between `notify-debouncer-mini` and Tauri events.

#### Struct layout

```rust
use notify_debouncer_mini::{new_debouncer, Debouncer, DebounceEventResult};
use notify_debouncer_mini::notify::RecursiveMode;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Event payload emitted to frontend when a watched directory changes.
/// No path details — the frontend just re-reads the directory.
#[derive(Clone, Serialize)]
struct FileWatcherEvent {
    #[serde(rename = "watchId")]
    watch_id: String,
}

/// An active watch session. Dropping this stops the watcher automatically
/// because `Debouncer` cleans up on drop.
struct WatchSession {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

/// Manages all active file watcher sessions.
pub struct FileWatcherManager {
    sessions: HashMap<String, WatchSession>,
}
```

#### Manager implementation

```rust
impl FileWatcherManager {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Kill all watchers (used on app exit).
    pub fn cleanup_all(&mut self) {
        let count = self.sessions.len();
        self.sessions.clear(); // Debouncer stops on drop
        tracing::info!(count, "Cleaned up all file watchers");
    }
}

impl Default for FileWatcherManager {
    fn default() -> Self {
        Self::new()
    }
}
```

#### State type and constructor

Match the `terminal.rs` pattern exactly:

```rust
/// Thread-safe state for file watcher management.
pub type FileWatcherState = Arc<Mutex<FileWatcherManager>>;

/// Creates a new FileWatcherState for use with Tauri's state management.
pub fn create_file_watcher_state() -> FileWatcherState {
    Arc::new(Mutex::new(FileWatcherManager::new()))
}
```

#### Three Tauri commands

**`start_watch`** — creates a debounced watcher for a directory, emits `file-watcher:changed` events:

```rust
#[tauri::command]
pub fn start_watch(
    state: tauri::State<'_, FileWatcherState>,
    app: AppHandle,
    watch_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();

    // Prevent duplicate watches
    if manager.sessions.contains_key(&watch_id) {
        tracing::warn!(watch_id = %watch_id, "Watch already exists, stopping old one first");
        manager.sessions.remove(&watch_id);
    }

    let event_watch_id = watch_id.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(200),
        move |result: DebounceEventResult| {
            match result {
                Ok(events) if !events.is_empty() => {
                    let _ = app.emit(
                        "file-watcher:changed",
                        FileWatcherEvent { watch_id: event_watch_id.clone() },
                    );
                }
                Err(e) => {
                    tracing::warn!(error = %e, "File watcher error");
                }
                _ => {} // Empty events batch, ignore
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };

    debouncer
        .watcher()
        .watch(Path::new(&path), mode)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    tracing::info!(watch_id = %watch_id, path = %path, recursive, "Started file watch");
    manager.sessions.insert(watch_id, WatchSession { _debouncer: debouncer });
    Ok(())
}
```

> **Note on `app` ownership:** The `AppHandle` is moved into the debouncer closure. This is fine because `AppHandle` is `Clone` and Tauri provides a fresh one per command invocation. The closure must own the handle because `new_debouncer` requires `'static` lifetime.

**`stop_watch`** — tears down a specific watcher (Debouncer stops on drop):

```rust
#[tauri::command]
pub fn stop_watch(
    state: tauri::State<'_, FileWatcherState>,
    watch_id: String,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();

    if manager.sessions.remove(&watch_id).is_some() {
        tracing::info!(watch_id = %watch_id, "Stopped file watch");
    } else {
        tracing::debug!(watch_id = %watch_id, "Stop requested for unknown watch (already stopped?)");
    }

    Ok(())
}
```

**`list_watches`** — returns active watch IDs (diagnostic):

```rust
#[tauri::command]
pub fn list_watches(
    state: tauri::State<'_, FileWatcherState>,
) -> Vec<String> {
    let manager = state.lock().unwrap();
    manager.sessions.keys().cloned().collect()
}
```

#### Event name

Use `file-watcher:changed` (not `file-watcher:event`) to be descriptive, matching the terminal pattern of `terminal:output`, `terminal:exit`, `terminal:killed`.

---

## Phase 2: Register in lib.rs

**File: `src-tauri/src/lib.rs`**

Three changes, matching existing patterns exactly:

### 2a. Add module declaration

Add `mod file_watcher;` to the module list (after `mod config;`):

```rust
mod file_watcher;
```

### 2b. Register state in builder chain

Add `.manage()` call in the builder chain (after the `terminal::create_terminal_state()` line):

```rust
.manage(file_watcher::create_file_watcher_state())
```

### 2c. Register commands in invoke_handler

Add to the `tauri::generate_handler!` list (after the terminal commands block):

```rust
// File watcher commands
file_watcher::start_watch,
file_watcher::stop_watch,
file_watcher::list_watches,
```

### 2d. Add cleanup in RunEvent::Exit

Add to the `RunEvent::Exit` arm (after the terminal cleanup block):

```rust
// Stop all file watchers on exit
if let Some(watcher_state) = app_handle.try_state::<file_watcher::FileWatcherState>() {
    tracing::info!("Stopping all file watchers on exit");
    if let Ok(mut manager) = watcher_state.lock() {
        manager.cleanup_all();
    }
}
```

This follows the exact pattern used for terminal cleanup: `try_state` (not `state`) to avoid panic if state was never registered, and `lock()` with `if let Ok` to handle poisoned mutex gracefully.

No capability permissions needed — our custom commands don't go through Tauri's fs scoping system.

---

## Phase 3: Frontend TypeScript client

**New file: `src/lib/file-watcher-client.ts`**

Thin wrapper around Tauri commands. Follows the object-literal pattern from `tauri-commands.ts`. Uses typed payload (no `any` casts). Uses `logger` per coding guidelines.

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "@/lib/logger-client";

/** Payload shape for file-watcher:changed events from Rust */
interface FileWatcherEvent {
  watchId: string;
}

export const fileWatcherClient = {
  /**
   * Start watching a directory for changes.
   * Events are debounced (200ms) on the Rust side.
   */
  async startWatch(
    watchId: string,
    path: string,
    recursive = false,
  ): Promise<void> {
    logger.debug("[file-watcher] Starting watch:", watchId, path);
    await invoke("start_watch", { watchId, path, recursive });
  },

  /**
   * Stop watching a directory. Safe to call if already stopped.
   */
  async stopWatch(watchId: string): Promise<void> {
    logger.debug("[file-watcher] Stopping watch:", watchId);
    await invoke("stop_watch", { watchId });
  },

  /**
   * Listen for change events on a specific watch.
   * Returns an unlisten function — call it to unsubscribe.
   * The callback receives no arguments; the consumer should re-read
   * the directory contents when called.
   */
  onChanged(
    watchId: string,
    callback: () => void,
  ): Promise<UnlistenFn> {
    return listen<FileWatcherEvent>("file-watcher:changed", (event) => {
      if (event.payload.watchId === watchId) {
        callback();
      }
    });
  },
};
```

**Key differences from the old plan:**
- `FileWatcherEvent` interface replaces `as any` cast (coding guideline: strong types, avoid `any` or casts).
- `listen<FileWatcherEvent>` generic parameter gives type-safe payload access.
- `logger` import replaces silent operation (coding guideline: never `console.log`, use logger).
- Method renamed from `onEvent` to `onChanged` to match the event name `file-watcher:changed`.

---

## Files

| File | Action |
|------|--------|
| `src-tauri/Cargo.toml` | Modify — add `notify-debouncer-mini = "0.7"` |
| `src-tauri/src/file_watcher.rs` | **New** — file watcher module (~100 lines) |
| `src-tauri/src/lib.rs` | Modify — add module + state + commands + cleanup |
| `src/lib/file-watcher-client.ts` | **New** — TypeScript client (~40 lines) |
