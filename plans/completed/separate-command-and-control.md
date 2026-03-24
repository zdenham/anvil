# Plan: Separate Command and Control Modifiers

## Problem

The codebase uses `CommandOrControl` which is a cross-platform pattern where:
- On macOS, it translates to Command
- On Windows/Linux, it translates to Control

However, per `docs/agents.md` line 109:
> "We only plan to support MacOS initially, so avoid any vendor specific code with platform checks."

Since we're macOS-only, `CommandOrControl` is unnecessary abstraction. Hotkeys should use `Command` directly.

## Current State

### Frontend (`src/lib/hotkey-service.ts:7-11`)
```typescript
const convertHotkeyToTauriFormat = (hotkey: string): string => {
  return hotkey
    .replace(/Command/g, "CommandOrControl")
    .replace(/Ctrl/g, "CommandOrControl");
};
```

This function converts `Command` to `CommandOrControl` before sending to Tauri. Every hotkey save/register call uses this conversion.

### Backend (`src-tauri/build.rs:7-12`)
The defaults already use `Command` directly:
```rust
let spotlight_hotkey = std::env::var("ANVIL_SPOTLIGHT_HOTKEY")
    .unwrap_or_else(|_| "Command+Space".to_string());
let clipboard_hotkey = std::env::var("ANVIL_CLIPBOARD_HOTKEY")
    .unwrap_or_else(|_| "Command+Option+C".to_string());
```

### UI (`src/components/onboarding/HotkeyRecorder.tsx`)
The recorder outputs `Command+Space` format (line 52), which is correct for macOS.

## Changes Required

### 1. Remove `convertHotkeyToTauriFormat` function

**File:** `src/lib/hotkey-service.ts`

Delete the `convertHotkeyToTauriFormat` function (lines 3-11) and update all usages to pass the hotkey directly:

- `registerGlobalHotkey`: Pass `hotkey` directly to invoke
- `saveHotkey`: Pass `hotkey` directly to invoke
- `saveClipboardHotkey`: Pass `hotkey` directly to invoke
- `saveTaskPanelHotkey`: Pass `hotkey` directly to invoke

### 2. Verify Tauri shortcut parsing

Tauri's shortcut parser on macOS should accept `Command` directly. The defaults in `build.rs` already use this format, confirming it works.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/hotkey-service.ts` | Remove `convertHotkeyToTauriFormat`, update 4 function calls |

## Testing

1. Run existing hotkey tests to ensure no regressions
2. Manual test: Set a custom hotkey in onboarding and verify it registers correctly
3. Verify saved hotkeys persist correctly across app restarts

## Risk Assessment

**Low risk** - The backend defaults already use `Command` format, so Tauri's parser definitely supports it. This change simplifies the code by removing an unnecessary abstraction.
