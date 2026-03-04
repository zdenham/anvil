# WebSocket Transport Layer & Browser-Based Development

## Context

Mort is a Tauri app where the frontend communicates with a Rust backend via `invoke()` IPC. This couples frontend development to the Tauri build cycle — every Rust change requires a recompile, and the UI can only run inside the WKWebView.

The goal: **decouple the transport layer** so the frontend can run in any browser (Chrome, Playwright) while still talking to the real Rust backend. This enables:
- Developing the frontend in Chrome with devtools (no Tauri rebuild for UI changes)
- E2E testing with Playwright against the real backend
- Faster iteration on frontend-only work

## Architecture

### Current: Tauri IPC Only

```
WKWebView (only option)
    |
    v  invoke("fs_read_file", { path })
Tauri IPC (postMessage bridge)
    |
    v  #[tauri::command]
Rust Backend
```

### Proposed: WebSocket-First with Tauri Fallback

```
Chrome / Playwright / WKWebView (any browser)
    |
    v  invoke("fs_read_file", { path })
Transport Layer (src/lib/invoke.ts)
    |
    ├── Data commands (~94) ──→ WebSocket ──→ WS Server (Rust)
    │                                            |
    │                                            v
    │                                     Command handlers
    │                                     (same functions)
    │
    └── Native commands (~26) ──→ Tauri IPC (if in WebView)
                                  or mock/no-op (if in browser)
```

### Command Classification

**Data commands** (~94, route over WebSocket):
- Filesystem: `fs_read_file`, `fs_write_file`, `fs_list_dir`, etc. (12)
- Git: `git_diff_files`, `git_list_mort_branches`, `git_grep`, etc. (25+)
- Threads: `get_thread_status`, `get_thread`, `search_threads` (3)
- Locks: `lock_acquire_repo`, `lock_release_repo` (2)
- Agent hub: `send_to_agent`, `list_connected_agents`, `get_agent_socket_path` (3)
- Terminal PTY: `spawn_terminal`, `write_terminal`, `resize_terminal`, `kill_terminal` (6)
- Worktree: `worktree_create`, `worktree_delete`, `worktree_rename`, etc. (5)
- Paths/repo: `get_paths_info`, `validate_repository`, `get_agent_types` (8+)
- Search: `grep`, `search_threads` (2)
- Shell: `initialize_shell_environment`, `is_shell_initialized` (3)
- Logging: `web_log`, `web_log_batch` (2)
- Process: `kill_process` (1)
- Updates: `run_internal_update` (1)
- Profiling: `capture_cpu_profile`, `get_process_memory`, etc. (4)
- Identity: `get_github_handle` (1)

These are pure I/O or state operations. They don't need `AppHandle` or `Window` — they need filesystem access, git CLI, shared state (`AgentHub`, `LockManager`, `TerminalManager`), and that's it.

**Native commands** (~26, require Tauri when in WebView, mock in browser):
- Window: `show_main_window`, `hide_main_window`, `show_main_window_with_view`
- Panel: `open_control_panel`, `hide_control_panel`, `show_control_panel`, `pin_control_panel`, `is_panel_visible`, `is_any_panel_visible`, etc.
- Spotlight: `show_spotlight`, `hide_spotlight`, `resize_spotlight`
- Hotkeys: `register_hotkey`, `save_hotkey`, `get_saved_hotkey`, etc.
- Accessibility: `check_accessibility_permission`, `request_accessibility_permission`, etc.
- Clipboard: `get_clipboard_history`, `paste_clipboard_entry`, etc.
- Error panel: `show_error_panel`, `hide_error_panel`
- App search: `search_applications`, `open_application`

These need `AppHandle` or native macOS APIs. In browser context they should no-op or return sensible defaults.

**Tauri-specific APIs** (not commands, handled separately):
- `getCurrentWindow()` — mock with a no-op window stub in browser
- `convertFileSrc()` — replace with HTTP URL to a static file server (Rust side serves files)
- `getVersion()` — return from WS handshake or hardcode in dev
- `LogicalSize` — mock, irrelevant outside native window
- `resolveResource()`, `join()` — polyfill with path utilities

### Event Transport

Events follow the same dual-transport pattern:

| Event type | Tauri WebView | Browser |
|---|---|---|
| Agent messages (`agent:message`) | Tauri event | WS push message |
| Terminal output (`terminal:output`) | Tauri event | WS push message |
| File watcher (`file-watcher:changed`) | Tauri event | WS push message |
| Panel visibility (`panel-shown`, etc.) | Tauri event | Mock/ignore |
| Cross-window sync (`app:*` via event-bridge) | Tauri emit | N/A (single window) |

The WS connection is bidirectional, so server-push events map naturally.

### Tauri Detection

```typescript
// src/lib/runtime.ts
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

This is already the standard pattern — `@tauri-apps/api/core` checks this internally.

## Performance

| | Tauri IPC | WebSocket (localhost) |
|---|---|---|
| Round-trip | ~0.1-0.5ms | ~0.5-2ms |
| Serialization | JSON | JSON |

**Not meaningful for our workload.** Commands are I/O-bound (`git_diff` ~50ms, `fs_read` ~1-10ms). The 1ms transport difference is noise. The WebSocket path will feel identical.

## Rust-Side WebSocket Server

### Approach

Add a WebSocket server to the Tauri binary using `tokio-tungstenite` or `axum`. It binds to `localhost:9600` (fixed convention, no discovery needed) and handles the same command functions that `#[tauri::command]` handlers call today.

**Key insight**: the actual business logic (reading files, running git, managing locks) doesn't live in the command handlers — it can be extracted into plain functions that both the Tauri command handlers and the WS server call.

```rust
// Today: tightly coupled to Tauri
#[tauri::command]
fn fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// After: shared logic, dual entry point
fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_file(path: String) -> Result<String, String> {
    read_file(&path)
}

// WS handler calls read_file() directly
```

For commands that need `State<T>` (AgentHub, LockManager, TerminalManager), the shared state is wrapped in `Arc<T>` and passed to both the Tauri managed state and the WS server.

### Port Convention

The WS server uses a fixed port: **`9600`**. No discovery mechanism needed — the frontend hardcodes it, the Rust side binds to it. If the port is busy, the server logs an error and exits (don't silently pick another port, that just creates confusion).

The HTTP file server (for `convertFileSrc` replacement) runs on the same port via path routing (WebSocket at `/ws`, files at `/files`).

### File Serving

For `convertFileSrc()` replacement, the WS server (or a companion HTTP server) serves files at `http://localhost:9600/files?path=/absolute/path`. This handles image previews, app icons, etc. that currently use Tauri's asset protocol.

## Frontend Transport Layer

### `src/lib/invoke.ts`

The single point of abstraction. All 55 files that currently import from `@tauri-apps/api/core` would import from here instead.

```typescript
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { isTauri } from "./runtime";

const NATIVE_COMMANDS = new Set([
  "show_main_window", "hide_main_window", "show_main_window_with_view",
  "open_control_panel", "hide_control_panel", "show_control_panel",
  "pin_control_panel", "is_panel_visible", "is_any_panel_visible",
  "show_spotlight", "hide_spotlight", "resize_spotlight",
  "register_hotkey", "save_hotkey", "get_saved_hotkey",
  "save_clipboard_hotkey", "get_saved_clipboard_hotkey",
  "check_accessibility_permission", "request_accessibility_permission",
  "disable_system_spotlight_shortcut", "is_system_spotlight_enabled",
  "show_error_panel", "hide_error_panel", "get_pending_error",
  "search_applications", "open_application",
  "restart_app", "complete_onboarding", "is_onboarded",
]);

// Sensible defaults when native commands are called from browser
const NATIVE_DEFAULTS: Record<string, unknown> = {
  is_panel_visible: false,
  is_any_panel_visible: false,
  is_system_spotlight_enabled: false,
  is_onboarded: true,
  get_saved_hotkey: null,
  get_saved_clipboard_hotkey: null,
  check_accessibility_permission: true,
  get_pending_error: null,
  search_applications: [],
};

let ws: WebSocket | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: Function; reject: Function }>();

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (NATIVE_COMMANDS.has(cmd)) {
    if (isTauri()) {
      return tauriInvoke<T>(cmd, args);
    }
    // Browser: return default or no-op
    return (NATIVE_DEFAULTS[cmd] ?? undefined) as T;
  }

  // Data command: prefer WebSocket, fall back to Tauri IPC
  if (ws?.readyState === WebSocket.OPEN) {
    return wsInvoke<T>(cmd, args);
  }
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args);
  }
  throw new Error(`No transport available for command: ${cmd}`);
}

function wsInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws!.send(JSON.stringify({ id, cmd, args }));
  });
}

// WS message handler routes responses to pending promises
function handleWsMessage(event: MessageEvent) {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
  } else {
    // Server-push event — route to event bus
    handleServerEvent(msg);
  }
}
```

### Migration Path

The ~55 files that import `invoke` from `@tauri-apps/api/core` would be updated to import from `@/lib/invoke`. This could be done:
1. **Incrementally**: update files as they're touched
2. **All at once**: find-and-replace import paths (mechanical, low risk)
3. **Vite alias**: alias `@tauri-apps/api/core` to our wrapper (zero file changes, but hides the indirection)

Option 2 is preferred — explicit imports, no magic, easy to understand.

### Event Listener Wrapper

Similar pattern for `listen()` / `emit()`:

```typescript
// src/lib/events.ts
import { listen as tauriListen, emit as tauriEmit } from "@tauri-apps/api/event";
import { isTauri } from "./runtime";

export function listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  if (isTauri()) {
    return tauriListen<T>(event, handler);
  }
  // Browser: register with WS event router
  return wsListen<T>(event, handler);
}
```

## Dev Workflow

### With Transport Layer

No new scripts. `pnpm dev` continues to work exactly as today — it runs `./scripts/dev-mort.sh dev`, which starts the Rust backend (via `tauri dev`) and the Vite dev server (port 1420, or `MORT_VITE_PORT`). The only change is the Rust backend now also starts a WS server on `localhost:9600`.

```bash
# Same as today — starts Rust backend (now with WS on :9600) + Vite on :1420
pnpm dev

# Open in Chrome (optional — Tauri webview also works)
open http://localhost:1420
```

When developing in Chrome:
- Full React devtools, Chrome performance profiler
- Hot module reload (Vite)
- All data commands work via WebSocket to the running Rust process on `:9600`
- Native commands (panels, hotkeys) gracefully no-op
- File previews served over HTTP on `:9600/files`

When developing in the Tauri WebView (unchanged from today):
- Everything works as before
- Data commands also use WebSocket (consistent transport)
- Native commands use Tauri IPC as they do today

### For Playwright E2E

```bash
# Start the app normally (WS server runs on :9600)
MORT_DATA_DIR=/tmp/mort-e2e pnpm dev &

# Run Playwright against the Vite dev server
npx playwright test
```

Playwright connects to `localhost:1420`. The app detects it's not in Tauri, uses WebSocket on `:9600` for data commands, mocks native commands. Tests exercise the real Rust backend — real filesystem, real git, real agent hub.

## Implementation

Decomposed into three sequential sub-plans in [tauri-e2e-feasibility/](./tauri-e2e-feasibility/readme.md):

1. **[ws-server.md](./tauri-e2e-feasibility/ws-server.md)** — Rust WS server on `:9600`, ~10 proof-of-concept commands, HTTP file serving
2. **[frontend-transport.md](./tauri-e2e-feasibility/frontend-transport.md)** — `invoke.ts`/`events.ts` wrappers, migrate ~25 files, browser window stubs
3. **[full-coverage-e2e.md](./tauri-e2e-feasibility/full-coverage-e2e.md)** — Route all ~93 commands, WS push events, Playwright, delete `mort-test`, first E2E test

---

## IPC Surface Audit

### Data commands by domain (route over WebSocket)

| Domain | Commands | Needs State<T>? |
|--------|----------|:-:|
| Filesystem | `fs_write_file`, `fs_read_file`, `fs_mkdir`, `fs_exists`, `fs_remove`, `fs_remove_dir_all`, `fs_list_dir`, `fs_move`, `fs_copy_file`, `fs_copy_directory`, `fs_is_git_repo` | No |
| Git | `git_grep`, `git_fetch`, `git_get_default_branch`, `git_create_branch`, `git_checkout_branch`, `git_delete_branch`, `git_list_mort_branches`, `git_diff_files`, `git_diff_commit`, `git_diff_range`, `git_diff_uncommitted`, `git_get_merge_base`, `git_show_file`, `git_rm`, ... (25+) | No |
| Threads | `get_thread_status`, `get_thread` | No |
| Search | `grep`, `search_threads` | No |
| Paths | `fs_get_repo_dir`, `fs_get_repo_source_path`, `fs_get_home_dir`, `get_paths_info`, `get_agent_types` | No |
| Locks | `lock_acquire_repo`, `lock_release_repo` | Yes (LockManager) |
| Agent hub | `send_to_agent`, `list_connected_agents`, `get_agent_socket_path` | Yes (AgentHub) |
| Terminal | `spawn_terminal`, `write_terminal`, `resize_terminal`, `kill_terminal`, `list_terminals` | Yes (TerminalManager) |
| Worktree | `worktree_create`, `worktree_delete`, `worktree_rename`, `worktree_touch`, `worktree_sync` | No |
| Shell | `initialize_shell_environment`, `is_shell_initialized`, `check_documents_access` | No |
| Logging | `web_log`, `web_log_batch`, `get_buffered_logs` | No |
| Repo | `validate_repository`, `remove_repository_data` | No |
| Process | `kill_process` | No |
| Diagnostics | `update_diagnostic_config` | Yes (AgentHub) |
| Profiling | `capture_cpu_profile`, `start_trace`, `write_memory_snapshot`, `get_process_memory` | No |
| Identity | `get_github_handle` | No |

### Native commands (Tauri IPC in WebView, mock in browser)

| Domain | Commands | Mock behavior |
|--------|----------|--------------|
| Window | `show_main_window`, `hide_main_window`, `show_main_window_with_view` | No-op |
| Panel | `open_control_panel`, `hide_control_panel`, `show_control_panel`, `pin_control_panel`, `is_panel_visible`, `is_any_panel_visible`, `show_control_panel_with_view`, `close_control_panel_window`, `focus_control_panel`, `get_pending_control_panel` | No-op / `false` |
| Spotlight | `show_spotlight`, `hide_spotlight`, `resize_spotlight` | No-op |
| Hotkey | `register_hotkey`, `save_hotkey`, `get_saved_hotkey`, `save_clipboard_hotkey`, `get_saved_clipboard_hotkey` | No-op / `null` |
| Accessibility | `check_accessibility_permission`, `request_accessibility_permission`, `check_accessibility_permission_with_prompt`, `get_accessibility_status`, `kill_system_settings`, `disable_system_spotlight_shortcut`, `is_system_spotlight_enabled` | `true` / no-op |
| Clipboard | `get_clipboard_history`, `get_clipboard_content`, `paste_clipboard_entry`, `hide_clipboard_manager` | `[]` / no-op |
| Error panel | `show_error_panel`, `hide_error_panel`, `get_pending_error` | No-op / `null` |
| App search | `search_applications`, `open_application`, `open_directory_in_app` | `[]` / no-op |
| Onboarding | `is_onboarded`, `complete_onboarding` | `true` / no-op |
| App | `restart_app` | No-op |

### Tauri API mocks needed for browser

| API | Used in | Browser replacement |
|-----|---------|-------------------|
| `getCurrentWindow()` | `App.tsx`, `use-window-drag.ts`, `event-bridge.ts`, `control-panel-window.tsx`, `plan-view.tsx` | Stub with no-op `.setSize()`, `.startDragging()`, etc. |
| `convertFileSrc(path)` | `file-content.tsx`, `app-icon.tsx` | `http://localhost:9600/files?path={encodeURIComponent(path)}` |
| `getVersion()` | `about-settings.tsx` | Hardcoded dev version string |
| `LogicalSize` | `App.tsx` | Class stub (constructor only, unused in browser) |
| `resolveResource()` | `agent-service.ts`, `paths.ts` | Polyfill or fetch from WS |
| `join()` | `agent-service.ts`, `use-file-contents.ts` | `path.posix.join` polyfill |

## What This Replaces

The previous tiered approach (Tier 1: mocked IPC, Tier 1.5: `tauri-remote-ui`, Tier 2: WebDriver) is superseded by this. Instead of mocking the backend for tests, we connect to the real one. Instead of depending on `tauri-remote-ui` (19 stars, alpha), we own the transport. The WebSocket server is straightforward Rust, and the frontend wrapper is ~100 lines of TypeScript.

**`mort-test` is deleted.** The native accessibility test binary (`src-tauri/src/bin/mort-test/`) is unmaintained and adds build complexity. With Playwright covering the real backend via WebSocket, there's no reason to keep a separate native test harness. Native-only concerns (global hotkeys, multi-window visibility, macOS permissions) are better tested manually or with focused unit tests on the Rust side. Remove `mort-test` entirely: delete the binary source, remove references from `docs/testing.md`, and drop any Cargo build targets.
