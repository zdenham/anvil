//! CGEvent tap testing module for validating event listening in Tauri context
//!
//! This module provides a simple test harness to verify CGEventTap works
//! within the main application (not just the standalone test binary).

use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Modifier flag bits from CGEventFlags
const SHIFT_MASK: u64 = 0x00020000;
const COMMAND_MASK: u64 = 0x00100000;
const OPTION_MASK: u64 = 0x00080000;
const CONTROL_MASK: u64 = 0x00040000;

/// Global state for the event tap test
struct EventTapTestState {
    is_running: AtomicBool,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
    stop_signal: Arc<AtomicBool>,
}

impl EventTapTestState {
    fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            thread_handle: Mutex::new(None),
            stop_signal: Arc::new(AtomicBool::new(false)),
        }
    }
}

static EVENT_TAP_STATE: OnceLock<EventTapTestState> = OnceLock::new();

fn get_state() -> &'static EventTapTestState {
    EVENT_TAP_STATE.get_or_init(EventTapTestState::new)
}

/// Event payload sent to the frontend
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum CGEventTestEvent {
    #[serde(rename = "started")]
    Started,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "key_down")]
    KeyDown { keycode: i64 },
    #[serde(rename = "key_up")]
    KeyUp { keycode: i64 },
    #[serde(rename = "flags_changed")]
    FlagsChanged {
        flags: u64,
        shift: bool,
        command: bool,
        option: bool,
        control: bool,
    },
    #[serde(rename = "modifier_released")]
    ModifierReleased { modifier: String },
    #[serde(rename = "error")]
    Error { message: String },
}

/// Start the CGEvent tap test
/// Returns true if started successfully, false if already running or failed
#[tauri::command]
pub fn start_cgevent_test(app: AppHandle) -> Result<bool, String> {
    let state = get_state();

    // Check if already running
    if state.is_running.swap(true, Ordering::SeqCst) {
        return Ok(false); // Already running
    }

    // Reset stop signal
    state.stop_signal.store(false, Ordering::SeqCst);

    let stop_signal = state.stop_signal.clone();
    let app_handle = app.clone();

    // Spawn the event tap thread
    let handle = std::thread::spawn(move || {
        run_event_tap(app_handle, stop_signal);
    });

    *state.thread_handle.lock().unwrap() = Some(handle);

    // Emit started event
    let _ = app.emit("cgevent-test", CGEventTestEvent::Started);
    tracing::info!("CGEvent tap test started");

    Ok(true)
}

/// Stop the CGEvent tap test
#[tauri::command]
pub fn stop_cgevent_test(app: AppHandle) -> Result<(), String> {
    let state = get_state();

    if !state.is_running.load(Ordering::SeqCst) {
        return Ok(()); // Not running
    }

    // Signal the thread to stop
    state.stop_signal.store(true, Ordering::SeqCst);

    // Wait for thread to finish (with timeout)
    if let Some(handle) = state.thread_handle.lock().unwrap().take() {
        // Give it a moment to clean up
        std::thread::sleep(Duration::from_millis(200));

        // Don't block indefinitely - the thread should exit on its own
        if !handle.is_finished() {
            tracing::warn!("CGEvent tap thread did not exit cleanly, continuing anyway");
        }
    }

    state.is_running.store(false, Ordering::SeqCst);

    // Emit stopped event
    let _ = app.emit("cgevent-test", CGEventTestEvent::Stopped);
    tracing::info!("CGEvent tap test stopped");

    Ok(())
}

/// Check if the CGEvent tap test is currently running
#[tauri::command]
pub fn is_cgevent_test_running() -> bool {
    get_state().is_running.load(Ordering::SeqCst)
}

/// Run the event tap on the current thread (called from spawned thread)
fn run_event_tap(app: AppHandle, stop_signal: Arc<AtomicBool>) {
    // Check accessibility permission
    if !crate::accessibility::is_accessibility_trusted() {
        let _ = app.emit(
            "cgevent-test",
            CGEventTestEvent::Error {
                message: "Accessibility permission not granted".to_string(),
            },
        );
        return;
    }

    // Track previous modifier state
    let prev_flags = Arc::new(AtomicU64::new(0));
    let prev_flags_clone = prev_flags.clone();
    let app_clone = app.clone();

    // Create the event tap
    let event_tap_result = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![
            CGEventType::KeyDown,
            CGEventType::KeyUp,
            CGEventType::FlagsChanged,
        ],
        move |_proxy, event_type, event| {
            match event_type {
                CGEventType::KeyDown => {
                    let keycode = event.get_integer_value_field(
                        core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                    );
                    let _ = app_clone.emit("cgevent-test", CGEventTestEvent::KeyDown { keycode });
                    tracing::debug!("CGEvent KeyDown: keycode={}", keycode);
                }
                CGEventType::KeyUp => {
                    let keycode = event.get_integer_value_field(
                        core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                    );
                    let _ = app_clone.emit("cgevent-test", CGEventTestEvent::KeyUp { keycode });
                    tracing::debug!("CGEvent KeyUp: keycode={}", keycode);
                }
                CGEventType::FlagsChanged => {
                    let flags = event.get_flags();
                    let flags_bits = flags.bits();
                    let old_flags = prev_flags_clone.swap(flags_bits, Ordering::SeqCst);

                    let shift_is_down = (flags_bits & SHIFT_MASK) != 0;
                    let cmd_is_down = (flags_bits & COMMAND_MASK) != 0;
                    let opt_is_down = (flags_bits & OPTION_MASK) != 0;
                    let ctrl_is_down = (flags_bits & CONTROL_MASK) != 0;

                    // Emit flags changed event
                    let _ = app_clone.emit(
                        "cgevent-test",
                        CGEventTestEvent::FlagsChanged {
                            flags: flags_bits,
                            shift: shift_is_down,
                            command: cmd_is_down,
                            option: opt_is_down,
                            control: ctrl_is_down,
                        },
                    );

                    // Check for modifier releases
                    let shift_was_down = (old_flags & SHIFT_MASK) != 0;
                    if shift_was_down && !shift_is_down {
                        let _ = app_clone.emit(
                            "cgevent-test",
                            CGEventTestEvent::ModifierReleased {
                                modifier: "shift".to_string(),
                            },
                        );
                        tracing::info!("CGEvent: SHIFT RELEASED");
                    }

                    let cmd_was_down = (old_flags & COMMAND_MASK) != 0;
                    if cmd_was_down && !cmd_is_down {
                        let _ = app_clone.emit(
                            "cgevent-test",
                            CGEventTestEvent::ModifierReleased {
                                modifier: "command".to_string(),
                            },
                        );
                        tracing::info!("CGEvent: COMMAND RELEASED");
                    }

                    let opt_was_down = (old_flags & OPTION_MASK) != 0;
                    if opt_was_down && !opt_is_down {
                        let _ = app_clone.emit(
                            "cgevent-test",
                            CGEventTestEvent::ModifierReleased {
                                modifier: "option".to_string(),
                            },
                        );
                        tracing::info!("CGEvent: OPTION RELEASED");
                    }

                    let ctrl_was_down = (old_flags & CONTROL_MASK) != 0;
                    if ctrl_was_down && !ctrl_is_down {
                        let _ = app_clone.emit(
                            "cgevent-test",
                            CGEventTestEvent::ModifierReleased {
                                modifier: "control".to_string(),
                            },
                        );
                        tracing::info!("CGEvent: CONTROL RELEASED");
                    }

                    tracing::debug!(
                        "CGEvent FlagsChanged: flags=0x{:08x} (shift={}, cmd={}, opt={}, ctrl={})",
                        flags_bits,
                        shift_is_down,
                        cmd_is_down,
                        opt_is_down,
                        ctrl_is_down
                    );
                }
                _ => {}
            }

            // Pass event through unchanged
            None
        },
    );

    let event_tap = match event_tap_result {
        Ok(tap) => tap,
        Err(()) => {
            let _ = app.emit(
                "cgevent-test",
                CGEventTestEvent::Error {
                    message: "Failed to create CGEventTap".to_string(),
                },
            );
            tracing::error!("Failed to create CGEventTap");
            return;
        }
    };

    tracing::info!("CGEventTap created successfully in Tauri context");

    // Create run loop source
    let loop_source = match event_tap.mach_port.create_runloop_source(0) {
        Ok(source) => source,
        Err(()) => {
            let _ = app.emit(
                "cgevent-test",
                CGEventTestEvent::Error {
                    message: "Failed to create run loop source".to_string(),
                },
            );
            return;
        }
    };

    // Add to run loop
    unsafe {
        CFRunLoop::get_current().add_source(&loop_source, kCFRunLoopCommonModes);
    }

    // Enable the tap
    event_tap.enable();

    tracing::info!("CGEventTap enabled and listening");

    // Run until stop signal
    while !stop_signal.load(Ordering::SeqCst) {
        CFRunLoop::run_in_mode(
            unsafe { kCFRunLoopDefaultMode },
            Duration::from_millis(100),
            true,
        );
    }

    // Cleanup
    unsafe {
        CFRunLoop::get_current().remove_source(&loop_source, kCFRunLoopCommonModes);
    }

    tracing::info!("CGEventTap cleaned up");
}
