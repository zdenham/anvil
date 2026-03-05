# Terminal macOS Keybindings

## Problem

xterm.js doesn't translate macOS keyboard shortcuts into terminal escape sequences. Native macOS terminals (Terminal.app, iTerm2) explicitly map these, but xterm.js running in a Tauri webview either ignores them or the webview consumes them.

Affected shortcuts:
- `Cmd+Left` — should move cursor to beginning of line (doesn't work)
- `Cmd+Right` — should move cursor to end of line (doesn't work)
- `Cmd+Backspace` — should delete to beginning of line (doesn't work)

## Solution

Add `attachCustomKeyEventHandler` to the xterm.js Terminal instance in `src/components/content-pane/terminal-content.tsx` that intercepts macOS shortcuts and writes the corresponding escape sequences via `terminal.onData` / `handleInput`.

### Key → Escape Sequence Mapping

| Shortcut | Action | Escape Sequence |
|---|---|---|
| `Cmd+Left` | Beginning of line | `\x01` (Ctrl+A) |
| `Cmd+Right` | End of line | `\x05` (Ctrl+E) |
| `Cmd+Backspace` | Delete to beginning of line | `\x15` (Ctrl+U) |
| `Option+Left` | Word back | `\x1bb` (ESC+b) |
| `Option+Right` | Word forward | `\x1bf` (ESC+f) |
| `Option+Backspace` | Delete word back | `\x17` (Ctrl+W) |

These match what iTerm2 sends by default with its "Natural Text Editing" preset.

### Implementation

In `terminal-content.tsx`, after creating the Terminal instance (~line 133), add:

```ts
terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
  if (event.type !== "keydown") return true;

  const isMeta = event.metaKey;
  const isAlt = event.altKey;

  if (isMeta && event.key === "ArrowLeft") {
    handleInput("\x01"); // Ctrl+A — beginning of line
    return false;
  }
  if (isMeta && event.key === "ArrowRight") {
    handleInput("\x05"); // Ctrl+E — end of line
    return false;
  }
  if (isMeta && event.key === "Backspace") {
    handleInput("\x15"); // Ctrl+U — kill line backward
    return false;
  }
  if (isAlt && event.key === "ArrowLeft") {
    handleInput("\x1bb"); // ESC+b — word back
    return false;
  }
  if (isAlt && event.key === "ArrowRight") {
    handleInput("\x1bf"); // ESC+f — word forward
    return false;
  }
  if (isAlt && event.key === "Backspace") {
    handleInput("\x17"); // Ctrl+W — delete word back
    return false;
  }

  // Let Cmd+C, Cmd+V, etc. pass through to the webview
  if (isMeta) return false;

  return true;
});
```

Returning `false` tells xterm.js to not process the event, and our `handleInput` writes the escape sequence directly to the PTY.

The final `if (isMeta) return false` ensures other Cmd shortcuts (copy, paste, quit, etc.) still reach the webview/Tauri menu handlers.

## Phases

- [x] Add `attachCustomKeyEventHandler` with macOS shortcut mappings to `terminal-content.tsx`
- [x] Verify Cmd+C/V/Q and other system shortcuts still work (not intercepted)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files

- `src/components/content-pane/terminal-content.tsx` — only file that needs changes
