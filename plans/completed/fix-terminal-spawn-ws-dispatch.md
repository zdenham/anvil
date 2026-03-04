# Fix: Terminal spawn fails via WebSocket dispatch

## Problem

Creating a terminal fails with `Error: unknown command: spawn_terminal`.

**Root cause:** The frontend `invoke()` transport layer (`src/lib/invoke.ts`) routes non-native commands through WebSocket first (port 9600). The WS dispatcher (`src-tauri/src/ws_server/dispatch_misc.rs`) only handles 3 of 6 terminal commands — `spawn_terminal`, `kill_terminal`, and `kill_terminals_by_cwd` are missing. When the WS connection is active, the request hits the WS fallthrough `_ => Err("unknown command: ...")` and never reaches Tauri IPC where these commands are fully implemented.

**Working commands (have WS dispatch):** `list_terminals`, `write_terminal`, `resize_terminal`
**Broken commands (missing WS dispatch):** `spawn_terminal`, `kill_terminal`, `kill_terminals_by_cwd`

## Diagnosis

The routing in `invoke.ts:254-286`:
1. If cmd is in `NATIVE_COMMANDS` → Tauri IPC (always works)
2. If WS is open → `wsInvoke()` (fails for missing commands)
3. Else → Tauri IPC fallback (works, but only reached when WS is down)

The Tauri IPC side is fully implemented — all 6 terminal commands are registered in `lib.rs` `generate_handler![]` and have working `#[tauri::command]` implementations in `terminal.rs`.

The WS dispatcher gap exists because `spawn_terminal` and `kill_terminal` require `AppHandle` for `app.emit()` (to push `terminal:output`, `terminal:exit`, `terminal:killed` events). The WS server's `WsState` doesn't hold an `AppHandle` — it uses its own `EventBroadcaster` instead.

## Phases

- [x] Add missing terminal commands to WS dispatcher using EventBroadcaster
- [x] Add `kill_terminal` and `kill_terminals_by_cwd` inner functions to terminal.rs

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach: Add `_inner` variants and wire into WS dispatch

The existing pattern (`write_terminal_inner`, `resize_terminal_inner`, `list_terminals_inner`) extracts the core logic from the `#[tauri::command]` wrappers so WS dispatch can call them. We follow the same pattern for the missing commands.

### 1. `terminal.rs` — Add inner functions

**`spawn_terminal_inner`** — The tricky one. Currently `spawn_terminal` uses `app.emit()` to push terminal output. We need a version that accepts a generic event emitter callback or the WS `EventBroadcaster`.

Create a `spawn_terminal_inner` that takes a closure/trait for event emission:

```rust
pub fn spawn_terminal_inner(
    state: &TerminalState,
    cols: u16,
    rows: u16,
    cwd: String,
    emit: Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>,
) -> Result<u32, String> {
    // Same PTY spawn logic, but uses `emit("terminal:output", ...)`
    // instead of `app.emit(...)`
}
```

Then refactor existing `spawn_terminal` to call `spawn_terminal_inner` with an `app.emit` wrapper:

```rust
#[tauri::command]
pub async fn spawn_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cols: u16, rows: u16, cwd: String,
) -> Result<u32, String> {
    let emit = Arc::new(move |event: &str, payload: serde_json::Value| {
        let _ = app.emit(event, payload);
    });
    spawn_terminal_inner(&state, cols, rows, cwd, emit)
}
```

**`kill_terminal_inner`** — Same pattern. Extract kill logic, accept emitter:

```rust
pub fn kill_terminal_inner(
    state: &TerminalState,
    id: u32,
    emit: impl Fn(&str, serde_json::Value),
) -> Result<(), String> { ... }
```

**`kill_terminals_by_cwd_inner`** — Same:

```rust
pub fn kill_terminals_by_cwd_inner(
    state: &TerminalState,
    cwd: &str,
    emit: impl Fn(&str, serde_json::Value),
) -> Result<Vec<u32>, String> { ... }
```

### 2. `dispatch_misc.rs` — Add WS handlers

Wire the new inner functions using the `EventBroadcaster`:

```rust
"spawn_terminal" => {
    let cols: u16 = extract_arg(&args, "cols")?;
    let rows: u16 = extract_arg(&args, "rows")?;
    let cwd: String = extract_arg(&args, "cwd")?;
    let broadcaster = state.broadcaster.clone();
    let emit = Arc::new(move |event: &str, payload: serde_json::Value| {
        broadcaster.broadcast(event, &payload);
    });
    let id = crate::terminal::spawn_terminal_inner(
        &state.terminal_state, cols, rows, cwd, emit,
    )?;
    Ok(serde_json::to_value(id).unwrap())
}
"kill_terminal" => {
    let id: u32 = extract_arg(&args, "id")?;
    let broadcaster = state.broadcaster.clone();
    let emit = move |event: &str, payload: serde_json::Value| {
        broadcaster.broadcast(event, &payload);
    };
    crate::terminal::kill_terminal_inner(&state.terminal_state, id, emit)?;
    Ok(serde_json::Value::Null)
}
"kill_terminals_by_cwd" => {
    let cwd: String = extract_arg(&args, "cwd")?;
    let broadcaster = state.broadcaster.clone();
    let emit = move |event: &str, payload: serde_json::Value| {
        broadcaster.broadcast(event, &payload);
    };
    let ids = crate::terminal::kill_terminals_by_cwd_inner(
        &state.terminal_state, &cwd, emit,
    )?;
    Ok(serde_json::to_value(ids).unwrap())
}
```

### Files to modify

| File | Change |
|------|--------|
| `src-tauri/src/terminal.rs` | Add `spawn_terminal_inner`, `kill_terminal_inner`, `kill_terminals_by_cwd_inner`; refactor existing commands to call them |
| `src-tauri/src/ws_server/dispatch_misc.rs` | Add 3 missing terminal command handlers |

### Why not just add to `NATIVE_COMMANDS`?

Adding `spawn_terminal` to `NATIVE_COMMANDS` in `invoke.ts` would be simpler, but:
- It creates an inconsistency (some terminal commands go through WS, others through IPC)
- Browser mode wouldn't get proper terminal support
- The `_inner` pattern is already established for the other 3 terminal commands — completing it is the right fix
