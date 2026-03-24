# Telemetry Opt-Out Setting

## Summary

Add a user-facing `telemetryEnabled` setting (default: `true`) that controls whether logs are sent to the anvil server (ClickHouse). When disabled, the `LogServerLayer` is not created, so no data leaves the device. Local logging (console, JSON file, in-memory buffer, SQLite drains) is unaffected.

## Current State

- **Log server is always on** — `LogServerConfig::from_env()` returns `Some` unless `LOG_SERVER_DISABLED=true` env var is set (dev escape hatch, not user-facing).
- **Default URL is baked in** at compile time: `https://anvil-server.fly.dev/logs`
- **Logging initializes before settings** — `logging::initialize()` runs in Rust before the JS settings store is available. The Rust side reads env vars and config, not workspace settings.
- **Settings live in JS** — `~/.anvil/settings/workspace.json` managed by `SettingsStoreClient`. Rust has no direct reader for this.
- **No identity/consent flow** — the `/identity` endpoint exists server-side but there's no user consent for telemetry.

## Key Design Decision

The core challenge: **logging initializes before the Tauri app and JS settings store are ready**. Two approaches:

### Option A: Read settings JSON directly from Rust (recommended)
At `logging::initialize()` time, read `~/.anvil/settings/workspace.json` directly from disk in Rust (simple JSON parse — no Tauri/JS dependency). This is the same pattern used for `get_device_id()` in `config.rs`. The setting file path is deterministic (`$HOME/.anvil/settings/workspace.json`).

### Option B: Start log server lazily, enable/disable via reload handle
Initialize logging without the log server layer, then activate it once settings are loaded. Uses `tracing_subscriber::reload::Layer` (already used for chrome trace). More complex but allows runtime toggling without restart.

**Recommendation**: Option A for initial implementation (simpler, sufficient). Option B can be added later if runtime toggling is needed.

## Phases

- [x] Phase 1: Add `telemetryEnabled` to WorkspaceSettings schema
- [x] Phase 2: Read setting from Rust at logging init time
- [x] Phase 3: Add UI toggle in settings panel
- [ ] Phase 4: Wire up runtime toggle (reload layer approach)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `telemetryEnabled` to WorkspaceSettings schema

**Files:**
- `src/entities/settings/types.ts`

**Changes:**
- Add `telemetryEnabled: z.boolean().optional()` to `WorkspaceSettingsSchema`
- Document: "Whether to send anonymous usage logs to the anvil server. Optional — defaults to true (enabled)."
- Do NOT add it to `DEFAULT_WORKSPACE_SETTINGS` (optional field, absence = enabled)

## Phase 2: Read setting from Rust at logging init time

**Files:**
- `src-tauri/src/logging/config.rs` — add setting check
- `src-tauri/src/logging/mod.rs` — pass setting to layer decision

**Changes in `config.rs`:**
- Add `fn is_telemetry_enabled() -> bool` that:
  1. Checks `LOG_SERVER_DISABLED` env var (existing behavior, keeps working)
  2. Reads `~/.anvil/settings/workspace.json` from disk
  3. Parses JSON, checks `telemetryEnabled` field
  4. Returns `true` if field is absent or `true`, `false` if explicitly `false`
  5. Returns `true` on any read/parse error (fail-open: don't break telemetry if file is missing or malformed)
- Use the same `ANVIL_CONFIG_DIR` / `dirs::home_dir()` path logic already in the codebase
- Update `LogServerConfig::from_env()` to call `is_telemetry_enabled()` and return `None` when disabled

**Changes in `mod.rs`:**
- No changes needed — `LogServerConfig::from_env()` already returns `Option`, and `None` means the layer isn't added (line 402-406).

## Phase 3: Add UI toggle in settings panel

**Files:**
- Identify the settings panel component (likely in `src/` React components)
- Add a toggle switch for "Send anonymous usage data"

**Changes:**
- Add a toggle bound to `telemetryEnabled` workspace setting
- Label: "Send anonymous usage data" with sublabel: "Helps improve Anvil. No code or conversation content is sent."
- Place it in a "Privacy" section or near the bottom of general settings
- On change: write to settings store. Show a note that restart is required for the change to take effect (until Phase 4 is done).

## Phase 4: Wire up runtime toggle (reload layer approach)

**Files:**
- `src-tauri/src/logging/mod.rs` — use reload handle for log server layer
- `src-tauri/src/logging/log_server.rs` — add shutdown support
- Add a Tauri command to toggle telemetry at runtime

**Changes:**
- Wrap `LogServerLayer` in a `reload::Layer` (same pattern as `chrome_reload_layer`)
- Store the reload handle in a `OnceLock<LogServerReloadHandle>`
- Add `set_telemetry_enabled(enabled: bool)` Tauri command that swaps the layer in/out
- Call this from the frontend when the setting changes — removes the "restart required" note
- When disabling: swap layer to `None`, which drops the sender, causing the background worker to flush remaining logs and exit cleanly (already handled by `Disconnected` arm in `batch_worker`)
- When enabling: create a new `LogServerLayer` and swap it in

**Note:** Phase 4 is nice-to-have. Phase 1-3 deliver a fully functional opt-out with the minor UX cost of requiring a restart.
