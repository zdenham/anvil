# Disable telemetry by default, direct-post thread:created

## Context

Currently telemetry is all-or-nothing: the `LogServerLayer` either sends everything to the log server or nothing. The default is **enabled** (fail-open). We want to flip the default to **off**, but always send `thread:created` events regardless of the telemetry setting.

**Identity** (`POST /identity`) already works independently — it's a direct `ureq::post()` in `identity.rs`, completely decoupled from the log server layer. No changes needed.

## Design

Keep the existing LogServerLayer as-is (enabled/disabled based on setting). For `thread:created`, bypass the layer entirely and make a direct HTTP POST to the log server — same pattern as identity registration.

This avoids any dual-mode filtering complexity. The LogServerLayer stays simple: on or off. Essential events use direct HTTP calls.

### Key changes

| File | Change |
| --- | --- |
| `src-tauri/src/logging/config.rs` | Flip `is_telemetry_enabled()` fail-open to fail-closed: absent/unreadable setting → `false` instead of `true`. |
| `src-tauri/src/logging/log_server.rs` | Add a standalone `pub fn post_event(event_type: &str, properties: &HashMap<String, Value>)` function that does a direct `ureq::post()` to the log server URL. Similar to identity's `register_with_server()` — fire-and-forget on a spawned thread. Reuse `DEFAULT_LOG_SERVER_URL` / `LOG_SERVER_URL` env var. |
| Agent event handler (Rust side) | Where `thread:created` events arrive from the agent process stdout/socket, call `log_server::post_event("thread:created", ...)` with thread_id and repo_id. Need to find the exact handler — likely in the agent stdout parsing or event routing code. |
| `src/components/main-window/settings/telemetry-settings.tsx` | Change `?? true` to `?? false` so the UI reflects the new default. |

### Direct POST design

```rust
// In log_server.rs
pub fn post_event(event_type: &str, properties: HashMap<String, serde_json::Value>) {
    let url = std::env::var("LOG_SERVER_URL")
        .unwrap_or_else(|_| DEFAULT_LOG_SERVER_URL.to_string());

    if std::env::var("LOG_SERVER_DISABLED").map(|v| v == "true").unwrap_or(false) {
        return;
    }

    let device_id = get_device_id(); // reuse existing device_id logic
    let row = LogRow {
        timestamp: now_millis(),
        device_id,
        level: "INFO".into(),
        message: event_type.into(),
        properties: Some(properties),
    };

    std::thread::spawn(move || {
        let _ = ureq::post(&url)
            .set("Content-Type", "application/json")
            .send_json(&serde_json::json!({ "rows": [row] }));
    });
}
```

This respects `LOG_SERVER_DISABLED` for local dev but ignores the telemetry setting — essential events always send.

### Identity path — no changes needed

`identity.rs::register_with_server()` is already a direct `ureq::post()` to `/identity`.

### Thread created path — find the Rust handler

`thread:created` events flow from the agent process through stdout/socket into the Tauri side. Need to locate where these events are parsed on the Rust side and add the `post_event` call there. The TypeScript side handles it in `agent-service.ts` → `routeAgentEvent()`, but we want the POST on the Rust side so it works even if the frontend window isn't open.

## Phases

- [x] Add `post_event()` standalone function to `log_server.rs` — direct HTTP POST, fire-and-forget, respects `LOG_SERVER_DISABLED` but not the telemetry toggle

- [x] Wire `thread:created` events to call `post_event()` via Tauri command from `agent-service.ts` (Rust side has no event handler — events flow through sidecar WebSocket to frontend)

- [x] Flip `is_telemetry_enabled()` default from fail-open to fail-closed (absent = false)

- [x] Flip UI default: `?? true` → `?? false` in telemetry-settings.tsx

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Risk / considerations

- **No breaking change for opted-in users**: Users who set `telemetryEnabled: true` keep full telemetry.
- **Existing installs with no setting**: Switch from full → off. `thread:created` still sends via direct POST.
- `LOG_SERVER_DISABLED=true`: Still fully disables everything (including direct posts) for local dev.
- **No batching for thread:created**: One POST per event. Thread creation is infrequent enough that this is fine — no need for batching infrastructure.
- **Identity registration**: Unchanged, already independent.