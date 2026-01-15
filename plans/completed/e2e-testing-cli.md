# Plan: E2E Testing CLI for Claude Code Automation

## Goal

Create an end-to-end testing infrastructure that enables Claude Code (AI agent) to programmatically interact with the Mortician application, observe behavior through logs, and validate functionality - all without interfering with the user's active session.

---

## Key Requirements

| Requirement | Description |
|-------------|-------------|
| **CLI Interface** | Simple command-line tool Claude Code can invoke via Bash |
| **Background Execution** | Tests run isolated from user's active session |
| **Observable** | Structured logs/output Claude Code can parse |
| **High-Level Actions** | Simulate real user flows (open spotlight, search, select result) |
| **Dual Input Mode** | Support both real keystrokes and programmatic dispatch |

---

## Architecture: Native Accessibility APIs

**Key insight**: The app already uses `CGEventPost` for clipboard paste simulation (see `src-tauri/src/clipboard.rs:18-46`). We can use the same pattern to trigger any hotkey natively, testing the real input path users experience.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Claude Code                               │
│                   (uses mort-test CLI)                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       mort-test CLI                             │
│                       (Rust binary)                             │
│                                                                 │
│  mort-test trigger "Command+Space"   # Native hotkey trigger    │
│  mort-test trigger "Command+Option+C" # Open clipboard         │
│  mort-test type "cursor"             # Type search query        │
│  mort-test key ArrowDown Enter       # Navigate and select      │
│  mort-test observe panels            # Watch panel visibility   │
│  mort-test wait panel:spotlight      # Block until visible      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
          ▼                                   ▼
┌──────────────────────────┐     ┌────────────────────────────────┐
│    CGEventPost API       │     │      AXUIElement API           │
│                          │     │                                │
│  • Post keyboard events  │     │  • Query window list           │
│  • Trigger global hotkeys│     │  • Observe panel visibility    │
│  • Simulate typing       │     │  • Get UI element state        │
│  • Set modifier flags    │     │  • Wait for state changes      │
└──────────────────────────┘     └────────────────────────────────┘
          │                                   │
          ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│               Mortician App (NORMAL INSTANCE)                   │
│                                                                 │
│  • Receives hotkey via tauri-plugin-global-shortcut            │
│  • Shows/hides panels as normal                                 │
│  • NO test mode needed - tests real behavior                    │
│  • Full integration with clipboard, agents, etc.                │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Won't Steal Focus

This approach works without interfering with the user's active session due to how macOS handles events at different layers:

**1. CGEventPost injects at the HID layer, not the window layer**

```
┌─────────────────────────────────────────────────────────────┐
│                    Physical Keyboard                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              HID (Human Interface Device) Layer             │
│         ← CGEventPost injects events HERE                   │
│           No focus change, just "fake" keypresses           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Window Server                           │
│         Routes events to frontmost app OR                   │
│         global shortcut handlers                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌─────────────────────┐       ┌───────────────────────────────┐
│   Frontmost App     │       │  Global Shortcut Handlers     │
│   (e.g., VS Code)   │       │  (tauri-plugin-global-shortcut)│
└─────────────────────┘       └───────────────────────────────┘
```

When `mort-test trigger "Command+Space"` runs:
- CGEventPost creates a synthetic Cmd+Space at the HID layer
- The window server sees this as a real keypress
- `tauri-plugin-global-shortcut` catches it (registered global hotkey)
- The user's frontmost app (VS Code, etc.) is unaffected

**2. NSPanel is designed for non-focus-stealing overlays**

Mortician's panels use `NSPanel` (via `tauri-nspanel`) specifically because:
- Panels appear above other windows without becoming the "key window"
- The previous app remains focused and receives keyboard input after panel closes
- This is the same pattern used by macOS Spotlight, Alfred, Raycast

From `clipboard.rs:18-19`:
```rust
/// Simulate Cmd+V to paste into the currently active app using native CGEvent API.
/// Since NSPanel doesn't steal focus, the previous app is still frontmost.
```

**3. The CLI runs independently**

The `mort-test` CLI can run from:
- A terminal window (even in background)
- Claude Code's bash tool
- A cron job or launchd service
- Another process entirely

It doesn't need to be focused to post events. The events are injected at the system level.

**Requirements:**
- Mortician must have **Accessibility permissions** (System Preferences → Privacy & Security → Accessibility)
- This is likely already granted for clipboard monitoring

---

## Component Design

### 1. Keyboard Input Module (CGEvent)

Reuse the existing `CGEvent` pattern from `clipboard.rs` to trigger any keyboard shortcut:

**File: `src-tauri/src/bin/mort-test/keyboard.rs`**

```rust
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::thread;
use std::time::Duration;

/// macOS virtual keycodes for common keys
pub mod keycodes {
    use core_graphics::event::CGKeyCode;

    pub const KEY_A: CGKeyCode = 0;
    pub const KEY_S: CGKeyCode = 1;
    pub const KEY_D: CGKeyCode = 2;
    pub const KEY_SPACE: CGKeyCode = 49;
    pub const KEY_RETURN: CGKeyCode = 36;
    pub const KEY_ESCAPE: CGKeyCode = 53;
    pub const KEY_TAB: CGKeyCode = 48;
    pub const KEY_DOWN: CGKeyCode = 125;
    pub const KEY_UP: CGKeyCode = 126;
    pub const KEY_LEFT: CGKeyCode = 123;
    pub const KEY_RIGHT: CGKeyCode = 124;
    // ... full keycode map
}

/// Parse modifier string like "Command+Option" into CGEventFlags
pub fn parse_modifiers(modifiers: &[&str]) -> CGEventFlags {
    let mut flags = CGEventFlags::empty();
    for m in modifiers {
        match m.to_lowercase().as_str() {
            "command" | "cmd" | "⌘" => flags |= CGEventFlags::CGEventFlagCommand,
            "option" | "alt" | "⌥" => flags |= CGEventFlags::CGEventFlagAlternate,
            "control" | "ctrl" | "⌃" => flags |= CGEventFlags::CGEventFlagControl,
            "shift" | "⇧" => flags |= CGEventFlags::CGEventFlagShift,
            _ => {}
        }
    }
    flags
}

/// Parse key name to keycode
pub fn parse_key(key: &str) -> Option<CGKeyCode> {
    match key.to_lowercase().as_str() {
        "space" => Some(keycodes::KEY_SPACE),
        "return" | "enter" => Some(keycodes::KEY_RETURN),
        "escape" | "esc" => Some(keycodes::KEY_ESCAPE),
        "tab" => Some(keycodes::KEY_TAB),
        "arrowdown" | "down" => Some(keycodes::KEY_DOWN),
        "arrowup" | "up" => Some(keycodes::KEY_UP),
        "arrowleft" | "left" => Some(keycodes::KEY_LEFT),
        "arrowright" | "right" => Some(keycodes::KEY_RIGHT),
        // Single letters
        s if s.len() == 1 => {
            let c = s.chars().next()?;
            if c.is_ascii_alphabetic() {
                Some((c.to_ascii_lowercase() as u8 - b'a') as CGKeyCode)
            } else {
                None
            }
        }
        _ => None
    }
}

/// Post a keyboard shortcut (e.g., "Command+Space")
pub fn trigger_shortcut(shortcut: &str) -> Result<(), String> {
    let parts: Vec<&str> = shortcut.split('+').collect();
    if parts.is_empty() {
        return Err("Empty shortcut".to_string());
    }

    let key_name = parts.last().unwrap();
    let modifiers = &parts[..parts.len() - 1];

    let keycode = parse_key(key_name)
        .ok_or_else(|| format!("Unknown key: {}", key_name))?;
    let flags = parse_modifiers(modifiers);

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    // Key down
    let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| "Failed to create key down event")?;
    key_down.set_flags(flags);

    // Key up
    let key_up = CGEvent::new_keyboard_event(source, keycode, false)
        .map_err(|_| "Failed to create key up event")?;
    key_up.set_flags(flags);

    // Post events
    key_down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(10));
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

/// Type a string by posting individual key events
pub fn type_string(text: &str) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    for c in text.chars() {
        if let Some(keycode) = parse_key(&c.to_string()) {
            let flags = if c.is_uppercase() {
                CGEventFlags::CGEventFlagShift
            } else {
                CGEventFlags::empty()
            };

            let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
                .map_err(|_| "Failed to create key event")?;
            key_down.set_flags(flags);

            let key_up = CGEvent::new_keyboard_event(source.clone(), keycode, false)
                .map_err(|_| "Failed to create key event")?;
            key_up.set_flags(flags);

            key_down.post(CGEventTapLocation::HID);
            thread::sleep(Duration::from_millis(5));
            key_up.post(CGEventTapLocation::HID);
            thread::sleep(Duration::from_millis(20));
        }
    }

    Ok(())
}
```

### 2. Window Observation Module (AXUIElement)

Use macOS Accessibility APIs to observe panel visibility:

**File: `src-tauri/src/bin/mort-test/accessibility.rs`**

```rust
use accessibility::{AXUIElement, AXUIElementAttributes};

/// Find Mortician windows using Accessibility API
pub fn get_mortician_windows() -> Vec<WindowInfo> {
    let app = AXUIElement::application_with_bundle_identifier("com.mort.spotlight")
        .or_else(|| AXUIElement::application_with_name("Mortician"));

    let Some(app) = app else {
        return vec![];
    };

    let windows = app.windows().unwrap_or_default();
    windows.iter().filter_map(|w| {
        Some(WindowInfo {
            title: w.title().ok()?,
            role: w.role().ok()?,
            visible: w.attribute("AXMinimized").ok()? != "1",
            position: w.position().ok()?,
            size: w.size().ok()?,
        })
    }).collect()
}

/// Check if a specific panel is visible
pub fn is_panel_visible(panel_name: &str) -> bool {
    get_mortician_windows()
        .iter()
        .any(|w| w.title.contains(panel_name) && w.visible)
}

/// Wait for panel to become visible (with timeout)
pub fn wait_for_panel(panel_name: &str, timeout_ms: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if is_panel_visible(panel_name) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    Err(format!("Timeout waiting for panel: {}", panel_name))
}

/// Wait for panel to be hidden
pub fn wait_for_panel_hidden(panel_name: &str, timeout_ms: u64) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if !is_panel_visible(panel_name) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    Err(format!("Timeout waiting for panel to hide: {}", panel_name))
}
```

### 3. CLI Tool (mort-test)

Standalone Rust binary that uses the above modules:

**File: `src-tauri/src/bin/mort-test/main.rs`**

```rust
use clap::{Parser, Subcommand};

mod keyboard;
mod accessibility;

#[derive(Parser)]
#[command(name = "mort-test")]
#[command(about = "E2E testing CLI for Mortician using native macOS APIs")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Trigger a keyboard shortcut (e.g., "Command+Space")
    Trigger {
        /// The shortcut to trigger (e.g., "Command+Space", "Command+Option+C")
        shortcut: String,
    },

    /// Type text using synthetic keyboard events
    Type {
        /// The text to type
        text: String,
    },

    /// Send individual key presses
    Key {
        /// Keys to press (e.g., "ArrowDown", "Enter")
        keys: Vec<String>,
    },

    /// List visible Mortician windows
    Windows,

    /// Wait for a panel to become visible
    Wait {
        /// Panel name to wait for (e.g., "spotlight", "clipboard")
        panel: String,

        /// Timeout in milliseconds
        #[arg(short, long, default_value = "5000")]
        timeout: u64,
    },

    /// Check if a panel is currently visible
    Check {
        /// Panel name to check
        panel: String,
    },

    /// Run a test scenario
    Scenario {
        /// Scenario name
        name: String,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Trigger { shortcut } => {
            keyboard::trigger_shortcut(&shortcut)?;
            println!("✓ Triggered: {}", shortcut);
        }

        Commands::Type { text } => {
            keyboard::type_string(&text)?;
            println!("✓ Typed: {}", text);
        }

        Commands::Key { keys } => {
            for key in &keys {
                keyboard::trigger_shortcut(key)?;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            println!("✓ Pressed: {:?}", keys);
        }

        Commands::Windows => {
            let windows = accessibility::get_mortician_windows();
            println!("{}", serde_json::to_string_pretty(&windows)?);
        }

        Commands::Wait { panel, timeout } => {
            accessibility::wait_for_panel(&panel, timeout)?;
            println!("✓ Panel visible: {}", panel);
        }

        Commands::Check { panel } => {
            let visible = accessibility::is_panel_visible(&panel);
            println!("{}", serde_json::json!({ "panel": panel, "visible": visible }));
            std::process::exit(if visible { 0 } else { 1 });
        }

        Commands::Scenario { name } => {
            run_scenario(&name)?;
        }
    }

    Ok(())
}

fn run_scenario(name: &str) -> Result<(), Box<dyn std::error::Error>> {
    match name {
        "spotlight-search" => {
            // Open spotlight
            keyboard::trigger_shortcut("Command+Space")?;
            accessibility::wait_for_panel("spotlight", 2000)?;

            // Type query
            std::thread::sleep(std::time::Duration::from_millis(100));
            keyboard::type_string("cursor")?;

            // Navigate and select
            std::thread::sleep(std::time::Duration::from_millis(500));
            keyboard::trigger_shortcut("ArrowDown")?;
            keyboard::trigger_shortcut("Return")?;

            // Wait for panel to close
            accessibility::wait_for_panel_hidden("spotlight", 2000)?;

            println!("✓ Scenario complete: spotlight-search");
        }
        _ => {
            return Err(format!("Unknown scenario: {}", name).into());
        }
    }
    Ok(())
}
```

---

## Test Scenarios for Claude Code

Example test scenarios the CLI should support:

### Scenario 1: Spotlight Search Flow

```bash
# Open spotlight with hotkey
mort-test trigger "Command+Space"

# Wait for panel to appear
mort-test wait spotlight --timeout 2000

# Type search query
mort-test type "cursor"

# Navigate and select result
sleep 0.5
mort-test key ArrowDown
mort-test key Return

# Verify panel closed
mort-test wait spotlight --hidden --timeout 2000
```

### Scenario 2: Clipboard History

```bash
# Open clipboard panel
mort-test trigger "Command+Option+C"

# Wait for panel
mort-test wait clipboard --timeout 2000

# Navigate items
mort-test key ArrowDown
mort-test key ArrowDown

# Select item (pastes to active app)
mort-test key Return

# Verify panel closed
mort-test wait clipboard --hidden --timeout 2000
```

### Scenario 3: Full Scenario Runner

```bash
# Run predefined scenario
mort-test scenario spotlight-search
# Output: ✓ Scenario complete: spotlight-search

# Check current window state
mort-test windows
# Output: [{"title": "Spotlight", "visible": false}, ...]
```

---

## Implementation Phases

### Phase 1: Core CLI & Keyboard Module

1. Create `mort-test` Rust binary in `src-tauri/src/bin/`
2. Implement CGEvent keyboard input module
3. Add shortcut parsing (modifiers + key)
4. Add `trigger` and `type` commands

**Files:**
- `src-tauri/src/bin/mort-test/main.rs` (new)
- `src-tauri/src/bin/mort-test/keyboard.rs` (new)

**Commands:**
- `mort-test trigger "Command+Space"`
- `mort-test type "search query"`
- `mort-test key ArrowDown Enter`

### Phase 2: Window Observation (AXUIElement)

1. Implement AXUIElement window queries
2. Add panel visibility detection
3. Add wait-for-panel functionality
4. JSON output for window state

**Files:**
- `src-tauri/src/bin/mort-test/accessibility.rs` (new)

**Commands:**
- `mort-test windows`
- `mort-test check spotlight`
- `mort-test wait spotlight --timeout 5000`

### Phase 3: Test Scenarios

1. Add `scenario` subcommand
2. Implement common test flows (spotlight-search, clipboard-open, etc.)
3. Add structured JSON output for all commands
4. Add error handling and timeouts

**Commands:**
- `mort-test scenario spotlight-search`
- `mort-test scenario clipboard-paste`

### Phase 4: Documentation & CI

1. Document CLI usage for Claude Code
2. Add example test scripts
3. Ensure accessibility permissions are documented

---

## Success Criteria

- [ ] `mort-test trigger` can invoke global hotkeys (Command+Space, etc.)
- [ ] `mort-test type` can type text into the active panel
- [ ] `mort-test key` can send navigation keys (arrows, enter, escape)
- [ ] `mort-test windows` can list Mortician panels and their visibility
- [ ] `mort-test wait` can block until a panel appears/disappears
- [ ] `mort-test scenario` can run predefined test flows
- [ ] Tests run without interfering with user's active session
- [ ] Tests complete in reasonable time (<30s for typical scenarios)

---

## References

- [Core Graphics Event Services](https://developer.apple.com/documentation/coregraphics/quartz_event_services)
- [Accessibility API (AXUIElement)](https://developer.apple.com/documentation/applicationservices/axuielement_h)
