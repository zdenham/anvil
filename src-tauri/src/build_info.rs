//! Build-time baked configuration values.
//!
//! These are set during `cargo build` via build.rs and cannot be changed at runtime.

/// App suffix baked at build time (e.g., "dev", "feature-xyz", or "" for production)
pub const APP_SUFFIX: &str = env!("MORT_APP_SUFFIX");

/// Default spotlight hotkey baked at build time
pub const DEFAULT_SPOTLIGHT_HOTKEY: &str = env!("MORT_SPOTLIGHT_HOTKEY");

/// Default clipboard hotkey baked at build time
pub const DEFAULT_CLIPBOARD_HOTKEY: &str = env!("MORT_CLIPBOARD_HOTKEY");

/// Default task panel hotkey baked at build time
pub const DEFAULT_TASK_PANEL_HOTKEY: &str = env!("MORT_TASK_PANEL_HOTKEY");

/// Check if this is a non-production build
pub const fn is_alternate_build() -> bool {
    !APP_SUFFIX.is_empty()
}

