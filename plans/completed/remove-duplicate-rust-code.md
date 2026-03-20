# Remove Duplicate Rust Code After Sidecar Migration

## Summary

The Node.js sidecar now handles all "data commands" (filesystem, git, worktree metadata, threads, search, locks, misc) over WebSocket. The Rust backend still registers 130+ Tauri commands, but \~60 of them are now fully duplicated in the sidecar. The frontend's `invoke()` router (`src/lib/invoke.ts`) already prefers the WebSocket transport — Rust only serves as a fallback when the WebSocket isn't connected.

**Goal:** Remove the duplicated Rust implementations that the sidecar has replaced, shrinking the Rust surface to only what *must* be native (panels, terminals, hotkeys, clipboard, file watchers, accessibility, profiling).

---

## Analysis: What's Duplicated vs What's Rust-Only

### Fully duplicated (safe to remove from Rust)

| Rust file | Commands | Sidecar equivalent |
| --- | --- | --- |
| `filesystem.rs` | `fs_read_file`, `fs_write_file`, `fs_write_binary`, `fs_mkdir`, `fs_exists`, `fs_remove`, `fs_remove_dir_all`, `fs_move`, `fs_copy_file`, `fs_copy_directory`, `fs_list_dir`, `fs_is_git_repo`, `fs_git_worktree_add`, `fs_git_worktree_remove`, `fs_grep`, `fs_bulk_read` | `dispatch-fs.ts` |
| `git_commands.rs` | All 26 git commands (`git_fetch`, `git_diff_*`, `git_create_branch`, `git_list_worktrees`, etc.) | `dispatch-git.ts` |
| `worktree_commands.rs` | `worktree_create`, `worktree_delete`, `worktree_rename`, `worktree_touch`, `worktree_sync` | `dispatch-worktree.ts` |
| `mort_commands.rs` | `fs_get_repo_dir`, `fs_get_repo_source_path`, `fs_get_home_dir`, `fs_list_dir_names`, `lock_acquire_repo`, `lock_release_repo`, `get_paths_info`, `get_agent_types` | `dispatch-misc.ts` + `paths.ts` |
| `thread_commands.rs` | `get_thread_status`, `get_thread` | `dispatch-misc.ts` |
| `search.rs` | `search_threads` | `dispatch-misc.ts` |
| `repo_commands.rs` | `validate_repository`, `remove_repository_data` | `dispatch-misc.ts` |
| `identity.rs` (partial) | `get_github_handle` | `dispatch-misc.ts` |

### Partially duplicated (needs careful handling)

| Rust file | Notes |
| --- | --- |
| `shell.rs` | `initialize_shell_environment`, `get_shell_path`, `check_documents_access` duplicated in sidecar; `run_internal_update` may still need Rust for detached process spawning |
| `process_commands.rs` | `kill_process` duplicated; `agent_cancel` has sidecar equivalent but Rust version does SIGTERM→SIGKILL escalation — verify sidecar parity |
| Logging stubs (`web_log`, `web_log_batch`, etc.) | Frontend may still call these via Tauri IPC during WS reconnection; verify sidecar handles all log paths |

### Rust-only (must keep)

| Rust file | Reason |
| --- | --- |
| `panels.rs` | macOS NSPanel APIs — no JS equivalent |
| `terminal.rs` | PTY management — native process required |
| `clipboard.rs` / `clipboard_db.rs` | System clipboard monitoring, CGEvent simulation |
| `file_watcher.rs` | Native filesystem notify |
| `profiling.rs` | CPU/memory profiling of Rust process |
| `app-search.rs` / `icons.rs` | macOS app bundle search + icon extraction |
| `config.rs` | Onboarding, hotkey persistence |
| `menu.rs` / `tray.rs` | System tray + menu bar |
| `accessibility/` | macOS accessibility permission APIs |
| `build_info.rs` | Compile-time build metadata |
| `paths.rs` | Rust-internal path resolution |
| `lib.rs` | App setup, sidecar spawning, window management commands |

---

## Phases

- [x] Phase 1: Remove Tauri IPC fallback from `invoke.ts` for data commands

- [x] Phase 2: Delete duplicated Rust source files

- [x] Phase 3: Clean up `lib.rs` command registration and state

- [x] Phase 4: Remove dead Rust dependencies from `Cargo.toml`

- [x] Phase 5: Verify build compiles and tests pass

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Remove Tauri IPC fallback from `invoke.ts`

Currently, if the WebSocket is down, `invoke()` falls through to Tauri IPC for data commands. After this change, data commands will **only** go through WebSocket (the sidecar must be running).

**Changes:**

- In `src/lib/invoke.ts`: Remove the Tauri IPC fallback path for non-native commands (lines 279-282). If WS is down and it's not a native command, throw immediately rather than falling back to Rust.
- This makes the Rust implementations truly dead code that can be safely deleted.

**Risk mitigation:** The sidecar is already spawned before the frontend connects (health-check loop in `spawn_sidecar()`). If the sidecar crashes, the app is broken regardless since agents rely on it. The fallback was only useful during the migration period.

## Phase 2: Delete duplicated Rust source files

Delete these files entirely:

- `src-tauri/src/filesystem.rs` (\~300 lines)
- `src-tauri/src/git_commands.rs` (\~800 lines)
- `src-tauri/src/worktree_commands.rs` (\~250 lines)
- `src-tauri/src/mort_commands.rs` (\~200 lines)
- `src-tauri/src/thread_commands.rs` (\~80 lines)
- `src-tauri/src/search.rs` (\~100 lines)
- `src-tauri/src/repo_commands.rs` (\~50 lines)

Partially clean:

- `src-tauri/src/identity.rs` — Remove `get_github_handle` Tauri command if sidecar covers it. Keep any startup-time identity registration logic if it exists.
- `src-tauri/src/shell.rs` — Keep `run_internal_update` (detached process), remove `command()` helper only if nothing else in Rust uses it. Keep shell init if [terminal.rs](http://terminal.rs) depends on it.
- `src-tauri/src/process_commands.rs` — Keep `agent_cancel` if terminal/agent process management still needs it from Rust. Remove `kill_process` if only frontend called it.

**Estimated removal: \~1,800 lines of Rust code.**

## Phase 3: Clean up `lib.rs` command registration and state

- Remove all `mod` declarations for deleted files
- Remove all deleted commands from `tauri::generate_handler![]` (lines 902-1061)
- Remove any `tauri::State<>` types that only the deleted modules used (e.g., `LockManager` state if locks are fully in sidecar)
- Remove `use` imports for deleted modules
- Remove any dead helper functions (e.g., `web_log` / `web_log_batch` stubs if sidecar handles logging)
- Clean up logging stubs: `send_to_agent`, `list_connected_agents`, `get_agent_socket_path` — these are already marked as "stubs — sidecar handles agent communication"

## Phase 4: Remove dead Rust dependencies from `Cargo.toml`

After deleting the Rust code, audit `Cargo.toml` for crates that were only used by the removed modules:

- `regex` (if only used by `fs_grep` / `search_threads`)
- Any git-specific crates
- Check if `uuid` is still needed (worktree_commands used it)

Run `cargo build` to identify unused imports, then prune.

## Phase 5: Verify build compiles and tests pass

- `cargo build` — ensure Rust compiles cleanly
- `cargo clippy` — no new warnings
- `pnpm build` (frontend) — ensure TypeScript still compiles
- `pnpm test` (if applicable) — run any integration tests
- Manual smoke test: app launches, sidecar connects, basic operations work

---

## Impact

- **\~1,800 lines of Rust deleted** across 7+ files
- **Simpler maintenance** — one implementation per command instead of two
- **Faster Rust compile times** — less code to compile
- **Clearer architecture** — Rust = native OS APIs, sidecar = data operations