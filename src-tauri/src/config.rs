//! Configuration storage for app settings.
//!
//! Stores settings like hotkeys in a JSON file in the app's config directory.

use crate::build_info;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "generate_device_id")]
    pub device_id: String,
    #[serde(default = "default_spotlight_hotkey")]
    pub spotlight_hotkey: String,
    #[serde(default = "default_clipboard_hotkey")]
    pub clipboard_hotkey: String,
    #[serde(default)]
    pub onboarded: bool,
    /// Current migration version (0 = no migrations run yet)
    #[serde(default)]
    pub migration_version: u32,
    #[serde(default)]
    pub github_handle: Option<String>,
    #[serde(default = "default_zoom_level")]
    pub zoom_level: f64,
}

fn generate_device_id() -> String {
    Uuid::new_v4().to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            device_id: generate_device_id(),
            spotlight_hotkey: default_spotlight_hotkey(),
            clipboard_hotkey: default_clipboard_hotkey(),
            onboarded: false,
            migration_version: 0,
            github_handle: None,
            zoom_level: default_zoom_level(),
        }
    }
}

fn default_spotlight_hotkey() -> String {
    build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string()
}

fn default_clipboard_hotkey() -> String {
    build_info::DEFAULT_CLIPBOARD_HOTKEY.to_string()
}

fn default_zoom_level() -> f64 {
    1.0
}

/// Initializes the config module (paths must be initialized first)
pub fn initialize() {
    // Ensure settings directory exists (NEW consolidated location)
    let settings_dir = paths::settings_dir();
    if let Err(e) = fs::create_dir_all(&settings_dir) {
        tracing::warn!(error = %e, "Failed to create settings directory");
    }
}

/// Gets the path to the config file (NEW consolidated location)
fn get_config_path() -> std::path::PathBuf {
    paths::app_config_file()
}

/// Loads the app configuration from disk
pub fn load_config() -> AppConfig {
    let config_path = get_config_path();

    if !config_path.exists() {
        tracing::debug!(path = %config_path.display(), "load_config: config file does not exist, using defaults");
        let config = AppConfig::default();
        // Persist the new config so device_id is saved
        let _ = save_config(&config);
        return config;
    }

    match fs::read_to_string(&config_path) {
        Ok(contents) => {
            tracing::debug!(
                path = %config_path.display(),
                contents_len = contents.len(),
                raw_contents = %contents,
                "load_config: read config file"
            );
            match serde_json::from_str::<AppConfig>(&contents) {
                Ok(config) => {
                    tracing::debug!("load_config: parsed config successfully");
                    // Check if device_id was newly generated (wasn't in the file)
                    // by checking if it's in the raw JSON
                    if !contents.contains("device_id") {
                        // Save config to persist the newly generated device_id
                        let _ = save_config(&config);
                    }
                    config
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        raw_contents = %contents,
                        "load_config: failed to parse config, using defaults"
                    );
                    let config = AppConfig::default();
                    let _ = save_config(&config);
                    config
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                path = %config_path.display(),
                "load_config: failed to read config file, using defaults"
            );
            let config = AppConfig::default();
            let _ = save_config(&config);
            config
        }
    }
}

/// Saves the app configuration to disk
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let config_path = get_config_path();

    // Ensure the config directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let contents =
        serde_json::to_string_pretty(config).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&config_path, contents).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

/// Gets the saved spotlight hotkey, or the default if none is saved
pub fn get_spotlight_hotkey() -> String {
    let hotkey = load_config().spotlight_hotkey;
    if hotkey.is_empty() {
        default_spotlight_hotkey()
    } else {
        hotkey
    }
}

/// Saves the spotlight hotkey to config
pub fn set_spotlight_hotkey(hotkey: &str) -> Result<(), String> {
    tracing::info!(
        hotkey = %hotkey,
        hotkey_len = hotkey.len(),
        hotkey_bytes = ?hotkey.as_bytes(),
        "set_spotlight_hotkey: saving new hotkey"
    );

    let mut config = load_config();
    tracing::info!(
        old_hotkey = %config.spotlight_hotkey,
        new_hotkey = %hotkey,
        "set_spotlight_hotkey: replacing old hotkey"
    );

    config.spotlight_hotkey = hotkey.to_string();
    let result = save_config(&config);
    tracing::info!(
        success = result.is_ok(),
        config_path = %get_config_path().display(),
        "set_spotlight_hotkey: save_config completed"
    );
    result
}

/// Checks if the user has completed onboarding
pub fn is_onboarded() -> bool {
    load_config().onboarded
}

/// Marks onboarding as complete
pub fn set_onboarded(onboarded: bool) -> Result<(), String> {
    let mut config = load_config();
    config.onboarded = onboarded;
    save_config(&config)
}

/// Gets the saved clipboard hotkey, or the default if none is saved
pub fn get_clipboard_hotkey() -> String {
    let hotkey = load_config().clipboard_hotkey;
    if hotkey.is_empty() {
        default_clipboard_hotkey()
    } else {
        hotkey
    }
}

/// Saves the clipboard hotkey to config
pub fn set_clipboard_hotkey(hotkey: &str) -> Result<(), String> {
    let mut config = load_config();
    config.clipboard_hotkey = hotkey.to_string();
    save_config(&config)
}

/// Gets the device ID (UUID generated on first run and persisted)
pub fn get_device_id() -> String {
    load_config().device_id
}

/// Saves the GitHub handle to config
pub fn set_github_handle(handle: &str) -> Result<(), String> {
    let mut config = load_config();
    config.github_handle = Some(handle.to_string());
    save_config(&config)
}

/// Gets the saved zoom level
pub fn get_zoom_level() -> f64 {
    load_config().zoom_level
}

/// Saves the zoom level to config
pub fn set_zoom_level(level: f64) -> Result<(), String> {
    let mut config = load_config();
    config.zoom_level = level;
    save_config(&config)
}

// Note: get_migration_version() and set_migration_version() were removed.
// Migration version is now managed by the TypeScript migration runner.

