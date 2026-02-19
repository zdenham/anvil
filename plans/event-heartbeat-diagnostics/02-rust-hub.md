# 02: Rust AgentHub Pipeline Tracking

**Depends on**: 00-shared-types (for understanding the schema; Rust re-implements the types natively)
**Parallel with**: 01-agent-side, 03-frontend
**Blocks**: 04-integration

## Overview

Add pipeline stage stamping and sequence gap detection to the Rust AgentHub. The hub is a "dumb pipe" — it doesn't interpret message semantics — but it does add two pipeline stamps (`hub:received`, `hub:emitted`) and tracks per-agent sequence numbers to detect gaps.

Diagnostic logging controlled by `MORT_DIAGNOSTIC_LOGGING` env var (same JSON as the agent side), parsed at init.

## Phases

- [x] Add pipeline stamp types and diagnostic config parsing (Rust-native, matching the TypeScript types)
- [x] Add `hub:received` stamp injection on message receipt from socket
- [x] Add per-agent `last_seq` tracking with gap detection (always-on warning for gaps)
- [x] Add `hub:emitted` stamp injection after successful `app_handle.emit()`
- [x] Add emit failure logging (always-on `tracing::warn` with seq on `Err`)
- [x] Add opt-in per-message diagnostic logging when `pipeline` module enabled

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Diagnostic Config in Rust

Parse `MORT_DIAGNOSTIC_LOGGING` env var at AgentHub initialization:

```rust
#[derive(Debug, Clone, Deserialize, Default)]
struct DiagnosticLoggingConfig {
    pipeline: bool,
    heartbeat: bool,
    sequence_gaps: bool,
    socket_health: bool,
}

impl DiagnosticLoggingConfig {
    fn from_env() -> Self {
        std::env::var("MORT_DIAGNOSTIC_LOGGING")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}
```

Store in Tauri managed state so it can be updated at runtime via a Tauri command (for auto-enable on staleness).

### Pipeline Stamp Injection

In the message handler (`agent_hub.rs` reader thread):

1. **On receipt** (after `serde_json::from_str` succeeds):
   - Extract `pipeline` array from the JSON value (or create it if missing)
   - Read `seq` from the first stamp in the array (the `agent:sent` stamp)
   - Append `{ "stage": "hub:received", "seq": <extracted_seq>, "ts": <now_ms> }`
   - Track `last_seq` per agent — if gap, always `tracing::warn!("SEQ GAP agent={} expected={} got={}", agent_id, last_seq+1, seq)`

2. **After emit** (after `app_handle.emit()` call):
   - Append `{ "stage": "hub:emitted", "seq": <seq>, "ts": <now_ms> }`
   - If `emit()` returns `Err`, always `tracing::warn!("EMIT FAILED agent={} seq={} err={}", agent_id, seq, err)`

### JSON Manipulation

The hub works with `serde_json::Value` — stamp injection is done by:
```rust
if let Some(pipeline) = msg.get_mut("pipeline") {
    if let Some(arr) = pipeline.as_array_mut() {
        arr.push(serde_json::json!({
            "stage": "hub:received",
            "seq": seq,
            "ts": now_ms()
        }));
    }
}
```

This avoids needing a full Rust struct for every message type — the hub stays generic.

### Per-Agent State

Extend the existing per-agent tracking in the handler with:
```rust
struct AgentConnectionState {
    // existing fields...
    last_seq: Option<u64>,  // Last seen sequence number from this agent
}
```

### Opt-In Diagnostic Logging

- **When `config.pipeline` is true**: `tracing::debug!` every message's seq and type at both receive and emit points
- **When false**: Only gap warnings and emit errors are logged (always-on)
- Heartbeat messages pass through unchanged — hub does NOT interpret them, just stamps and forwards

### Tauri Command for Runtime Config Update

Add a command so the frontend can update diagnostic config at runtime (for auto-enable on staleness):
```rust
#[tauri::command]
fn update_diagnostic_config(config: DiagnosticLoggingConfig, state: State<AgentHubState>) {
    *state.diagnostic_config.lock().unwrap() = config;
}
```

### `diagnostic:config` Relay to Agents

When the frontend updates diagnostic config, it also sends a relay message through the hub to all connected agents so they can hot-reload their config. The hub forwards `{ type: "relay", name: "diagnostic:config", payload: <config> }` messages to the target agent's socket. This uses the existing relay mechanism — no new routing logic needed.

## Key Decisions

- **Rust re-implements types natively**: No FFI or shared type generation. The Rust types mirror the TypeScript types from `core/types/` but are defined independently. This keeps the Rust build simple and avoids codegen complexity.
- **Hub stays generic**: Pipeline stamps are injected by manipulating `serde_json::Value`, not by deserializing into typed structs. The hub doesn't need to understand message semantics.
- **Gap detection is always-on**: Sequence gaps are rare and indicate data loss — always worth logging. Per-message pipeline tracing is opt-in.
- **No emit retry**: If `app_handle.emit()` fails, log it and move on. Retrying could cause ordering issues and the hub should stay fast.

## Files

| Action | File | Description |
|--------|------|-------------|
| Modify | `src-tauri/src/agent_hub.rs` | Pipeline stamps, seq tracking, gap detection, diagnostic config, runtime update command |
