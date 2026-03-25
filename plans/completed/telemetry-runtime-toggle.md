# Telemetry Runtime Toggle (No Restart Required)

## Summary

Remove the "restart required" limitation from the telemetry opt-out setting. When the user toggles telemetry off in settings, the `LogServerLayer` is swapped out immediately — no restart needed. Uses the same `reload::Layer` pattern already proven by the chrome trace layer.

## Why this works

The chrome trace layer (`profiling.rs:112-142`) already demonstrates the exact pattern:
1. Wrap the layer in `reload::Layer` with an `Option<T>` inner type
2. Store the `reload::Handle` in a `OnceLock`
3. Call `handle.modify(|layer| *layer = None)` to disable, `handle.modify(|layer| *layer = Some(...))` to enable

When `LogServerLayer` is swapped to `None`, the `mpsc::Sender` is dropped, which causes the background `batch_worker` thread to see `Disconnected`, do a final flush, and exit cleanly (`log_server.rs:130-136`). No leaked threads.

## Phases

- [x] Phase 1: Wrap LogServerLayer in reload::Layer at init time
- [x] Phase 2: Add Tauri command to toggle telemetry at runtime
- [x] Phase 3: Call Tauri command from frontend on setting change
- [x] Phase 4: Remove "restart required" copy from UI

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Wrap LogServerLayer in reload::Layer at init time

**Files:**
- `src-tauri/src/logging/mod.rs`

**Changes:**

1. Add a type alias mirroring the chrome pattern (~line 42):
   ```rust
   type LogServerReloadHandle = reload::Handle<
       Option<LogServerLayer>,
       /* the composed subscriber type — use the same S generic as chrome */
   >;
   ```

   **Note on subscriber type:** The chrome layer uses `tracing_subscriber::Registry` as its subscriber type. Since layers are composed via `.with()`, each wrapping changes the type. The `LogServerLayer` sits at a different position in the stack than the chrome layer. You'll need to determine the correct composed subscriber type. The simplest approach: make `LogServerLayer` implement `Layer<S>` for any `S: Subscriber` (it likely already does via a blanket impl), then use the same `Registry` type. If the compiler complains, follow its guidance on the concrete type.

2. Add a static `OnceLock` (~line 50):
   ```rust
   static LOG_SERVER_RELOAD_HANDLE: OnceLock<LogServerReloadHandle> = OnceLock::new();
   ```

3. Add a public accessor:
   ```rust
   pub fn log_server_reload_handle() -> Option<&'static LogServerReloadHandle> {
       LOG_SERVER_RELOAD_HANDLE.get()
   }
   ```

4. Change layer init (~line 402-407) from:
   ```rust
   let log_server_layer = LogServerConfig::from_env().map(|config| {
       let device_id = crate::config::get_device_id();
       LogServerLayer::new(config, device_id)
   });
   ```
   To:
   ```rust
   let log_server_inner: Option<LogServerLayer> = LogServerConfig::from_env().map(|config| {
       let device_id = crate::config::get_device_id();
       tracing::warn!("Log server logging enabled: {} (device: {})", config.url, device_id);
       LogServerLayer::new(config, device_id)
   });
   let (log_server_reload_layer, log_server_reload_handle) = reload::Layer::new(log_server_inner);
   let _ = LOG_SERVER_RELOAD_HANDLE.set(log_server_reload_handle);
   ```

5. Replace `.with(log_server_layer)` with `.with(log_server_reload_layer)` in the registry composition (~line 423).

**Verification:** App boots normally, logs still flow to ClickHouse when telemetry is enabled. No behavioral change yet.

## Phase 2: Add Tauri command to toggle telemetry at runtime

**Files:**
- `src-tauri/src/logging/mod.rs` — add the command function
- `src-tauri/src/lib.rs` — register the command (~line 968)

**Changes in `mod.rs`:**

Add a public function (can live at bottom of file):
```rust
#[tauri::command]
pub fn set_telemetry_enabled(enabled: bool) -> Result<(), String> {
    let handle = log_server_reload_handle()
        .ok_or("Log server reload handle not initialized")?;

    if enabled {
        // Create a fresh layer
        let config = LogServerConfig::from_env_force()
            .ok_or("Cannot enable telemetry: no log server URL configured")?;
        let device_id = crate::config::get_device_id();
        let layer = LogServerLayer::new(config, device_id);
        handle
            .modify(|current| *current = Some(layer))
            .map_err(|e| format!("Failed to enable log server layer: {e}"))?;
        tracing::info!("Telemetry enabled at runtime");
    } else {
        handle
            .modify(|current| *current = None)
            .map_err(|e| format!("Failed to disable log server layer: {e}"))?;
        tracing::info!("Telemetry disabled at runtime");
    }

    Ok(())
}
```

**Changes in `config.rs`:**

Add `from_env_force()` — same as `from_env()` but skips the telemetry-enabled check (since we're explicitly re-enabling):
```rust
/// Returns config without checking telemetry setting.
/// Used when re-enabling telemetry at runtime.
pub fn from_env_force() -> Option<Self> {
    if std::env::var("LOG_SERVER_DISABLED")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
    {
        return None;
    }
    let url = std::env::var("LOG_SERVER_URL")
        .unwrap_or_else(|_| Self::DEFAULT_LOG_SERVER_URL.to_string());
    Some(Self { url })
}
```

**Changes in `lib.rs`:**

Add `logging::set_telemetry_enabled` to the `generate_handler![]` list.

**Verification:** Can call `set_telemetry_enabled(false)` from dev tools console via `__TAURI__.invoke('set_telemetry_enabled', { enabled: false })` and confirm logs stop flowing.

## Phase 3: Call Tauri command from frontend on setting change

**Files:**
- `src/components/main-window/settings/telemetry-settings.tsx`

**Changes:**

In the `onChange` handler, after calling `settingsService.set(...)`, also invoke the Tauri command:

```typescript
onChange={async (e) => {
  const enabled = e.target.checked;
  await settingsService.set("telemetryEnabled", enabled);
  await invoke("set_telemetry_enabled", { enabled });
}}
```

Import `invoke` from `@tauri-apps/api/core` (or wherever other components import it from).

**Verification:** Toggle the checkbox, confirm no errors in console, confirm logs stop/start flowing.

## Phase 4: Remove "restart required" copy from UI

**Files:**
- `src/components/main-window/settings/telemetry-settings.tsx`
- `plans/telemetry-opt-out-setting.md` — mark Phase 4 complete

**Changes:**

Remove any "restart required" note/text from the telemetry settings UI. The toggle now takes effect immediately.

Update the parent plan to mark Phase 4 as done.
