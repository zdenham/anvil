# Hotkey Interception During Recording Investigation

## Problem Statement

When users attempt to record a custom hotkey using the HotkeyRecorder component, if they want to set their hotkey to something already registered by the system or another application (e.g., "Command+Space" for Spotlight), the system hotkey triggers first. This causes:

1. The window/input to lose focus (e.g., Spotlight opens)
2. The hotkey recording fails
3. Poor user experience when trying to override common hotkeys

## Current Architecture

### Frontend: HotkeyRecorder Component
**Location:** `src/components/onboarding/HotkeyRecorder.tsx`

The component uses React keyboard events (`onKeyDown`, `onKeyUp`) which:
- Only work when the component has focus
- Cannot intercept events before they reach the system
- Cannot prevent system hotkeys from firing

### Backend: CGEventTap Infrastructure
**Location:** `src-tauri/src/cgevent_test.rs`

The codebase already has a working CGEventTap implementation that:
- Creates event taps at the HID level (earliest in the event pipeline)
- Listens for `KeyDown`, `KeyUp`, and `FlagsChanged` events
- Tracks modifier state changes
- Emits events to the frontend via Tauri's event system
- Currently uses `CGEventTapOptions::ListenOnly` (passive, cannot block)

## Technical Investigation

### macOS Event Pipeline

```
Keyboard Hardware
     ↓
CGEventTap (HID, HeadInsert) ← We can intercept HERE
     ↓
System Shortcuts (Spotlight, dictation, etc.)
     ↓
Application Event Handlers
```

### CGEventTap Options

| Option | Can Monitor | Can Block/Modify | Use Case |
|--------|-------------|------------------|----------|
| `ListenOnly` | ✅ | ❌ | Passive monitoring |
| `DefaultTap` | ✅ | ✅ | Active filtering/interception |

### Blocking Events with DefaultTap

With `CGEventTapOptions::DefaultTap`:
- Returning `None` from the callback **swallows/blocks** the event (like `event.preventDefault()` in JS)
- Returning `Some(event)` passes the event through
- This allows selective blocking based on application state

### Accessibility Permission Requirements

The app already has accessibility infrastructure:
- `is_accessibility_trusted()` - Checks current permission status
- `check_accessibility_with_prompt()` - Prompts user if needed
- Accessibility is required for `DefaultTap` mode to work

**Important:** With `DefaultTap`, if accessibility permission is revoked, the tap will hang rather than fail gracefully. The code must handle `kCGEventTapDisabledByTimeout` and `kCGEventTapDisabledByUserInput` events to re-enable the tap.

## Feasibility Assessment: ✅ FEASIBLE

Yes, intercepting hotkeys during recording is feasible. Here's why:

1. **Existing Infrastructure**: The codebase already has CGEventTap working in `cgevent_test.rs`
2. **Accessibility Permission**: Already requested and managed
3. **Proven Pattern**: Apps like [alt-tab-macos](https://github.com/lwouis/alt-tab-macos/blob/master/src/logic/events/KeyboardEvents.swift) use this exact approach successfully
4. **Minimal Change**: Only need to switch from `ListenOnly` to `DefaultTap` and add conditional blocking logic

## Recommended Approach

### Option A: Recording-Mode Event Tap (Recommended)

Create a dedicated "recording mode" that temporarily intercepts all keyboard events.

**Flow:**
1. User clicks HotkeyRecorder to start recording
2. Frontend calls `start_hotkey_recording()` Tauri command
3. Backend creates CGEventTap with `DefaultTap` option
4. All keyboard events are blocked and forwarded to frontend via Tauri events
5. Frontend receives native events (keycode + modifiers) and updates UI
6. When recording completes (hotkey captured or cancelled), frontend calls `stop_hotkey_recording()`
7. Backend destroys the event tap, restoring normal keyboard behavior

**Pros:**
- Clean isolation - only intercepts during recording
- No impact on normal app operation
- Leverages existing `cgevent_test.rs` patterns
- Frontend logic stays largely the same (receives events, manages state)

**Cons:**
- Slight complexity in managing tap lifecycle
- Brief window where all keyboard input is blocked (only during recording)

### Option B: Continuous Event Tap with State Flag

Keep a persistent event tap running, but only block events when a "recording" flag is set.

**Flow:**
1. Event tap runs continuously with `DefaultTap`
2. Backend maintains `is_recording: AtomicBool` state
3. When recording starts, set flag to true
4. Callback checks flag: if recording, block and emit; otherwise pass through
5. When recording ends, set flag to false

**Pros:**
- No tap creation/destruction overhead
- Faster response when entering recording mode

**Cons:**
- Continuous resource usage even when not recording
- More complex state management
- Potential for stale state if app crashes during recording

### Recommendation: Option A

Option A is cleaner and safer. The tap creation overhead is negligible (milliseconds) and the isolation prevents any risk of blocking keyboard input when not needed.

## Implementation Plan

### Phase 1: Backend Module
Create `src-tauri/src/hotkey_recording.rs`:

```rust
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType,
};

pub struct HotkeyRecordingState {
    is_recording: AtomicBool,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
    stop_signal: Arc<AtomicBool>,
}

// Tauri commands
#[tauri::command]
pub fn start_hotkey_recording(app: AppHandle) -> Result<bool, String>

#[tauri::command]
pub fn stop_hotkey_recording(app: AppHandle) -> Result<(), String>

// Internal: run event tap with DefaultTap, blocking all events
fn run_recording_tap(app: AppHandle, stop_signal: Arc<AtomicBool>) {
    let event_tap = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::DefaultTap,  // Changed from ListenOnly
        vec![
            CGEventType::KeyDown,
            CGEventType::KeyUp,
            CGEventType::FlagsChanged,
        ],
        move |_proxy, event_type, event| {
            // Emit event to frontend
            emit_keyboard_event(&app, event_type, event);

            // Return None to block the event from reaching system
            None
        },
    );
    // ... run loop setup
}
```

### Phase 2: Event Types
Define event payloads for frontend consumption:

```rust
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum HotkeyRecordingEvent {
    #[serde(rename = "started")]
    Started,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "key_down")]
    KeyDown { keycode: i64, modifiers: ModifierState },
    #[serde(rename = "key_up")]
    KeyUp { keycode: i64, modifiers: ModifierState },
    #[serde(rename = "modifiers_changed")]
    ModifiersChanged { modifiers: ModifierState },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Clone, serde::Serialize)]
pub struct ModifierState {
    shift: bool,
    command: bool,
    option: bool,
    control: bool,
}
```

### Phase 3: Frontend Service
Add to `src/lib/hotkey-service.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface HotkeyRecordingEvent {
  type: "started" | "stopped" | "key_down" | "key_up" | "modifiers_changed" | "error";
  keycode?: number;
  modifiers?: {
    shift: boolean;
    command: boolean;
    option: boolean;
    control: boolean;
  };
  message?: string;
}

export async function startHotkeyRecording(): Promise<boolean> {
  return invoke("start_hotkey_recording");
}

export async function stopHotkeyRecording(): Promise<void> {
  return invoke("stop_hotkey_recording");
}

export async function listenForRecordingEvents(
  callback: (event: HotkeyRecordingEvent) => void
): Promise<UnlistenFn> {
  return listen("hotkey-recording", (event) => {
    callback(event.payload as HotkeyRecordingEvent);
  });
}
```

### Phase 4: HotkeyRecorder Component Updates
Modify `src/components/onboarding/HotkeyRecorder.tsx`:

```typescript
// Add native recording mode
const [useNativeRecording, setUseNativeRecording] = useState(true);

useEffect(() => {
  if (!isFocused || !useNativeRecording) return;

  let unlisten: UnlistenFn | null = null;

  const setup = async () => {
    // Start native recording when focused
    await startHotkeyRecording();

    unlisten = await listenForRecordingEvents((event) => {
      if (event.type === "key_down" && event.modifiers && event.keycode) {
        // Convert keycode to key string
        const key = keycodeToKey(event.keycode);
        // Process same as before, but using native events
        handleNativeKeyDown(event.modifiers, key);
      }
      // ... handle other events
    });
  };

  setup();

  return () => {
    stopHotkeyRecording();
    unlisten?.();
  };
}, [isFocused, useNativeRecording]);
```

### Phase 5: Keycode Mapping
Create mapping from macOS keycodes to key strings:

```typescript
// src/utils/keycode-mapping.ts
export const MACOS_KEYCODES: Record<number, string> = {
  0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x",
  8: "c", 9: "v", 11: "b", 12: "q", 13: "w", 14: "e", 15: "r",
  17: "t", 16: "y", 32: "u", 34: "i", 31: "p", 35: "o", 33: "k",
  37: "l", 36: "Enter", 49: "Space", 51: "Backspace", 53: "Escape",
  123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp",
  // ... complete mapping
};

export function keycodeToKey(keycode: number): string {
  return MACOS_KEYCODES[keycode] ?? `Unknown(${keycode})`;
}
```

## Critical: Robust Cleanup Strategy

**This is the most important section.** If the event tap is not cleaned up, the user's keyboard becomes completely non-functional. We need defense-in-depth with multiple independent cleanup mechanisms.

### Defense Layer 1: RAII/Drop Pattern in Rust

Wrap the event tap in a struct that implements `Drop` to guarantee cleanup when the struct goes out of scope:

```rust
/// RAII wrapper that guarantees event tap cleanup
struct RecordingEventTap {
    stop_signal: Arc<AtomicBool>,
    thread_handle: Option<JoinHandle<()>>,
    run_loop_source: Option<CFRunLoopSource>,
}

impl Drop for RecordingEventTap {
    fn drop(&mut self) {
        tracing::info!("RecordingEventTap::drop - ensuring cleanup");

        // Signal thread to stop
        self.stop_signal.store(true, Ordering::SeqCst);

        // Remove from run loop if we have the source
        if let Some(ref source) = self.run_loop_source {
            unsafe {
                CFRunLoop::get_current().remove_source(source, kCFRunLoopCommonModes);
            }
        }

        // Wait for thread with timeout
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join(); // Best effort
        }

        tracing::info!("RecordingEventTap cleanup complete");
    }
}
```

### Defense Layer 2: Automatic Timeout

The recording tap should have a **maximum lifetime**. No legitimate hotkey recording should take more than 30 seconds:

```rust
const MAX_RECORDING_DURATION: Duration = Duration::from_secs(30);

fn run_recording_tap(app: AppHandle, stop_signal: Arc<AtomicBool>) {
    let start_time = Instant::now();

    // ... event tap setup ...

    while !stop_signal.load(Ordering::SeqCst) {
        // Auto-expire after timeout
        if start_time.elapsed() > MAX_RECORDING_DURATION {
            tracing::warn!("Recording tap auto-expired after {:?}", MAX_RECORDING_DURATION);
            let _ = app.emit("hotkey-recording", HotkeyRecordingEvent::Error {
                message: "Recording timed out".to_string(),
            });
            break;
        }

        CFRunLoop::run_in_mode(
            unsafe { kCFRunLoopDefaultMode },
            Duration::from_millis(100),
            true,
        );
    }

    // Cleanup happens here or via Drop
}
```

### Defense Layer 3: Heartbeat/Watchdog

The backend should monitor if the frontend is still alive. If no heartbeat is received, auto-cleanup:

```rust
static LAST_HEARTBEAT: OnceLock<AtomicU64> = OnceLock::new();

#[tauri::command]
pub fn recording_heartbeat() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    LAST_HEARTBEAT
        .get_or_init(|| AtomicU64::new(0))
        .store(now, Ordering::SeqCst);
}

// In the recording loop, check heartbeat
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);

fn check_heartbeat() -> bool {
    let last = LAST_HEARTBEAT
        .get()
        .map(|v| v.load(Ordering::SeqCst))
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    now - last < HEARTBEAT_TIMEOUT.as_secs()
}
```

Frontend sends heartbeat every 1-2 seconds while recording:

```typescript
useEffect(() => {
  if (!isRecording) return;

  const interval = setInterval(() => {
    invoke("recording_heartbeat");
  }, 1000);

  return () => clearInterval(interval);
}, [isRecording]);
```

### Defense Layer 4: Window Event Hooks

Use Tauri's `on_window_event` to detect when windows are closed or hidden:

```rust
// In lib.rs, add to on_window_event handler
.on_window_event(|window, event| {
    match event {
        tauri::WindowEvent::CloseRequested { .. } |
        tauri::WindowEvent::Destroyed => {
            // Stop any active recording when window closes
            if hotkey_recording::is_recording() {
                tracing::warn!("Window closed during recording - forcing cleanup");
                let _ = hotkey_recording::force_stop();
            }
        }
        tauri::WindowEvent::Focused(false) => {
            // Optionally: stop recording when window loses focus
            // This is aggressive but safe
            if hotkey_recording::is_recording() {
                tracing::info!("Window lost focus during recording - stopping");
                let _ = hotkey_recording::force_stop();
            }
        }
        _ => {}
    }
})
```

### Defense Layer 5: App Lifecycle Hooks

Ensure cleanup on app exit:

```rust
// In the run() closure
.run(|app_handle, event| {
    match event {
        tauri::RunEvent::Exit => {
            // Ensure recording is stopped on app exit
            if hotkey_recording::is_recording() {
                tracing::warn!("App exiting during recording - forcing cleanup");
                let _ = hotkey_recording::force_stop();
            }
        }
        tauri::RunEvent::ExitRequested { .. } => {
            // Same for exit requested
            if hotkey_recording::is_recording() {
                let _ = hotkey_recording::force_stop();
            }
        }
        _ => {}
    }
})
```

### Defense Layer 6: Frontend Visibility API

React to page visibility changes (tab hidden, window minimized):

```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden && isRecording) {
      console.warn("Page hidden during recording - stopping");
      stopHotkeyRecording();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}, [isRecording]);
```

### Defense Layer 7: Panic Handler

Catch panics in the recording thread and ensure cleanup:

```rust
fn run_recording_tap(app: AppHandle, stop_signal: Arc<AtomicBool>) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_recording_tap_inner(app.clone(), stop_signal.clone());
    }));

    if result.is_err() {
        tracing::error!("Recording tap panicked - ensuring cleanup");
        // Cleanup is handled by Drop, but we can emit an error
        let _ = app.emit("hotkey-recording", HotkeyRecordingEvent::Error {
            message: "Recording crashed unexpectedly".to_string(),
        });
    }
}
```

### Summary: Cleanup Triggers

| Trigger | Mechanism | Reliability |
|---------|-----------|-------------|
| Normal completion | Frontend calls `stop_hotkey_recording()` | Primary path |
| Component unmount | `useEffect` cleanup | Very reliable |
| Recording timeout | 30-second auto-expire | Guaranteed |
| Heartbeat timeout | 5-second watchdog | Highly reliable |
| Window close | `on_window_event` handler | Reliable |
| Window blur | `on_window_event` handler | Optional/aggressive |
| App exit | `RunEvent::Exit` handler | Reliable |
| Page hidden | Visibility API | Browser-level |
| Struct dropped | Rust `Drop` trait | Guaranteed |
| Thread panic | `catch_unwind` + Drop | Guaranteed |

With all these layers, the event tap will be cleaned up even if:
- The frontend crashes
- The user force-quits the window
- The IPC connection breaks
- The recording thread panics
- The user walks away for 30+ seconds

## Edge Cases to Handle

1. **Tap Disabled by System**
   - Handle `kCGEventTapDisabledByTimeout` and `kCGEventTapDisabledByUserInput`
   - Re-enable the tap when these events are received

2. **Permission Revoked Mid-Recording**
   - Check `AXIsProcessTrusted()` periodically or on tap failure
   - Gracefully fall back to React events if permission lost

3. **User Closes Recorder Without Completing**
   - Covered by Defense Layers 4, 5, and the `useEffect` cleanup

4. **Multiple Recorders Active**
   - Only one recording session should be active at a time
   - Return error if `start_hotkey_recording` called while already recording

5. **Escape Key Handling**
   - Should Escape cancel recording and be blocked, or pass through?
   - Recommend: Block during recording, use as "cancel" action

## Testing Plan

1. **Unit Tests**: Test keycode mapping functions
2. **Integration Tests**: Test Tauri command invocation and event emission
3. **Manual Tests**:
   - Record "Command+Space" (overrides Spotlight)
   - Record "Command+Tab" (overrides app switcher)
   - Record "Command+Q" (overrides quit)
   - Verify normal keyboard works after recording stops
   - Test permission revocation scenarios

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Blocking keyboard permanently | High | Always stop tap on component unmount; add timeout failsafe |
| Permission prompt fatigue | Medium | Check permission status before starting; cache status |
| Tap disabled by system | Medium | Handle disable events and re-enable |
| Performance impact | Low | Tap only runs during recording (short duration) |

## Alternatives Considered

### 1. Temporarily Unregister System Shortcuts
Could unregister the app's own hotkeys during recording to prevent conflicts.
**Rejected:** Doesn't help with system hotkeys (Spotlight, Mission Control) or other apps' hotkeys.

### 2. Use Tauri's Global Shortcut with Wildcard
Try to register a "catch-all" shortcut.
**Rejected:** Not supported by Tauri's global shortcut API.

### 3. Always Block, Then Re-inject
Block all events, then programmatically re-inject them after checking if recording.
**Rejected:** Over-complicated; selective blocking is cleaner.

## References

- [Encyclopedia of Daniel - OS X Event Tap](https://encyclopediaofdaniel.com/blog/os-x-event-tap/)
- [R0uter's Blog - macOS keyboard event intercepted three ways](https://www.logcg.com/en/archives/2902.html)
- [Medium - Capture Key Bindings in Swift](https://gaitatzis.medium.com/capture-key-bindings-in-swift-3050b0ccbf42)
- [AeroSpace GitHub Issue #1012 - CGEvent.tapCreate for global hotkeys](https://github.com/nikitabobko/AeroSpace/issues/1012)
- [Apple Developer Forums - Keyboard Event Interception](https://developer.apple.com/forums/thread/111112)
- [alt-tab-macos - KeyboardEvents.swift](https://github.com/lwouis/alt-tab-macos/blob/master/src/logic/events/KeyboardEvents.swift)

## Conclusion

Intercepting hotkeys at the native level during recording is **fully feasible** given the existing accessibility permissions and CGEventTap infrastructure in the codebase. The recommended approach (Option A: Recording-Mode Event Tap) provides:

- Clean isolation of interception to only when needed
- Leverages existing tested code patterns
- Minimal impact on normal app operation
- Good user experience - users can set any hotkey regardless of system conflicts

Implementation effort: Medium (estimated 3-5 files, leveraging existing infrastructure)
