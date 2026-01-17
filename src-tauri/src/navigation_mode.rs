//! Navigation mode state machine
//!
//! Implements Command+Tab style navigation for the task panel.
//! Supports bidirectional navigation with Shift+Down and Shift+Up hotkeys.
//!
//! ## State Machine
//!
//! ```text
//!                                     ┌─────────────────────┐
//!                                     │                     │
//!      Shift+Down OR Shift+Up         │       IDLE          │
//!           │                         │                     │
//!           │                         └─────────────────────┘
//!           │                                   ▲
//!           ▼                                   │
//! ┌─────────────────────┐                       │
//! │                     │   Shift released      │
//! │   NAVIGATING        │───────────────────────┘
//! │                     │   (emit: nav-open)
//! └─────────────────────┘
//!           │ ▲
//!           │ │ Shift+Down (emit: nav-down)
//!           │ │ Shift+Up (emit: nav-up)
//!           └─┘
//! ```

use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::panels;

/// Navigation direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDirection {
    Up,
    Down,
}

/// Navigation mode state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NavigationState {
    Idle,
    Navigating,
}

/// Events emitted to the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum NavigationEvent {
    /// Navigation mode started - panel should open and show first item selected
    NavStart,
    /// Navigate down in the list
    NavDown,
    /// Navigate up in the list
    NavUp,
    /// Modifier released - open the selected task
    NavOpen {
        #[serde(rename = "selectedIndex")]
        selected_index: usize,
    },
    /// Navigation cancelled (panel blur, escape pressed, etc.)
    NavCancel,
}

/// Modifier flag bits from CGEventFlags
const SHIFT_MASK: u64 = 0x00020000;   // CGEventFlags::CGEventFlagShift
const CONTROL_MASK: u64 = 0x00040000; // CGEventFlags::CGEventFlagControl
const OPTION_MASK: u64 = 0x00080000;  // CGEventFlags::CGEventFlagAlternate
const COMMAND_MASK: u64 = 0x00100000; // CGEventFlags::CGEventFlagCommand

/// Tracks which modifiers are being monitored for release
#[derive(Debug, Clone, Copy, Default)]
pub struct ActiveModifiers {
    pub shift: bool,
    pub control: bool,
    pub option: bool,
    pub command: bool,
}

impl ActiveModifiers {
    /// Parse modifiers from a hotkey string like "Command+Shift+Down"
    pub fn from_hotkey(hotkey: &str) -> Self {
        let lower = hotkey.to_lowercase();
        Self {
            shift: lower.contains("shift"),
            control: lower.contains("control") || lower.contains("ctrl"),
            option: lower.contains("option") || lower.contains("alt"),
            command: lower.contains("command") || lower.contains("cmd") || lower.contains("meta"),
        }
    }

    /// Get the combined modifier mask for all tracked modifiers
    pub fn to_mask(&self) -> u64 {
        let mut mask = 0u64;
        if self.shift { mask |= SHIFT_MASK; }
        if self.control { mask |= CONTROL_MASK; }
        if self.option { mask |= OPTION_MASK; }
        if self.command { mask |= COMMAND_MASK; }
        mask
    }
}

/// Navigation mode manager
pub struct NavigationMode {
    /// Current state of the navigation mode
    state: Mutex<NavigationState>,
    /// Currently selected index during navigation
    current_index: Mutex<usize>,
    /// Modifiers that were used to start navigation (need ALL to be released)
    active_modifiers: Mutex<ActiveModifiers>,
    /// Flag to signal the CGEventTap thread to stop
    stop_flag: Arc<AtomicBool>,
    /// Flag indicating the tap thread has fully exited
    tap_thread_exited: Arc<AtomicBool>,
    /// Handle to the modifier tap thread (for cleanup verification)
    tap_thread_handle: Mutex<Option<JoinHandle<()>>>,
    /// App handle for emitting events
    app_handle: Mutex<Option<AppHandle>>,
}

impl NavigationMode {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(NavigationState::Idle),
            current_index: Mutex::new(0),
            active_modifiers: Mutex::new(ActiveModifiers::default()),
            stop_flag: Arc::new(AtomicBool::new(false)),
            tap_thread_exited: Arc::new(AtomicBool::new(true)), // Starts as exited (no thread running)
            tap_thread_handle: Mutex::new(None),
            app_handle: Mutex::new(None),
        }
    }

    /// Initialize with app handle for event emission
    pub fn init(&self, app: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app);
    }

    /// Called when a navigation hotkey is pressed (e.g., Shift+Down, Command+J)
    /// The hotkey parameter is used to determine which modifiers to monitor for release
    pub fn on_hotkey_pressed(&self, direction: NavigationDirection, hotkey: &str) {
        let mut state = self.state.lock().unwrap();

        match *state {
            NavigationState::Idle => {
                // Parse which modifiers are in the hotkey and store them
                let modifiers = ActiveModifiers::from_hotkey(hotkey);
                *self.active_modifiers.lock().unwrap() = modifiers;

                tracing::info!(
                    direction = ?direction,
                    hotkey = %hotkey,
                    modifiers = ?modifiers,
                    "NavigationMode: Idle -> Navigating (starting navigation mode)"
                );
                *state = NavigationState::Navigating;
                *self.current_index.lock().unwrap() = 0;

                // Start modifier tap to detect when ALL modifiers are released
                self.start_modifier_tap();

                // Show the tasks panel
                if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
                    let _ = panels::show_tasks_list(app);
                }

                // Emit nav-start to signal navigation mode has begun
                self.emit(NavigationEvent::NavStart);

                // Emit the initial navigation direction
                match direction {
                    NavigationDirection::Down => self.emit(NavigationEvent::NavDown),
                    NavigationDirection::Up => self.emit(NavigationEvent::NavUp),
                }
            }
            NavigationState::Navigating => {
                // Continue navigating in the requested direction
                match direction {
                    NavigationDirection::Down => {
                        let mut index = self.current_index.lock().unwrap();
                        *index = index.saturating_add(1);
                        tracing::debug!(index = *index, "NavigationMode: nav-down");
                        self.emit(NavigationEvent::NavDown);
                    }
                    NavigationDirection::Up => {
                        let mut index = self.current_index.lock().unwrap();
                        *index = index.saturating_sub(1);
                        tracing::debug!(index = *index, "NavigationMode: nav-up");
                        self.emit(NavigationEvent::NavUp);
                    }
                }
            }
        }
    }

    /// Called when modifier key is released (from CGEventTap)
    pub fn on_modifier_released(&self) {
        let mut state = self.state.lock().unwrap();

        if *state == NavigationState::Navigating {
            let index = *self.current_index.lock().unwrap();
            tracing::info!(
                index = index,
                "NavigationMode: Navigating -> Idle (modifier released, opening task)"
            );
            *state = NavigationState::Idle;

            // Stop modifier tap (thread will exit on its own since we set stop_flag)
            // Note: We don't call stop_modifier_tap() here because we're already
            // in the callback from the tap thread - it will exit after returning

            // Emit nav-open with selected index
            self.emit(NavigationEvent::NavOpen {
                selected_index: index,
            });
        }
    }

    /// Called when panel loses focus or user presses Escape
    pub fn on_panel_blur(&self) {
        let mut state = self.state.lock().unwrap();

        if *state == NavigationState::Navigating {
            tracing::info!("NavigationMode: Navigating -> Idle (panel blur/cancel)");
            *state = NavigationState::Idle;

            // Stop modifier tap
            drop(state); // Release lock before calling stop_modifier_tap
            self.stop_modifier_tap();

            // Emit cancel
            self.emit(NavigationEvent::NavCancel);
        }
    }

    /// Check if navigation mode is currently active
    pub fn is_active(&self) -> bool {
        *self.state.lock().unwrap() == NavigationState::Navigating
    }

    /// Get the current navigation state
    pub fn get_state(&self) -> NavigationState {
        *self.state.lock().unwrap()
    }

    /// Start the CGEventTap for modifier monitoring
    fn start_modifier_tap(&self) {
        // Check if already running
        if !self.tap_thread_exited.load(Ordering::SeqCst) {
            tracing::warn!("NavigationMode: Modifier tap already running, skipping start");
            return;
        }

        // Get the modifier mask to monitor (must be done before spawning thread)
        let modifier_mask = self.active_modifiers.lock().unwrap().to_mask();

        // Reset flags
        self.stop_flag.store(false, Ordering::SeqCst);
        self.tap_thread_exited.store(false, Ordering::SeqCst);

        let stop_flag = self.stop_flag.clone();
        let tap_thread_exited = self.tap_thread_exited.clone();

        // We need to call on_modifier_released from the thread, so we use
        // a global singleton pattern
        let handle = thread::spawn(move || {
            tracing::info!(modifier_mask = format!("0x{:08x}", modifier_mask), "NavigationMode: CGEventTap thread started");

            let stop_flag_clone = stop_flag.clone();

            // Create the event tap for FlagsChanged events only
            let event_tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged],
                move |_proxy, _event_type, event| {
                    let flags = event.get_flags();
                    let flags_bits = flags.bits();

                    // Check if ALL tracked modifiers are now released
                    // This works regardless of release order (Command first, then Shift, etc.)
                    let all_modifiers_up = (flags_bits & modifier_mask) == 0;

                    // Only log and trigger if we haven't already stopped
                    if all_modifiers_up && !stop_flag_clone.load(Ordering::SeqCst) {
                        tracing::info!(
                            current_flags = format!("0x{:08x}", flags_bits),
                            modifier_mask = format!("0x{:08x}", modifier_mask),
                            "NavigationMode: All modifiers released"
                        );
                        // Signal thread to stop
                        stop_flag_clone.store(true, Ordering::SeqCst);
                        // Call the modifier released handler
                        get_navigation_mode().on_modifier_released();
                    }

                    // Pass event through unchanged
                    None
                },
            );

            let event_tap = match event_tap_result {
                Ok(tap) => tap,
                Err(()) => {
                    tracing::error!("NavigationMode: Failed to create CGEventTap");
                    tap_thread_exited.store(true, Ordering::SeqCst);
                    return;
                }
            };

            // Create run loop source from the mach port
            let loop_source = match event_tap.mach_port.create_runloop_source(0) {
                Ok(source) => source,
                Err(()) => {
                    tracing::error!("NavigationMode: Failed to create run loop source");
                    tap_thread_exited.store(true, Ordering::SeqCst);
                    return;
                }
            };

            // Add source to run loop
            unsafe {
                CFRunLoop::get_current().add_source(&loop_source, kCFRunLoopCommonModes);
            }

            // Enable the tap
            event_tap.enable();

            tracing::info!(modifier_mask = format!("0x{:08x}", modifier_mask), "NavigationMode: CGEventTap enabled, listening for modifier release");

            // Run the event loop until stopped
            while !stop_flag.load(Ordering::SeqCst) {
                // Run the run loop for 50ms at a time to allow checking stop flag
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    Duration::from_millis(50),
                    true,
                );
            }

            // Cleanup
            tracing::info!("NavigationMode: CGEventTap thread cleaning up");
            unsafe {
                CFRunLoop::get_current().remove_source(&loop_source, kCFRunLoopCommonModes);
            }

            tap_thread_exited.store(true, Ordering::SeqCst);
            tracing::info!("NavigationMode: CGEventTap thread exited");
        });

        *self.tap_thread_handle.lock().unwrap() = Some(handle);
    }

    /// Stop the CGEventTap
    fn stop_modifier_tap(&self) {
        // Signal thread to stop
        self.stop_flag.store(true, Ordering::SeqCst);

        // Wait for thread to acknowledge (with timeout)
        let start = Instant::now();
        while !self.tap_thread_exited.load(Ordering::SeqCst) {
            if start.elapsed() > Duration::from_millis(500) {
                tracing::warn!("NavigationMode: Modifier tap thread did not exit cleanly");
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        // Clear the thread handle
        *self.tap_thread_handle.lock().unwrap() = None;
    }

    /// Emit a navigation event to the frontend
    fn emit(&self, event: NavigationEvent) {
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            tracing::debug!(event = ?event, "NavigationMode: Emitting event");
            if let Err(e) = app.emit("navigation-mode", &event) {
                tracing::error!(error = ?e, "NavigationMode: Failed to emit event");
            }
        }
    }
}

impl Default for NavigationMode {
    fn default() -> Self {
        Self::new()
    }
}

// Global singleton
static NAVIGATION_MODE: OnceLock<NavigationMode> = OnceLock::new();

/// Get the global navigation mode instance
pub fn get_navigation_mode() -> &'static NavigationMode {
    NAVIGATION_MODE.get_or_init(NavigationMode::new)
}

/// Initialize navigation mode with app handle
pub fn initialize(app: &AppHandle) {
    get_navigation_mode().init(app.clone());
}

// ═══════════════════════════════════════════════════════════════════════════
// Tauri Commands
// ═══════════════════════════════════════════════════════════════════════════

/// Called when navigation hotkey is triggered (navigate down)
#[tauri::command]
pub fn navigation_hotkey_down() {
    let hotkey = crate::config::get_navigation_down_hotkey();
    get_navigation_mode().on_hotkey_pressed(NavigationDirection::Down, &hotkey);
}

/// Called when navigation hotkey is triggered (navigate up)
#[tauri::command]
pub fn navigation_hotkey_up() {
    let hotkey = crate::config::get_navigation_up_hotkey();
    get_navigation_mode().on_hotkey_pressed(NavigationDirection::Up, &hotkey);
}

/// Called when task panel loses focus (from frontend)
#[tauri::command]
pub fn navigation_panel_blur() {
    get_navigation_mode().on_panel_blur();
}

/// Check if currently in navigation mode
#[tauri::command]
pub fn is_navigation_mode_active() -> bool {
    get_navigation_mode().is_active()
}

/// Get current navigation state
#[tauri::command]
pub fn get_navigation_state() -> NavigationState {
    get_navigation_mode().get_state()
}
