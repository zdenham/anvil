use tauri::{AppHandle, Emitter};
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use crate::panels;

static NAVIGATION_MODE: OnceLock<Mutex<Option<NavigationMode>>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct NavigationMode {
    pub active: bool,
    pub required_modifiers: ModifierSet,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ModifierSet {
    pub meta: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

#[derive(Debug, Serialize)]
pub struct TaskNavigationEvent {
    pub direction: NavigationDirection,
}

#[derive(Debug, Serialize)]
pub struct TaskSelectionEvent {
    // Empty - just signals to select current task
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum NavigationDirection {
    Up,
    Down,
}

fn get_navigation_mode() -> &'static Mutex<Option<NavigationMode>> {
    NAVIGATION_MODE.get_or_init(|| Mutex::new(None))
}

/// Start navigation mode when hotkey is pressed
pub fn start_navigation_mode(app: &AppHandle, hotkey: &str) {
    let required_modifiers = parse_hotkey_modifiers(hotkey);

    if let Ok(mut mode) = get_navigation_mode().lock() {
        *mode = Some(NavigationMode {
            active: true,
            required_modifiers,
        });

        // Show panel and start navigation
        let _ = panels::show_tasks_list(app);
    }
}

/// Handle arrow key navigation (only works if navigation mode is active)
pub fn handle_navigation_key(app: &AppHandle, direction: NavigationDirection) {
    if let Ok(mode) = get_navigation_mode().lock() {
        if mode.is_some() {
            // Emit global event - panels will filter based on their state
            let event = TaskNavigationEvent { direction };
            let _ = app.emit("task-navigation", &event);
        }
    }
}

/// Handle modifier key release - end navigation if all required modifiers released
pub fn handle_modifier_release(app: &AppHandle, current_modifiers: &ModifierSet) {
    if let Ok(mut mode) = get_navigation_mode().lock() {
        if let Some(nav_mode) = &*mode {
            if all_required_modifiers_released(&nav_mode.required_modifiers, &current_modifiers) {
                // All hotkey modifiers released - select current task
                let _ = app.emit("task-selection", &TaskSelectionEvent {});
                *mode = None; // End navigation mode
            }
        }
    }
}

/// End navigation mode (panel closed, escape pressed, etc.)
pub fn end_navigation_mode(app: &AppHandle) {
    if let Ok(mut mode) = get_navigation_mode().lock() {
        if mode.is_some() {
            let _ = app.emit("navigation-end", &());
            *mode = None;
        }
    }
}

/// Check if navigation mode is currently active
pub fn is_navigation_mode_active() -> bool {
    if let Ok(mode) = get_navigation_mode().lock() {
        mode.is_some()
    } else {
        false
    }
}

fn parse_hotkey_modifiers(hotkey: &str) -> ModifierSet {
    let lowercase = hotkey.to_lowercase();
    let parts: Vec<&str> = lowercase.split('+').collect();
    ModifierSet {
        meta: parts.iter().any(|&p| p == "cmd" || p == "command" || p == "meta"),
        ctrl: parts.iter().any(|&p| p == "ctrl" || p == "control"),
        alt: parts.iter().any(|&p| p == "alt" || p == "option"),
        shift: parts.iter().any(|&p| p == "shift"),
    }
}

fn all_required_modifiers_released(required: &ModifierSet, current: &ModifierSet) -> bool {
    // All modifiers that were part of the hotkey must now be released
    (!required.meta || !current.meta) &&
    (!required.ctrl || !current.ctrl) &&
    (!required.alt || !current.alt) &&
    (!required.shift || !current.shift)
}

// Modifier monitoring - simplified for now
// TODO: Implement actual platform-specific modifier monitoring
pub fn start_modifier_monitoring(_app: AppHandle) {
    // For now, we'll rely on panel blur events to end navigation mode
    // Future versions can implement proper modifier monitoring
}