# Spotlight Paste Not Working - Investigation & Fix Plan

## Summary

Paste (Cmd+V) does not appear to work in the spotlight input field. This investigation identifies the root cause and proposes a fix.

## Component Hierarchy

```
Spotlight (spotlight.tsx)
  └── TriggerSearchInput (trigger-search-input.tsx)
      └── SearchInput (search-input.tsx)
          └── <textarea> (HTML element)
```

## Investigation Findings

### 1. No Explicit Paste Handler

The spotlight input relies on standard HTML textarea behavior for paste. There is **no explicit `onPaste` handler** anywhere in the component hierarchy:

- `SearchInput` (`search-input.tsx`) - No `onPaste` prop
- `TriggerSearchInput` (`trigger-search-input.tsx`) - No `onPaste` handler
- `Spotlight` (`spotlight.tsx`) - No paste event management

### 2. How Input Changes Are Currently Detected

The flow for detecting input changes is:

1. User pastes content
2. Browser fires `onChange` event on the textarea
3. `SearchInput.handleChange()` calls `checkExpansion()` then `onChange(e)`
4. `TriggerSearchInput.handleChange()` receives the event
5. It extracts `inputType` from `(e.nativeEvent as InputEvent).inputType`
6. Calls `analyzeInput(value, cursorPos, inputType)` to handle trigger autocomplete
7. Calls `onChange(value)` to update parent state
8. `Spotlight.handleQueryChange()` receives the new value and runs search

### 3. Trigger Autocomplete Paste Handling

In `use-trigger-autocomplete.ts` (line 105-109):

```typescript
// 1. Handle paste - don't activate on paste
if (inputType === "insertFromPaste") {
  close();
  return;
}
```

This is correct behavior - it prevents trigger autocomplete from activating when pasting text that contains trigger characters (like `@`).

### 4. Potential Issues Identified

#### Issue A: NSPanel Focus/Key Window Behavior

The spotlight uses macOS NSPanel which has special focus behavior:
- `.nonactivating_panel()` style mask
- `.no_activate(true)` configuration
- Panel becomes key window via `show_and_make_key()`

The NSPanel may not be properly receiving keyboard events including Cmd+V paste commands. The panel is configured with:

```rust
.style_mask(StyleMask::empty().borderless().nonactivating_panel())
```

The `nonactivating_panel` style means the panel doesn't activate the application when shown. This could affect how keyboard shortcuts are routed.

#### Issue B: Tauri WebView Keyboard Event Handling

Tauri webviews in NSPanels may have issues receiving keyboard shortcuts. The paste shortcut (Cmd+V) might be:
1. Intercepted by macOS before reaching the webview
2. Not properly forwarded to the focused textarea
3. Handled by Tauri's menu system before reaching the webview

#### Issue C: No `onPaste` Event Handler as Fallback

The components rely entirely on the `onChange` event with `inputType === "insertFromPaste"`. If the paste doesn't trigger an `onChange` event for any reason, there's no fallback mechanism.

### 5. Related Clipboard Code

The Rust clipboard module (`src-tauri/src/clipboard.rs`) handles:
- Clipboard history monitoring
- `paste_clipboard_entry` command that simulates Cmd+V via CGEvent

This is for the clipboard manager panel pasting TO other apps, not for pasting INTO the spotlight. However, it shows the app has accessibility permissions for keyboard simulation.

## Root Cause Hypothesis

The most likely cause is **NSPanel keyboard event handling** in Tauri. When the spotlight panel is shown:

1. It becomes the key window (receives keyboard input)
2. But due to `nonactivating_panel` style, the app doesn't activate
3. macOS may route Cmd+V to the system or previous app instead of the panel

This is supported by:
- The panel uses `no_activate(true)`
- The panel uses `nonactivating_panel()` style
- Standard keyboard input (typing) likely works because those are character events
- Cmd+V is a keyboard shortcut that macOS may handle differently

## Proposed Fix

### Option 1: Add Explicit Paste Event Handler (Recommended)

Add an `onPaste` handler to intercept clipboard events directly:

**In `search-input.tsx`:**

```typescript
export interface SearchInputProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  // ... existing props
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

// In the component:
const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  // Let the default paste behavior happen
  // Call onChange handler after paste completes
  setTimeout(() => {
    checkExpansion();
    if (internalRef.current && onChange) {
      // Create a synthetic change event
      const syntheticEvent = {
        target: internalRef.current,
        currentTarget: internalRef.current,
        nativeEvent: { inputType: "insertFromPaste" } as InputEvent,
      } as React.ChangeEvent<HTMLTextAreaElement>;
      onChange(syntheticEvent);
    }
  }, 0);
};

// Add to textarea:
<textarea
  ref={internalRef}
  onPaste={handlePaste}
  // ... other props
/>
```

### Option 2: Use Navigator Clipboard API

Read from clipboard directly when the input gains focus or on keydown:

```typescript
useEffect(() => {
  const handleKeyDown = async (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        // Insert text at cursor position
        if (internalRef.current) {
          const start = internalRef.current.selectionStart;
          const end = internalRef.current.selectionEnd;
          const currentValue = internalRef.current.value;
          const newValue = currentValue.slice(0, start) + text + currentValue.slice(end);
          onChange?.(/* synthetic event with newValue */);
        }
      } catch (err) {
        console.error("Failed to read clipboard:", err);
      }
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [onChange]);
```

### Option 3: Adjust NSPanel Configuration

Modify the Rust panel configuration to allow better keyboard handling:

```rust
// In panels.rs, try removing nonactivating_panel for spotlight
.style_mask(StyleMask::empty().borderless())  // Remove .nonactivating_panel()
```

This may affect the spotlight's behavior (causing app activation on show), but would ensure proper keyboard event routing.

## Testing Plan

1. **Verify the bug**: Open spotlight, try Cmd+V paste - confirm nothing happens
2. **Check event flow**: Add console.log in `handleChange` to see if paste triggers onChange
3. **Test onPaste handler**: Add `onPaste` handler with console.log to see if paste event fires
4. **Implement fix**: Apply Option 1 (most targeted fix)
5. **Verify fix**: Confirm Cmd+V paste now works in spotlight

## Files to Modify

1. `src/components/reusable/search-input.tsx` - Add onPaste handler
2. `src/components/reusable/trigger-search-input.tsx` - Forward onPaste prop
3. Possibly `src-tauri/src/panels.rs` - If NSPanel config changes are needed

## Priority

**High** - Paste is a fundamental text input operation. Users expect Cmd+V to work in any text field.
