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
    #[serde(default = "default_task_panel_hotkey")]
    pub task_panel_hotkey: String,
    #[serde(default)]
    pub onboarded: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            spotlight_hotkey: default_spotlight_hotkey(),
            clipboard_hotkey: default_clipboard_hotkey(),
            task_panel_hotkey: default_task_panel_hotkey(),
            onboarded: false,
        }
    }
}

fn default_spotlight_hotkey() -> String {
    build_info::DEFAULT_SPOTLIGHT_HOTKEY.to_string()
}

fn default_clipboard_hotkey() -> String {
    build_info::DEFAULT_CLIPBOARD_HOTKEY.to_string()
}

fn default_task_panel_hotkey() -> String {
    build_info::DEFAULT_TASK_PANEL_HOTKEY.to_string()
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
        return AppConfig::default();
    }

    match fs::read_to_string(&config_path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => AppConfig::default(),
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
    let mut config = load_config();
    config.spotlight_hotkey = hotkey.to_string();
    save_config(&config)
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

/// Gets the saved task panel hotkey, or the default if none is saved
pub fn get_task_panel_hotkey() -> String {
    let hotkey = load_config().task_panel_hotkey;
    if hotkey.is_empty() {
        default_task_panel_hotkey()
    } else {
        hotkey
    }
}

/// Saves the task panel hotkey to config
pub fn set_task_panel_hotkey(hotkey: &str) -> Result<(), String> {
    let mut config = load_config();
    config.task_panel_hotkey = hotkey.to_string();
    save_config(&config)
}


