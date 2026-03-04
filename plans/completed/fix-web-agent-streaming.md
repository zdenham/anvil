# Fix: Agent Events Not Streaming to Web Client

## Diagnosis

Agent events (streaming text, tool progress, state updates) are **not reaching the web/browser client** because the AgentHub and the WS server use two completely separate event transport systems with no bridge between them.

### The Two Transport Systems

1. **Tauri Native IPC** (`app_handle.emit()`) — Used by the AgentHub (`agent_hub.rs:474`) to forward all structured agent messages. Only reaches Tauri webview windows.

2. **WS EventBroadcaster** (`push.rs`) — A tokio broadcast channel that pushes events to WebSocket clients on port 9600. Used by `dispatch_agent.rs` for stdout/stderr/close events only.

### What Works in Web Mode

These events flow through `dispatch_agent.rs` → `broadcaster.broadcast()` → WS clients:
- `agent_stdout:{threadId}` — raw stdout lines
- `agent_stderr:{threadId}` — raw stderr lines
- `agent_close:{threadId}` — process exit

### What's Missing in Web Mode

These events flow through `agent_hub.rs` → `app_handle.emit("agent:message")` → **nowhere** (Tauri IPC only):
- `state` — full state updates
- `state_event` — patch-based state deltas (tool use progress)
- `stream_delta` — streaming text content (the main thing users see)
- `optimistic_stream` — streaming content snapshots
- `event` — named events (permission requests, thread_created, plan_detected, etc.)
- `heartbeat` — agent health pings

### Why the Frontend Expects It

`agent-service.ts:157` calls `listen("agent:message", ...)`. In browser mode, `listen()` (from `events.ts`) registers a handler in the `wsListeners` map, waiting for WS push events with event name `"agent:message"`. But the WS server **never broadcasts** that event name — only the Tauri-only `app_handle.emit()` does.

### Impact

In web/browser mode, the user sees:
- Agent spawns successfully, process is running
- **Blank thread view** — no streaming text appears
- **No tool progress** — state deltas never arrive
- **Permission prompts never appear** — agent hangs waiting for response
- **Agent appears dead** — no heartbeats received

## Phases

- [x] Bridge AgentHub events to WS EventBroadcaster
- [x] Verify frontend `listen("agent:message")` receives bridged events

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Proposed Fix

### Approach: Give AgentHub a reference to the EventBroadcaster

The cleanest fix is to pass the WS `EventBroadcaster` into the AgentHub so it can dual-emit: both to Tauri native IPC and to WS clients.

### Changes Required

#### 1. `src-tauri/src/agent_hub.rs`

Add an optional `EventBroadcaster` field to `AgentHub`:

```rust
use crate::ws_server::push::EventBroadcaster;

pub struct AgentHub {
    // ... existing fields ...
    /// Optional WS broadcaster for dual-emit to browser clients
    ws_broadcaster: Arc<RwLock<Option<EventBroadcaster>>>,
}
```

Add a method to inject the broadcaster after WS server startup:

```rust
impl AgentHub {
    pub fn set_ws_broadcaster(&self, broadcaster: EventBroadcaster) {
        if let Ok(mut guard) = self.ws_broadcaster.write() {
            *guard = Some(broadcaster);
        }
    }
}
```

In `handle_connection()`, after the existing `app_handle.emit("agent:message", &raw_msg)` call (line 474), add a WS broadcast:

```rust
// Forward to WS clients (browser mode)
// The broadcaster is behind Arc<RwLock> so we need to pass it into handle_connection
if let Ok(guard) = ws_broadcaster.read() {
    if let Some(ref broadcaster) = *guard {
        broadcaster.broadcast("agent:message", raw_msg.clone());
    }
}
```

This requires threading the `ws_broadcaster` field through to `handle_connection` (adding it as a parameter alongside `app_handle`, `agents`, etc.).

#### 2. `src-tauri/src/lib.rs` (or wherever app initialization happens)

After creating both the AgentHub and the WS server's EventBroadcaster, wire them together:

```rust
// During app setup, after creating both:
agent_hub.set_ws_broadcaster(broadcaster.clone());
```

#### 3. No frontend changes needed

The frontend already listens for `"agent:message"` via `listen()` which works for both Tauri events and WS push events. Once the WS server broadcasts `"agent:message"`, the existing `dispatchWsEvent()` in `events.ts` will route it to the registered handler in `agent-service.ts`.

### Alternative Considered: Tauri Event Listener Bridge

Another approach would be to subscribe to Tauri events in the WS server and forward them. However, this is more complex because Tauri's `listen()` API is designed for the frontend, not for backend-to-backend bridging. The direct broadcaster injection is simpler and more efficient.

### Testing

- Run the app in browser mode (not Tauri webview)
- Spawn an agent thread
- Verify streaming text appears in real-time
- Verify tool use blocks show progress
- Verify permission prompts appear
- Check WS server logs for `"agent:message"` broadcasts
