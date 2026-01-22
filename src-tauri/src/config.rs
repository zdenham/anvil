//! Configuration storage for app settings.
//!
//! Stores settings like hotkeys in a JSON file in the app's config directory.

use crate::build_info;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_spotlight_hotkey")]
    pub spotlight_hotkey: String,
    #[serde(default = "default_clipboard_hotkey")]
    pub clipboard_hotkey: String,
    #[serde(default)]
    pub onboarded: bool,
    #[serde(default = "default_control_panel_navigation_down_hotkey")]
    pub control_panel_navigation_down_hotkey: String,
    #[serde(default = "default_control_panel_navigation_up_hotkey")]
    pub control_panel_navigation_up_hotkey: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            spotlight_hotkey: default_spotlight_hotkey(),
            clipboard_hotkey: default_clipboard_hotkey(),
            onboarded: false,
            control_panel_navigation_down_hotkey: default_control_panel_navigation_down_hotkey(),
            control_panel_navigation_up_hotkey: default_control_panel_navigation_up_hotkey(),
        }
    }
}

fn default_spotlight_hotkey() -> String {
    build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string()
}

fn default_clipboard_hotkey() -> String {
    build_info::DEFAULT_CLIPBOARD_HOTKEY.to_string()
}

fn default_control_panel_navigation_down_hotkey() -> String {
    "Alt+Down".to_string()
}

fn default_control_panel_navigation_up_hotkey() -> String {
    "Alt+Up".to_string()
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
        return AppConfig::default();
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
                    config
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        raw_contents = %contents,
                        "load_config: failed to parse config, using defaults"
                    );
                    AppConfig::default()
                }
            }
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                path = %config_path.display(),
                "load_config: failed to read config file, using defaults"
            );
            AppConfig::default()
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

/// Gets the saved control panel navigation down hotkey, or the default if none is saved
pub fn get_control_panel_navigation_down_hotkey() -> String {
    let hotkey = load_config().control_panel_navigation_down_hotkey;
    if hotkey.is_empty() {
        default_control_panel_navigation_down_hotkey()
    } else {
        hotkey
    }
}

/// Saves the control panel navigation down hotkey to config
pub fn set_control_panel_navigation_down_hotkey(hotkey: &str) -> Result<(), String> {
    let mut config = load_config();
    config.control_panel_navigation_down_hotkey = hotkey.to_string();
    save_config(&config)
}

/// Gets the saved control panel navigation up hotkey, or the default if none is saved
pub fn get_control_panel_navigation_up_hotkey() -> String {
    let hotkey = load_config().control_panel_navigation_up_hotkey;
    if hotkey.is_empty() {
        default_control_panel_navigation_up_hotkey()
    } else {
        hotkey
    }
}

/// Saves the control panel navigation up hotkey to config
pub fn set_control_panel_navigation_up_hotkey(hotkey: &str) -> Result<(), String> {
    let mut config = load_config();
    config.control_panel_navigation_up_hotkey = hotkey.to_string();
    save_config(&config)
}

