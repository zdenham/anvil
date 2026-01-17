//! CGEvent tap testing module
//!
//! This module provides headless testing of CGEventTap functionality
//! to validate that we can listen to global keyboard events.

use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    EventField,
};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Statistics collected during event tap test
#[derive(Debug, Default)]
pub struct EventTapStats {
    pub total_events: u32,
    pub key_down_events: u32,
    pub key_up_events: u32,
    pub flags_changed_events: u32,
    pub shift_releases: u32,
    pub command_releases: u32,
    pub option_releases: u32,
    pub control_releases: u32,
}

/// Atomic version of stats for thread-safe updates
#[derive(Debug, Default)]
struct EventTapStatsAtomic {
    total_events: AtomicU32,
    key_down_events: AtomicU32,
    key_up_events: AtomicU32,
    flags_changed_events: AtomicU32,
    shift_releases: AtomicU32,
    command_releases: AtomicU32,
    option_releases: AtomicU32,
    control_releases: AtomicU32,
}

impl EventTapStatsAtomic {
    fn to_stats(&self) -> EventTapStats {
        EventTapStats {
            total_events: self.total_events.load(Ordering::Relaxed),
            key_down_events: self.key_down_events.load(Ordering::Relaxed),
            key_up_events: self.key_up_events.load(Ordering::Relaxed),
            flags_changed_events: self.flags_changed_events.load(Ordering::Relaxed),
            shift_releases: self.shift_releases.load(Ordering::Relaxed),
            command_releases: self.command_releases.load(Ordering::Relaxed),
            option_releases: self.option_releases.load(Ordering::Relaxed),
            control_releases: self.control_releases.load(Ordering::Relaxed),
        }
    }
}

/// Result of the CGEventTap test
#[derive(Debug)]
pub struct EventTapTestResult {
    pub success: bool,
    pub tap_created: bool,
    pub run_loop_attached: bool,
    pub events_received: bool,
    pub stats: EventTapStats,
    pub error: Option<String>,
}

/// Modifier flag bits from CGEventFlags
const SHIFT_MASK: u64 = 0x00020000; // CGEventFlags::CGEventFlagShift
const COMMAND_MASK: u64 = 0x00100000; // CGEventFlags::CGEventFlagCommand
const OPTION_MASK: u64 = 0x00080000; // CGEventFlags::CGEventFlagAlternate
const CONTROL_MASK: u64 = 0x00040000; // CGEventFlags::CGEventFlagControl

/// Test CGEventTap functionality
///
/// This function:
/// 1. Creates a CGEventTap to intercept keyboard events
/// 2. Runs the event loop for the specified duration
/// 3. Collects statistics on received events
/// 4. Returns detailed results for validation
pub fn test_cgevent_tap(duration: Duration, modifiers_only: bool) -> EventTapTestResult {
    // Check accessibility permission first
    if !mort_lib::accessibility::is_accessibility_trusted() {
        return EventTapTestResult {
            success: false,
            tap_created: false,
            run_loop_attached: false,
            events_received: false,
            stats: EventTapStats::default(),
            error: Some("Accessibility permission not granted. Run: mort-test request-accessibility".to_string()),
        };
    }

    // Shared state for the callback
    let stats = Arc::new(EventTapStatsAtomic::default());
    let stats_clone = stats.clone();

    // Track previous modifier state to detect releases
    let prev_flags = Arc::new(AtomicU64::new(0));
    let prev_flags_clone = prev_flags.clone();

    // Event types to listen for
    let events_of_interest: Vec<CGEventType> = if modifiers_only {
        vec![CGEventType::FlagsChanged]
    } else {
        vec![
            CGEventType::KeyDown,
            CGEventType::KeyUp,
            CGEventType::FlagsChanged,
        ]
    };

    eprintln!("Creating CGEventTap...");
    eprintln!("  Listening for: {:?}", events_of_interest);
    eprintln!("  Duration: {} seconds", duration.as_secs());
    eprintln!("  Tap location: HID (earliest in pipeline)");

    // Create the event tap
    // Using HID location which is earliest in the event pipeline and catches all events
    // The callback returns None to pass the event through unchanged (ListenOnly mode)
    let event_tap_result = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        events_of_interest,
        move |_proxy, event_type, event| {
            stats_clone.total_events.fetch_add(1, Ordering::Relaxed);

            match event_type {
                CGEventType::KeyDown => {
                    stats_clone.key_down_events.fetch_add(1, Ordering::Relaxed);
                    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                    eprintln!("  KeyDown: keycode={}", keycode);
                }
                CGEventType::KeyUp => {
                    stats_clone.key_up_events.fetch_add(1, Ordering::Relaxed);
                    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                    eprintln!("  KeyUp: keycode={}", keycode);
                }
                CGEventType::FlagsChanged => {
                    stats_clone
                        .flags_changed_events
                        .fetch_add(1, Ordering::Relaxed);

                    let flags = event.get_flags();
                    let flags_bits = flags.bits();
                    let old_flags = prev_flags_clone.swap(flags_bits, Ordering::SeqCst);

                    // Detect modifier releases (was set, now clear)
                    let shift_was_down = (old_flags & SHIFT_MASK) != 0;
                    let shift_is_down = (flags_bits & SHIFT_MASK) != 0;
                    if shift_was_down && !shift_is_down {
                        stats_clone.shift_releases.fetch_add(1, Ordering::Relaxed);
                        eprintln!("  >>> SHIFT RELEASED <<<");
                    } else if !shift_was_down && shift_is_down {
                        eprintln!("  Shift pressed");
                    }

                    let cmd_was_down = (old_flags & COMMAND_MASK) != 0;
                    let cmd_is_down = (flags_bits & COMMAND_MASK) != 0;
                    if cmd_was_down && !cmd_is_down {
                        stats_clone.command_releases.fetch_add(1, Ordering::Relaxed);
                        eprintln!("  >>> COMMAND RELEASED <<<");
                    } else if !cmd_was_down && cmd_is_down {
                        eprintln!("  Command pressed");
                    }

                    let opt_was_down = (old_flags & OPTION_MASK) != 0;
                    let opt_is_down = (flags_bits & OPTION_MASK) != 0;
                    if opt_was_down && !opt_is_down {
                        stats_clone.option_releases.fetch_add(1, Ordering::Relaxed);
                        eprintln!("  >>> OPTION RELEASED <<<");
                    } else if !opt_was_down && opt_is_down {
                        eprintln!("  Option pressed");
                    }

                    let ctrl_was_down = (old_flags & CONTROL_MASK) != 0;
                    let ctrl_is_down = (flags_bits & CONTROL_MASK) != 0;
                    if ctrl_was_down && !ctrl_is_down {
                        stats_clone.control_releases.fetch_add(1, Ordering::Relaxed);
                        eprintln!("  >>> CONTROL RELEASED <<<");
                    } else if !ctrl_was_down && ctrl_is_down {
                        eprintln!("  Control pressed");
                    }

                    eprintln!(
                        "  FlagsChanged: flags=0x{:08x} (shift={}, cmd={}, opt={}, ctrl={})",
                        flags_bits, shift_is_down, cmd_is_down, opt_is_down, ctrl_is_down
                    );
                }
                _ => {
                    eprintln!("  Other event: {:?}", event_type);
                }
            }

            // Return None to pass the event through unchanged
            None
        },
    );

    let event_tap = match event_tap_result {
        Ok(tap) => tap,
        Err(()) => {
            return EventTapTestResult {
                success: false,
                tap_created: false,
                run_loop_attached: false,
                events_received: false,
                stats: EventTapStats::default(),
                error: Some("Failed to create CGEventTap. Check accessibility permissions.".to_string()),
            };
        }
    };

    eprintln!("CGEventTap created successfully!");

    // Create run loop source from the mach port
    let loop_source = match event_tap.mach_port.create_runloop_source(0) {
        Ok(source) => source,
        Err(()) => {
            return EventTapTestResult {
                success: false,
                tap_created: true,
                run_loop_attached: false,
                events_received: false,
                stats: stats.to_stats(),
                error: Some("Failed to create run loop source".to_string()),
            };
        }
    };

    // Add source to run loop
    unsafe {
        CFRunLoop::get_current().add_source(&loop_source, kCFRunLoopCommonModes);
    }

    // Enable the tap
    event_tap.enable();

    eprintln!("\n=== CGEventTap is now listening ===");
    eprintln!("Press PHYSICAL keys to test (synthetic events from same process may not be captured).");
    eprintln!("Modifier key releases will be logged.");
    eprintln!("Test will end in {} seconds.\n", duration.as_secs());
    eprintln!("NOTE: If running in a terminal without physical keyboard input,");
    eprintln!("      no events will be captured. This is expected behavior.");

    // Run the event loop for the specified duration
    let start = Instant::now();
    while start.elapsed() < duration {
        // Run the run loop for 100ms at a time to allow checking elapsed time
        CFRunLoop::run_in_mode(
            unsafe { kCFRunLoopDefaultMode },
            Duration::from_millis(100),
            true,
        );
    }

    // Cleanup
    eprintln!("\n=== Test complete, cleaning up ===");

    // Disable the tap first
    // Note: The tap is automatically disabled when dropped

    // Remove source from run loop
    unsafe {
        CFRunLoop::get_current().remove_source(&loop_source, kCFRunLoopCommonModes);
    }

    let final_stats = stats.to_stats();

    eprintln!("\n=== Final Statistics ===");
    eprintln!("Total events: {}", final_stats.total_events);
    eprintln!("Key down events: {}", final_stats.key_down_events);
    eprintln!("Key up events: {}", final_stats.key_up_events);
    eprintln!("Flags changed events: {}", final_stats.flags_changed_events);
    eprintln!("Shift releases: {}", final_stats.shift_releases);
    eprintln!("Command releases: {}", final_stats.command_releases);
    eprintln!("Option releases: {}", final_stats.option_releases);
    eprintln!("Control releases: {}", final_stats.control_releases);

    EventTapTestResult {
        success: final_stats.total_events > 0,
        tap_created: true,
        run_loop_attached: true,
        events_received: final_stats.total_events > 0,
        stats: final_stats,
        error: None,
    }
}
