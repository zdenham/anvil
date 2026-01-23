//! Navigation mode state machine
//!
//! Implements Command+Tab style navigation for the control panel.
//! Supports bidirectional navigation with Alt+Down and Alt+Up hotkeys.
//!
//! ## State Machine
//!
//! ```text
//!                                     ┌─────────────────────┐
//!                                     │                     │
//!      Alt+Down OR Alt+Up             │       IDLE          │
//!           │                         │                     │
//!           │                         └─────────────────────┘
//!           │                                   ▲
//!           ▼                                   │
//! ┌─────────────────────┐                       │
//! │                     │   Alt released        │
//! │   NAVIGATING        │───────────────────────┘
//! │                     │   (emit: nav-release)
//! └─────────────────────┘
//!           │ ▲
//!           │ │ Alt+Down (emit: nav-down)
//!           │ │ Alt+Up (emit: nav-up)
//!           └─┘
//! ```

use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// Navigation target - which panel to show during navigation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NavigationTarget {
    /// Navigate the inbox list (default for Alt+Up/Down)
    #[default]
    InboxList,
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
    /// Modifier released - frontend should open currently selected item
    NavRelease,
    /// Navigation cancelled (panel blur, escape pressed, etc.)
    NavCancel,
}

/// Modifier flag bits from CGEventFlags
const OPTION_MASK: u64 = 0x00080000; // CGEventFlags::CGEventFlagOption (Alt key)

/// Navigation mode manager
pub struct NavigationMode {
    /// Current state of the navigation mode
    state: Mutex<NavigationState>,
    /// Current navigation target (which panel is being navigated)
    current_target: Mutex<NavigationTarget>,
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
            current_target: Mutex::new(NavigationTarget::default()),
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

    /// Called when a navigation hotkey is pressed (Alt+Up or Alt+Down)
    pub fn on_hotkey_pressed(&self, direction: NavigationDirection) {
        self.enter_navigation_mode(direction, NavigationTarget::InboxList);
    }

    /// Enter navigation mode with a specific target panel
    pub fn enter_navigation_mode(&self, direction: NavigationDirection, target: NavigationTarget) {
        let mut state = self.state.lock().unwrap();

        match *state {
            NavigationState::Idle => {
                tracing::info!(
                    direction = ?direction,
                    target = ?target,
                    "NavigationMode: Idle -> Navigating (starting navigation mode)"
                );
                *state = NavigationState::Navigating;
                *self.current_target.lock().unwrap() = target;

                // Start modifier tap to detect Alt release
                self.start_modifier_tap();

                // Show the appropriate panel based on target
                if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
                    match target {
                        NavigationTarget::InboxList => {
                            let _ = panels::show_inbox_list_panel(app);
                        }
                    }
                }

                // Emit nav-start to signal navigation mode has begun
                // First press just shows panel with first item selected - no direction event
                self.emit(NavigationEvent::NavStart);
            }
            NavigationState::Navigating => {
                // Continue navigating - just emit direction events, frontend owns the index
                match direction {
                    NavigationDirection::Down => {
                        tracing::debug!("NavigationMode: nav-down");
                        self.emit(NavigationEvent::NavDown);
                    }
                    NavigationDirection::Up => {
                        tracing::debug!("NavigationMode: nav-up");
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
            let target = *self.current_target.lock().unwrap();
            tracing::info!(
                target = ?target,
                "NavigationMode: Navigating -> Idle (modifier released)"
            );
            *state = NavigationState::Idle;

            // Stop modifier tap (thread will exit on its own since we set stop_flag)
            // Note: We don't call stop_modifier_tap() here because we're already
            // in the callback from the tap thread - it will exit after returning

            // Emit nav-release (no index needed - frontend knows what's selected)
            tracing::info!("[NavigationMode] on_modifier_released: Emitting nav-release event");
            self.emit(NavigationEvent::NavRelease);
        }
    }

    /// Called when panel loses focus or user presses Escape
    pub fn on_panel_blur(&self) {
        let mut state = self.state.lock().unwrap();

        if *state == NavigationState::Navigating {
            let target = *self.current_target.lock().unwrap();
            tracing::info!(
                target = ?target,
                "NavigationMode: Navigating -> Idle (panel blur/cancel)"
            );
            *state = NavigationState::Idle;

            // Stop modifier tap
            drop(state); // Release lock before calling stop_modifier_tap
            self.stop_modifier_tap();

            // Hide the panel based on target
            if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
                match target {
                    NavigationTarget::InboxList => {
                        let _ = panels::hide_inbox_list_panel(app);
                    }
                }
            }

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

        // Reset flags
        self.stop_flag.store(false, Ordering::SeqCst);
        self.tap_thread_exited.store(false, Ordering::SeqCst);

        let stop_flag = self.stop_flag.clone();
        let tap_thread_exited = self.tap_thread_exited.clone();

        tracing::info!("[NavigationMode] start_modifier_tap: Creating CGEventTap");

        // We need to call on_modifier_released from the thread, so we use
        // a global singleton pattern
        let handle = thread::spawn(move || {
            tracing::info!("NavigationMode: CGEventTap thread started");

            // CRITICAL: Initialize prev_flags with Option/Alt already set
            // Since this tap is started by an Alt+Down/Up hotkey, Alt is currently held
            let prev_flags = Arc::new(AtomicU64::new(OPTION_MASK));
            let prev_flags_clone = prev_flags.clone();
            let stop_flag_clone = stop_flag.clone();

            // Create the event tap for FlagsChanged events only
            tracing::info!("[NavigationMode] start_modifier_tap: About to create CGEventTap");
            let event_tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged],
                move |_proxy, _event_type, event| {
                    tracing::debug!("[NavigationMode] CGEventTap callback triggered");
                    let flags = event.get_flags();
                    let flags_bits = flags.bits();
                    let old_flags = prev_flags_clone.swap(flags_bits, Ordering::SeqCst);

                    tracing::debug!("[NavigationMode] FlagsChanged: flags_bits={:#x}, old_flags={:#x}", flags_bits, old_flags);

                    // Detect Option/Alt release (was set, now clear)
                    let option_was_down = (old_flags & OPTION_MASK) != 0;
                    let option_is_down = (flags_bits & OPTION_MASK) != 0;

                    tracing::debug!("[NavigationMode] FlagsChanged: option_was_down={}, option_is_down={}", option_was_down, option_is_down);

                    if option_was_down && !option_is_down {
                        tracing::info!("[NavigationMode] Option/Alt released detected - flags_bits={:#x}, option_was_down={}, option_is_down={}", flags_bits, option_was_down, option_is_down);
                        // Signal thread to stop
                        stop_flag_clone.store(true, Ordering::SeqCst);
                        // Call the modifier released handler
                        tracing::info!("[NavigationMode] Calling on_modifier_released()");
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

            tracing::info!("NavigationMode: CGEventTap enabled, listening for Option/Alt release");

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

/// Called when control panel loses focus (from frontend)
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
