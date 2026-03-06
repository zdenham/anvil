# Fix Server Startup Failures

## Problem

```
18:19:38.981 ERROR [mort_lib] Failed to start AgentHub
```

Mort has **two server components**, both with startup reliability issues:

| Component | Transport | Address | Purpose |
|---|---|---|---|
| **AgentHub** | Unix domain socket | `~/.mort/agent-hub.sock` | Agent processes → Rust backend |
| **WS server** | TCP WebSocket | `127.0.0.1:9600` (hardcoded) | Frontend → Rust backend (browser mode) |

Agents connect to the **Unix socket** via `HubClient` (`agents/src/lib/hub/client.ts`). The WS server bridges AgentHub events to browser clients. Both failures are silently swallowed — the app runs but things don't work.

### AgentHub failure causes

1. **Stale socket file** — previous instance crashed without cleaning up `~/.mort/agent-hub.sock`. The `cleanup_stale_socket()` connect-based check is fragile — a dying process can briefly accept connections
2. **Another Mort instance running** — connect succeeds → returns error
3. **Race on restart** — old socket hasn't been cleaned up yet

### WS server failure causes

1. **Port 9600 already in use** — another Mort instance or unrelated process bound to the port
2. **No dynamic port fallback** — hardcoded `const BIND_ADDR: &str = "127.0.0.1:9600"`

### Silent failure (both)

Both `lib.rs:1033` (AgentHub) and `lib.rs:775` (WS server) log errors and continue. The app appears to work but agents can't connect and the frontend can't communicate.

## Phases

- [ ] Fix AgentHub stale socket detection with PID-based locking
- [ ] Add dynamic port selection for WS server
- [ ] Surface startup failures to the frontend
- [ ] Add retry logic and diagnostic logging

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix AgentHub stale socket detection with PID-based locking

The connect-based stale detection is fragile. Replace with PID-based locking.

**Approach:** Write `~/.mort/agent-hub.pid` on startup containing the current PID. On next startup:

1. Read PID file if it exists
2. Check if that PID is still alive (`libc::kill(pid, 0)`)
3. If alive → error "Another Mort instance is already running (PID: X)"
4. If dead → stale, remove socket + PID file and continue
5. Write new PID file before binding

Keep the connect-based check as a **secondary signal** — if PID is alive but connect fails, it's a zombie PID file. Remove and continue.

**Files to change:**
- `src-tauri/src/agent_hub.rs` — update `cleanup_stale_socket()`, add PID file write/read/cleanup

## Phase 2: Add dynamic port selection for WS server

Replace the hardcoded `127.0.0.1:9600` with dynamic port selection, and write the chosen port to a known location so the frontend can discover it.

**Approach:**

1. Bind to `127.0.0.1:0` (OS picks an available port) with a preference for 9600
2. Write the actual bound port to `~/.mort/ws-port` (or equivalent)
3. Frontend reads the port file on startup to know where to connect
4. Clean up port file on shutdown

```rust
// In ws_server/mod.rs
const PREFERRED_PORT: u16 = 9600;

pub async fn start(state: Arc<WsState>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", PREFERRED_PORT)).await {
        Ok(l) => l,
        Err(_) => {
            tracing::warn!("Port {} unavailable, binding to random port", PREFERRED_PORT);
            tokio::net::TcpListener::bind("127.0.0.1:0").await?
        }
    };
    let addr = listener.local_addr()?;
    tracing::info!("WS server listening on ws://{}", addr);

    // Write port to discoverable location
    let port_path = paths::data_dir().join("ws-port");
    std::fs::write(&port_path, addr.port().to_string())?;

    // ... rest of setup
}
```

**Files to change:**
- `src-tauri/src/ws_server/mod.rs` — dynamic port binding + port file write
- `src-tauri/src/paths.rs` — add `ws_port_path()` helper (if needed)
- Frontend WS connection code — read port from file/env instead of hardcoded 9600
- Need to find where frontend connects to `ws://127.0.0.1:9600` and update

**Open question:** How does the frontend currently discover the WS address? If it's hardcoded in JS, we need to pass the dynamic port through Tauri state or a file.

## Phase 3: Surface startup failures to the frontend

Currently both servers fail silently. Surface errors so the user knows something is wrong.

**Approach:** Store server status in Tauri managed state. Emit events on failure. Frontend shows notification.

```rust
// In lib.rs setup()
if let Err(e) = hub.start() {
    tracing::error!(error = %e, "Failed to start AgentHub");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("server-startup-error", json!({
            "component": "agent-hub",
            "error": e.to_string()
        }));
    }
}
```

**Files to change:**
- `src-tauri/src/lib.rs` — emit events on failure for both AgentHub and WS server
- Frontend — listen for `server-startup-error` and show notification/banner

## Phase 4: Add retry logic and diagnostic logging

**Retry on bind failure:**
- AgentHub: if `UnixListener::bind()` fails, wait 500ms, remove stale socket, retry once
- WS server: already handled by Phase 2's fallback to port 0

**Diagnostic logging:**
- Log whether socket/PID files exist at startup
- Log the specific error from `cleanup_stale_socket` vs `bind`
- Log OS-level details (file permissions, directory state)

**Files to change:**
- `src-tauri/src/agent_hub.rs` — retry + structured logging in `start()` and `cleanup_stale_socket()`
