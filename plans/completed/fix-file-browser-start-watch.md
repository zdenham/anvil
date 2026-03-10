# Fix: File Browser Panel "unknown command: start_watch"

## Diagnosis

Opening the right-side file browser panel triggers a cascade of errors. There are **two root causes**, one definitively a code bug and one possibly environmental.

### Root Cause 1: `start_watch` missing from WebSocket dispatch (definite bug)

The `start_watch` command is registered as a Tauri IPC command (`src-tauri/src/file_watcher.rs:59`, `src-tauri/src/lib.rs:1014`) but is **not handled** in the WebSocket server's dispatch layer (`src-tauri/src/ws_server/dispatch_misc.rs`).

The WS dispatch handles `stop_watch` (line 222) and `list_watches` (line 227) but has no case for `start_watch`. When the frontend's `invoke()` (`src/lib/invoke.ts`) routes `start_watch` over WebSocket (since it's not in `NATIVE_COMMANDS`), the WS server falls through to the catch-all at line 260:

```rust
_ => Err(format!("unknown command: {}", cmd)),
```

This produces the error:
```
Error: unknown command: start_watch
```

**Why `stop_watch` works but `start_watch` doesn't**: Both have `_inner` variants in Rust, but `start_watch` doesn't have one. The existing `start_watch` function depends on `tauri::State<FileWatcherState>` and `AppHandle` (to get `EventBroadcaster`), which aren't available in the WS dispatch context. The WS dispatch for `stop_watch` calls `stop_watch_inner(&state.file_watcher_state, &watch_id)` directly, but there's no equivalent `start_watch_inner` to call.

### Root Cause 2: Invalid directory paths (likely consequential)

The file tree tries to list and watch paths like `/client`, `/client/shared`, `/plans` as absolute filesystem paths. These appear to be repo-relative paths (from previously expanded folders) rather than absolute paths. The root path itself also fails:

```
Failed to list root directory: Error: Failed to read directory: No such file or directory (os error 2)
```

This is likely because:
- The worktree path passed to `FileBrowserPanel` may reference a worktree that was deleted/moved
- OR the `rootPath` stored in `lastRightPanelRef` (used when toggling the panel back open, `main-window-layout.tsx:719`) is stale

The sub-directory paths (`/client`, `/plans`, etc.) were previously expanded when the panel was open, and when the panel re-mounts, `useFileTree` re-creates watches for these paths using the same (now-invalid) paths.

## Affected Files

| File | Role |
|------|------|
| `src-tauri/src/ws_server/dispatch_misc.rs` | Missing `start_watch` WS handler |
| `src-tauri/src/file_watcher.rs` | Needs `start_watch_inner` extraction |
| `src/lib/file-watcher-client.ts` | Calls `invoke("start_watch", ...)` — works fine, just hits the wrong backend |
| `src/components/file-browser/use-file-tree.ts` | Consumes watcher; will work once dispatch is fixed |

## Phases

- [x] Extract `start_watch_inner` from `start_watch` in `file_watcher.rs` (mirror `stop_watch_inner` pattern)
- [x] Add `"start_watch"` case to `dispatch_misc.rs` calling the new inner fn with `state.file_watcher_state` and `state.broadcaster`
- [x] Verify `stop_watch` and `list_watches` WS dispatch still works (no regression)
- [x] Investigate stale rootPath — existing guards sufficient (expandedPaths reset on rootPath change, root listDir error shown in UI, sub-dir watcher errors caught)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix Details

### Phase 1: Extract `start_watch_inner`

In `src-tauri/src/file_watcher.rs`, create a standalone function that accepts `FileWatcherState` + `EventBroadcaster` (or a generic emit callback) instead of `tauri::State` + `AppHandle`:

```rust
pub fn start_watch_inner(
    state: &FileWatcherState,
    broadcaster: &EventBroadcaster,
    watch_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    // Same logic as start_watch, using broadcaster directly
}
```

Then refactor the `#[tauri::command] start_watch` to call `start_watch_inner`.

### Phase 2: Add WS dispatch case

In `dispatch_misc.rs`, add alongside the existing file watcher commands:

```rust
"start_watch" => {
    let watch_id: String = extract_arg(&args, "watchId")?;
    let path: String = extract_arg(&args, "path")?;
    let recursive: bool = extract_opt_arg(&args, "recursive").unwrap_or(false);
    crate::file_watcher::start_watch_inner(
        &state.file_watcher_state,
        &state.broadcaster,
        watch_id, path, recursive,
    )?;
    Ok(serde_json::Value::Null)
}
```

### Phase 4: Stale path guard

In `use-file-tree.ts`, the root `listDir` call already sets an error state that shows `FileBrowserError`. The expanded sub-directory watchers are the noisy part. Consider clearing `expandedPaths` when `rootPath` changes (already done at line 46-51), and ensuring that on remount after toggle, previously expanded paths are validated or cleared.
