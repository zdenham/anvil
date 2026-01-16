use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::thread;
use std::time::Duration;

/// macOS virtual keycodes for common keys
#[allow(dead_code)]
pub mod keycodes {
    use core_graphics::event::CGKeyCode;

    pub const KEY_A: CGKeyCode = 0;
    pub const KEY_S: CGKeyCode = 1;
    pub const KEY_D: CGKeyCode = 2;
    pub const KEY_F: CGKeyCode = 3;
    pub const KEY_H: CGKeyCode = 4;
    pub const KEY_G: CGKeyCode = 5;
    pub const KEY_Z: CGKeyCode = 6;
    pub const KEY_X: CGKeyCode = 7;
    pub const KEY_C: CGKeyCode = 8;
    pub const KEY_V: CGKeyCode = 9;
    pub const KEY_B: CGKeyCode = 11;
    pub const KEY_Q: CGKeyCode = 12;
    pub const KEY_W: CGKeyCode = 13;
    pub const KEY_E: CGKeyCode = 14;
    pub const KEY_R: CGKeyCode = 15;
    pub const KEY_Y: CGKeyCode = 16;
    pub const KEY_T: CGKeyCode = 17;
    pub const KEY_1: CGKeyCode = 18;
    pub const KEY_2: CGKeyCode = 19;
    pub const KEY_3: CGKeyCode = 20;
    pub const KEY_4: CGKeyCode = 21;
    pub const KEY_6: CGKeyCode = 22;
    pub const KEY_5: CGKeyCode = 23;
    pub const KEY_EQUALS: CGKeyCode = 24;
    pub const KEY_9: CGKeyCode = 25;
    pub const KEY_7: CGKeyCode = 26;
    pub const KEY_MINUS: CGKeyCode = 27;
    pub const KEY_8: CGKeyCode = 28;
    pub const KEY_0: CGKeyCode = 29;
    pub const KEY_RIGHT_BRACKET: CGKeyCode = 30;
    pub const KEY_O: CGKeyCode = 31;
    pub const KEY_U: CGKeyCode = 32;
    pub const KEY_LEFT_BRACKET: CGKeyCode = 33;
    pub const KEY_I: CGKeyCode = 34;
    pub const KEY_P: CGKeyCode = 35;
    pub const KEY_RETURN: CGKeyCode = 36;
    pub const KEY_L: CGKeyCode = 37;
    pub const KEY_J: CGKeyCode = 38;
    pub const KEY_QUOTE: CGKeyCode = 39;
    pub const KEY_K: CGKeyCode = 40;
    pub const KEY_SEMICOLON: CGKeyCode = 41;
    pub const KEY_BACKSLASH: CGKeyCode = 42;
    pub const KEY_COMMA: CGKeyCode = 43;
    pub const KEY_SLASH: CGKeyCode = 44;
    pub const KEY_N: CGKeyCode = 45;
    pub const KEY_M: CGKeyCode = 46;
    pub const KEY_PERIOD: CGKeyCode = 47;
    pub const KEY_TAB: CGKeyCode = 48;
    pub const KEY_SPACE: CGKeyCode = 49;
    pub const KEY_GRAVE: CGKeyCode = 50;
    pub const KEY_DELETE: CGKeyCode = 51;
    pub const KEY_ESCAPE: CGKeyCode = 53;
    pub const KEY_F5: CGKeyCode = 96;
    pub const KEY_F6: CGKeyCode = 97;
    pub const KEY_F7: CGKeyCode = 98;
    pub const KEY_F3: CGKeyCode = 99;
    pub const KEY_F8: CGKeyCode = 100;
    pub const KEY_F9: CGKeyCode = 101;
    pub const KEY_F11: CGKeyCode = 103;
    pub const KEY_F13: CGKeyCode = 105;
    pub const KEY_F14: CGKeyCode = 107;
    pub const KEY_F10: CGKeyCode = 109;
    pub const KEY_F12: CGKeyCode = 111;
    pub const KEY_F15: CGKeyCode = 113;
    pub const KEY_HOME: CGKeyCode = 115;
    pub const KEY_PAGE_UP: CGKeyCode = 116;
    pub const KEY_FORWARD_DELETE: CGKeyCode = 117;
    pub const KEY_F4: CGKeyCode = 118;
    pub const KEY_END: CGKeyCode = 119;
    pub const KEY_F2: CGKeyCode = 120;
    pub const KEY_PAGE_DOWN: CGKeyCode = 121;
    pub const KEY_F1: CGKeyCode = 122;
    pub const KEY_LEFT: CGKeyCode = 123;
    pub const KEY_RIGHT: CGKeyCode = 124;
    pub const KEY_DOWN: CGKeyCode = 125;
    pub const KEY_UP: CGKeyCode = 126;

    // Modifier keys
    pub const KEY_LEFT_SHIFT: CGKeyCode = 56;
    pub const KEY_RIGHT_SHIFT: CGKeyCode = 60;
    pub const KEY_LEFT_CONTROL: CGKeyCode = 59;
    pub const KEY_RIGHT_CONTROL: CGKeyCode = 62;
    pub const KEY_LEFT_OPTION: CGKeyCode = 58;
    pub const KEY_RIGHT_OPTION: CGKeyCode = 61;
    pub const KEY_LEFT_COMMAND: CGKeyCode = 55;
    pub const KEY_RIGHT_COMMAND: CGKeyCode = 54;
}

/// Parse modifier string like "Command+Option" into CGEventFlags
pub fn parse_modifiers(modifiers: &[&str]) -> CGEventFlags {
    let mut flags = CGEventFlags::empty();
    for m in modifiers {
        match m.to_lowercase().as_str() {
            "command" | "cmd" => flags |= CGEventFlags::CGEventFlagCommand,
            "option" | "alt" => flags |= CGEventFlags::CGEventFlagAlternate,
            "control" | "ctrl" => flags |= CGEventFlags::CGEventFlagControl,
            "shift" => flags |= CGEventFlags::CGEventFlagShift,
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
        "delete" | "backspace" => Some(keycodes::KEY_DELETE),
        "forwarddelete" => Some(keycodes::KEY_FORWARD_DELETE),
        "arrowdown" | "down" => Some(keycodes::KEY_DOWN),
        "arrowup" | "up" => Some(keycodes::KEY_UP),
        "arrowleft" | "left" => Some(keycodes::KEY_LEFT),
        "arrowright" | "right" => Some(keycodes::KEY_RIGHT),
        "home" => Some(keycodes::KEY_HOME),
        "end" => Some(keycodes::KEY_END),
        "pageup" => Some(keycodes::KEY_PAGE_UP),
        "pagedown" => Some(keycodes::KEY_PAGE_DOWN),
        "f1" => Some(keycodes::KEY_F1),
        "f2" => Some(keycodes::KEY_F2),
        "f3" => Some(keycodes::KEY_F3),
        "f4" => Some(keycodes::KEY_F4),
        "f5" => Some(keycodes::KEY_F5),
        "f6" => Some(keycodes::KEY_F6),
        "f7" => Some(keycodes::KEY_F7),
        "f8" => Some(keycodes::KEY_F8),
        "f9" => Some(keycodes::KEY_F9),
        "f10" => Some(keycodes::KEY_F10),
        "f11" => Some(keycodes::KEY_F11),
        "f12" => Some(keycodes::KEY_F12),
        // Single letters - map to their keycodes
        "a" => Some(keycodes::KEY_A),
        "b" => Some(keycodes::KEY_B),
        "c" => Some(keycodes::KEY_C),
        "d" => Some(keycodes::KEY_D),
        "e" => Some(keycodes::KEY_E),
        "f" => Some(keycodes::KEY_F),
        "g" => Some(keycodes::KEY_G),
        "h" => Some(keycodes::KEY_H),
        "i" => Some(keycodes::KEY_I),
        "j" => Some(keycodes::KEY_J),
        "k" => Some(keycodes::KEY_K),
        "l" => Some(keycodes::KEY_L),
        "m" => Some(keycodes::KEY_M),
        "n" => Some(keycodes::KEY_N),
        "o" => Some(keycodes::KEY_O),
        "p" => Some(keycodes::KEY_P),
        "q" => Some(keycodes::KEY_Q),
        "r" => Some(keycodes::KEY_R),
        "s" => Some(keycodes::KEY_S),
        "t" => Some(keycodes::KEY_T),
        "u" => Some(keycodes::KEY_U),
        "v" => Some(keycodes::KEY_V),
        "w" => Some(keycodes::KEY_W),
        "x" => Some(keycodes::KEY_X),
        "y" => Some(keycodes::KEY_Y),
        "z" => Some(keycodes::KEY_Z),
        // Numbers
        "0" => Some(keycodes::KEY_0),
        "1" => Some(keycodes::KEY_1),
        "2" => Some(keycodes::KEY_2),
        "3" => Some(keycodes::KEY_3),
        "4" => Some(keycodes::KEY_4),
        "5" => Some(keycodes::KEY_5),
        "6" => Some(keycodes::KEY_6),
        "7" => Some(keycodes::KEY_7),
        "8" => Some(keycodes::KEY_8),
        "9" => Some(keycodes::KEY_9),
        // Punctuation
        "-" | "minus" => Some(keycodes::KEY_MINUS),
        "=" | "equals" => Some(keycodes::KEY_EQUALS),
        "[" | "leftbracket" => Some(keycodes::KEY_LEFT_BRACKET),
        "]" | "rightbracket" => Some(keycodes::KEY_RIGHT_BRACKET),
        "\\" | "backslash" => Some(keycodes::KEY_BACKSLASH),
        ";" | "semicolon" => Some(keycodes::KEY_SEMICOLON),
        "'" | "quote" => Some(keycodes::KEY_QUOTE),
        "," | "comma" => Some(keycodes::KEY_COMMA),
        "." | "period" => Some(keycodes::KEY_PERIOD),
        "/" | "slash" => Some(keycodes::KEY_SLASH),
        "`" | "grave" => Some(keycodes::KEY_GRAVE),
        _ => None,
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

    let keycode =
        parse_key(key_name).ok_or_else(|| format!("Unknown key: {}", key_name))?;
    let flags = parse_modifiers(modifiers);

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    // Key down
    let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| "Failed to create key down event")?;
    if !flags.is_empty() {
        key_down.set_flags(flags);
    }

    // Key up
    let key_up = CGEvent::new_keyboard_event(source, keycode, false)
        .map_err(|_| "Failed to create key up event")?;
    if !flags.is_empty() {
        key_up.set_flags(flags);
    }

    // Post events to Session (routes to key window in user session)
    // HID posts too low-level and may not reach the target app
    key_down.post(CGEventTapLocation::Session);
    thread::sleep(Duration::from_millis(10));
    key_up.post(CGEventTapLocation::Session);

    Ok(())
}

/// Type a string by posting individual key events
pub fn type_string(text: &str) -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    for c in text.chars() {
        let c_lower = c.to_ascii_lowercase();
        if let Some(keycode) = parse_key(&c_lower.to_string()) {
            let flags = if c.is_uppercase() {
                CGEventFlags::CGEventFlagShift
            } else {
                CGEventFlags::empty()
            };

            let key_down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
                .map_err(|_| "Failed to create key event")?;
            if !flags.is_empty() {
                key_down.set_flags(flags);
            }

            let key_up = CGEvent::new_keyboard_event(source.clone(), keycode, false)
                .map_err(|_| "Failed to create key event")?;
            if !flags.is_empty() {
                key_up.set_flags(flags);
            }

            key_down.post(CGEventTapLocation::Session);
            thread::sleep(Duration::from_millis(5));
            key_up.post(CGEventTapLocation::Session);
            thread::sleep(Duration::from_millis(20));
        }
    }

    Ok(())
}
