# Fix Agent Hub Socket Disconnect Issue

## Problem Summary

Messages sent to the agent are not receiving responses. The agent connects to the hub, registers successfully, but immediately disconnects.

## Diagnosis

### Observed Behavior (from logs)

```
[18:40:30.463] [INFO ] [anvil_lib::agent_hub] Agent registered
[18:40:30.463] [DEBUG] [anvil_lib::agent_hub] Error reading from agent socket
[18:40:30.463] [INFO ] [anvil_lib::agent_hub] Agent disconnected and removed
```

All three events happen at the exact same millisecond. The agent:
1. Connects and sends a "register" message
2. Registration is processed successfully
3. Immediately gets "Error reading from agent socket"
4. Disconnects and is removed from the hub

The agent process continues running (evidenced by subsequent stdout logs at `18:40:30.688`), but all socket-based communication fails. When the agent's disconnect handler fires, it calls `process.exit(1)` after a 100ms timeout, explaining the exit code 1.

### Root Cause

**The Unix socket listener in `src-tauri/src/agent_hub.rs` is set to non-blocking mode, and accepted connections inherit this mode.**

```rust
// agent_hub.rs:82-84
listener
    .set_nonblocking(true)
    .map_err(|e| format!("Failed to set non-blocking: {}", e))?;
```

When a new connection is accepted:
```rust
// agent_hub.rs:103-104
match listener.accept() {
    Ok((stream, _addr)) => {
        // 'stream' inherits non-blocking mode from listener!
```

In the connection handler:
```rust
// agent_hub.rs:200-204
let reader = BufReader::new(stream);
// ...
for line in reader.lines() {
    match line {
        // ...
        Err(e) => {
            tracing::debug!(error = %e, "Error reading from agent socket");
            break;  // Breaks on WouldBlock!
        }
    }
}
```

The sequence:
1. First `reader.lines()` iteration: Reads the register message (data is buffered, works)
2. Second iteration: No more data available yet (agent is initializing)
3. Non-blocking read returns `Err(WouldBlock)` immediately instead of blocking
4. Error handler breaks the loop, triggering cleanup/disconnect

### Impact

- **All agent-to-frontend communication fails** - No state updates, events, or logs via socket
- **Thread responses don't appear in UI** - State is written to disk but UI isn't notified
- **Agent exits with code 1** - The disconnect handler triggers process exit

## Proposed Fix

### Option A: Set accepted sockets back to blocking mode (Recommended)

In `handle_connection`, set the stream to blocking mode before creating the BufReader:

```rust
fn handle_connection(
    stream: UnixStream,
    agents: Arc<RwLock<HashMap<String, AgentWriter>>>,
    hierarchy: Arc<RwLock<HashMap<String, Option<String>>>>,
    app_handle: AppHandle,
) {
    // CRITICAL: Set stream to blocking mode
    // Accepted sockets inherit non-blocking from the listener
    if let Err(e) = stream.set_nonblocking(false) {
        tracing::error!(error = %e, "Failed to set stream to blocking mode");
        return;
    }

    // ... rest of the function
}
```

**Pros:**
- Simple one-line fix
- Each connection handler runs in its own thread, so blocking is fine
- No architectural changes needed

**Cons:**
- None significant

### Option B: Keep non-blocking and use proper async I/O

Convert the connection handler to use `mio`, `tokio`, or `async-std` for proper non-blocking I/O with event polling.

**Pros:**
- More efficient for many connections

**Cons:**
- Significant refactor
- Overkill for our use case (few agents at a time)
- Adds dependency complexity

### Recommendation

**Go with Option A.** The connection handler already runs in a dedicated thread per connection, so blocking I/O is perfectly appropriate and efficient for our use case.

## Phases

- [x] Add `stream.set_nonblocking(false)` at the start of `handle_connection` in `src-tauri/src/agent_hub.rs`
- [ ] Test by sending a message from the spotlight and verifying the response appears

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

1. `src-tauri/src/agent_hub.rs` - Add blocking mode setting in `handle_connection`

## Testing

1. Launch the app in dev mode
2. Open spotlight (Cmd+Space or however it's triggered)
3. Type a message and press Enter
4. Verify the control panel shows the response
5. Check logs don't show "Error reading from agent socket" immediately after "Agent registered"
