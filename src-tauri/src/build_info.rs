//! Build-time configuration with runtime overrides.
//!
//! Values are baked at compile time via build.rs, but runtime env vars
//! take precedence when set. This prevents stale binaries from silently
//! using wrong values (e.g. prod paths in a dev build).

use std::sync::OnceLock;

/// Baked compile-time defaults (fallbacks when env vars are unset at runtime)
mod baked {
    pub const APP_SUFFIX: &str = env!("MORT_APP_SUFFIX");
    pub const DEFAULT_SPOTLIGHT_HOTKEY: &str = env!("MORT_SPOTLIGHT_HOTKEY");
    pub const DEFAULT_CLIPBOARD_HOTKEY: &str = env!("MORT_CLIPBOARD_HOTKEY");
    pub const WS_PORT: &str = env!("MORT_WS_PORT");
}

fn resolve(env_key: &str, baked: &str) -> String {
    std::env::var(env_key).unwrap_or_else(|_| baked.to_string())
}

static APP_SUFFIX_VAL: OnceLock<String> = OnceLock::new();
static SPOTLIGHT_HOTKEY_VAL: OnceLock<String> = OnceLock::new();
static CLIPBOARD_HOTKEY_VAL: OnceLock<String> = OnceLock::new();
static WS_PORT_VAL: OnceLock<String> = OnceLock::new();

/// App suffix (e.g., "dev", "feature-xyz", or "" for production)
pub fn app_suffix() -> &'static str {
    APP_SUFFIX_VAL.get_or_init(|| resolve("MORT_APP_SUFFIX", baked::APP_SUFFIX))
}

/// Default spotlight hotkey
pub fn default_spotlight_hotkey() -> &'static str {
    SPOTLIGHT_HOTKEY_VAL.get_or_init(|| resolve("MORT_SPOTLIGHT_HOTKEY", baked::DEFAULT_SPOTLIGHT_HOTKEY))
}

/// Default clipboard hotkey
pub fn default_clipboard_hotkey() -> &'static str {
    CLIPBOARD_HOTKEY_VAL.get_or_init(|| resolve("MORT_CLIPBOARD_HOTKEY", baked::DEFAULT_CLIPBOARD_HOTKEY))
}

/// WebSocket server port (default "9600", dev uses "9601")
pub fn ws_port() -> &'static str {
    WS_PORT_VAL.get_or_init(|| resolve("MORT_WS_PORT", baked::WS_PORT))
}
