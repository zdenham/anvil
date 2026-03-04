# Sub-Plan 1: Rust WebSocket Server + File Serving

**Prerequisite:** None (first in sequence)
**Delivers:** WS server on `localhost:9600` handling ~10 proof-of-concept commands + HTTP file serving

## Context

The Rust backend currently has no WebSocket or HTTP server and no async runtime beyond Tauri's built-in one. This plan adds `tokio-tungstenite` (or `axum` with WebSocket support) to serve data commands over WebSocket and files over HTTP, all on port 9600.

Key constraint from `docs/agents.md`: **Thin Rust** — keep Rust low-level and performant, minimize business logic.

## Phases

- [x] Add dependencies and create WS server module skeleton
- [x] Route proof-of-concept stateless commands through WS
- [x] Add shared-state command routing (locks, terminals)
- [x] Add HTTP file serving endpoint at `/files`
- [x] Wire WS server startup into `lib.rs::run()` and verify with curl/websocat

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Dependencies + Skeleton

### Add to `src-tauri/Cargo.toml`

```toml
tokio = { version = "1", features = ["rt-multi-thread", "macros", "net"] }
tokio-tungstenite = "0.24"
futures-util = "0.3"        # for StreamExt/SinkExt on WS streams
```

Note: Tauri 2 already depends on tokio internally. Adding it explicitly with `rt-multi-thread` gives us a handle to spawn the WS server task.

### Create `src-tauri/src/ws_server.rs`

Module structure (~200 lines target):

```rust
// ws_server.rs
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Deserialize)]
struct WsRequest {
    id: u64,
    cmd: String,
    args: serde_json::Value,
}

#[derive(Serialize)]
struct WsResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Shared state passed to WS command handlers
pub struct WsState {
    // Phase 1: empty
    // Phase 3: lock_manager, terminal_state, agent_hub, etc.
}

pub async fn start(state: Arc<WsState>) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:9600").await?;
    tracing::info!("WS server listening on ws://127.0.0.1:9600");

    while let Ok((stream, _)) = listener.accept().await {
        let state = state.clone();
        tokio::spawn(handle_connection(stream, state));
    }
    Ok(())
}
```

### Command dispatch

```rust
async fn dispatch(cmd: &str, args: serde_json::Value, state: &WsState) -> Result<serde_json::Value, String> {
    match cmd {
        // Phase 2 adds stateless commands here
        _ => Err(format!("unknown command: {cmd}")),
    }
}
```

## Phase 2: Stateless Proof-of-Concept Commands

Route 8-10 stateless commands that exercise different domains. These commands have no `State<T>` or `AppHandle` parameters — they're pure functions.

**Target commands:**

| Command | Module | Why |
|---------|--------|-----|
| `fs_read_file` | filesystem.rs | Core FS — validates basic I/O |
| `fs_exists` | filesystem.rs | Simple bool return |
| `fs_list_dir` | filesystem.rs | Returns structured data (Vec) |
| `get_paths_info` | mort_commands.rs | App path resolution |
| `git_list_mort_branches` | git_commands.rs | Async git command |
| `git_diff_uncommitted` | git_commands.rs | Larger payload test |
| `get_thread_status` | thread_commands.rs | Thread domain |
| `validate_repository` | repo_commands.rs | Repo validation |
| `search_threads` | search.rs | Search domain |
| `get_github_handle` | identity.rs | Identity domain |

### Implementation approach

Extract the body of each `#[tauri::command]` function into a standalone `pub async fn` (or `pub fn`) that the WS dispatch can call directly. The Tauri command becomes a thin wrapper calling the same function.

```rust
// filesystem.rs — before
#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// filesystem.rs — after
pub fn read_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    read_file(&path)
}
```

The WS dispatch calls `read_file()` directly, deserializing args from JSON.

### Verification

```bash
# Start the app (WS server starts with it)
pnpm dev

# In another terminal, test with websocat
echo '{"id":1,"cmd":"fs_read_file","args":{"path":"/tmp/test.txt"}}' | websocat ws://127.0.0.1:9600
# Should return: {"id":1,"result":"file contents here"}

echo '{"id":2,"cmd":"get_paths_info","args":{}}' | websocat ws://127.0.0.1:9600
# Should return: {"id":2,"result":{"home_dir":"/Users/...","data_dir":"..."}}
```

## Phase 3: Shared-State Commands

Add commands that need `Arc<T>` state. This validates the state-sharing pattern before full-coverage-e2e.md scales it up.

**Target commands (3-4):**

| Command | State needed | Pattern |
|---------|-------------|---------|
| `lock_acquire_repo` | LockManager | Mutex<HashMap> |
| `lock_release_repo` | LockManager | Same |
| `list_terminals` | TerminalState (Arc<Mutex<TerminalManager>>) | Arc<Mutex<T>> |
| `list_connected_agents` | Arc<AgentHub> | Arc<T> |

### WsState grows to hold shared references

```rust
pub struct WsState {
    pub lock_manager: Arc<LockManager>,       // wrap existing LockManager in Arc
    pub terminal_state: TerminalState,         // already Arc<Mutex<TerminalManager>>
    pub agent_hub: Arc<AgentHub>,              // already Arc
}
```

**Key change:** `LockManager` is currently registered via `builder.manage(LockManager::new())` without Arc. To share it with the WS server, wrap it in `Arc` and pass `Arc::clone()` to both Tauri's managed state and `WsState`.

## Phase 4: HTTP File Serving

Add an HTTP endpoint at `http://127.0.0.1:9600/files?path=/absolute/path` for `convertFileSrc()` replacement.

### Approach: Upgrade-aware TCP listener

The TCP listener on `:9600` inspects the first bytes of each connection:
- If it's a WebSocket upgrade request → handle as WS
- If it's a plain HTTP GET to `/files` → serve the file with correct MIME type

Alternatively, use `axum` which handles both natively via routing. Evaluate complexity tradeoff — if `tokio-tungstenite` makes HTTP serving awkward, swap to `axum` with `axum::extract::ws::WebSocketUpgrade`.

### File serving details

```
GET /files?path=/Users/zac/image.png HTTP/1.1

→ 200 OK
  Content-Type: image/png
  Content-Length: 12345
  <bytes>
```

- Resolve MIME type from file extension (use `mime_guess` crate)
- Return 404 for missing files, 400 for missing `path` param
- Only serve from local filesystem (no directory traversal beyond absolute paths)

### Add to Cargo.toml if using MIME detection

```toml
mime_guess = "2"
```

## Phase 5: Wire into lib.rs and Verify

### Startup integration

In `lib.rs::run()`, after creating all state managers:

```rust
// Create shared state for WS server
let ws_state = Arc::new(ws_server::WsState {
    lock_manager: lock_manager.clone(),
    terminal_state: terminal_state.clone(),
    agent_hub: agent_hub.clone(),
});

// Spawn WS server on tokio runtime
tokio::spawn(async move {
    if let Err(e) = ws_server::start(ws_state).await {
        tracing::error!("WS server failed: {e}");
    }
});
```

### Verification checklist

- [ ] `pnpm dev` starts without errors, WS server log line appears
- [ ] `websocat ws://127.0.0.1:9600` connects
- [ ] Stateless command round-trip works (fs_read_file)
- [ ] Stateful command round-trip works (lock_acquire_repo)
- [ ] `curl http://127.0.0.1:9600/files?path=/path/to/image.png` returns file bytes
- [ ] Existing Tauri IPC still works (no regression)
- [ ] Port conflict logs error and exits cleanly

## Risks

| Risk | Mitigation |
|------|-----------|
| Tokio runtime conflict with Tauri's built-in | Tauri 2 uses tokio internally — sharing the runtime should work. If not, spawn a dedicated thread with its own runtime. |
| Port 9600 conflict | Fail loudly with error log. No silent port hunting. |
| Command extraction changes signatures | Keep Tauri command wrappers as thin pass-throughs. Test existing IPC still works after extraction. |
| `axum` vs `tokio-tungstenite` choice | Start with `tokio-tungstenite` for simplicity. If HTTP file serving is awkward, swap to `axum` — both use tokio. |

## Output

After this plan completes, the Rust binary:
- Starts a WS server on `127.0.0.1:9600` alongside the normal Tauri app
- Handles ~10 commands over WS (stateless + stateful proof of concept)
- Serves files over HTTP at `/files?path=...`
- All existing Tauri IPC continues to work unchanged
