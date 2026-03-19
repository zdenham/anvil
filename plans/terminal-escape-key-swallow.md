# Fix: Terminal should swallow Escape key

## Problem

Pressing Escape inside the terminal view also exits the "full screen view." The terminal should consume the Escape key without it propagating to parent UI handlers.

## Root Cause

In `src/components/content-pane/terminal-content.tsx:216-251`, xterm.js's `attachCustomKeyEventHandler` doesn't call `event.stopPropagation()` on keys the terminal consumes. The handler returns `true` (telling xterm to process the key), but the underlying DOM event still bubbles up through the document.

Multiple document/window-level `keydown` listeners catch the bubbled Escape:

- `control-panel-window.tsx:70-80` — unconditional `document.addEventListener("keydown")` that closes the panel on any Escape
- `use-permission-keyboard.ts:76` — Escape denies permissions (has a TEXTAREA guard, but could be fragile)
- `spotlight.tsx:838` — Escape hides spotlight
- `clipboard-manager.tsx:132` — Escape hides clipboard manager
- `search-panel.tsx:72` — Escape closes search
- `file-browser-panel.tsx:97` — Escape closes file browser
- macOS native layer may also receive the unhandled event

xterm.js handles keyboard events via a hidden `<textarea>`. It calls `preventDefault()` for keys it processes but does **not** call `stopPropagation()`. So every keypress in the terminal bubbles all the way to the document root.

## Fix

Add `event.stopPropagation()` in the `attachCustomKeyEventHandler` for all keys that the terminal should consume (i.e., keys that reach the final `return true`).

### File: `src/components/content-pane/terminal-content.tsx`

**Before** (lines 246-251):

```typescript
      // Let Cmd+C, Cmd+V, etc. pass through to the webview
      if (isMeta) return false;

      return true;
```

**After:**

```typescript
      // Let Cmd+C, Cmd+V, etc. pass through to the webview
      if (isMeta) return false;

      // Terminal consumes this key — stop the DOM event from bubbling to
      // document-level listeners (e.g. Escape closing panels, exiting fullscreen).
      event.stopPropagation();

      return true;
```

This is correct because:

- Keys that explicitly `return false` (Meta combos, custom bindings) **skip** `stopPropagation()` — they should reach the browser/webview
- Keys that `return true` are **terminal-owned** — Escape, regular typing, Ctrl sequences, etc. These should never bubble past the terminal

### Scope

Single line added in one file. No new dependencies, no behavior changes for any other component.

## Phases

- [x] Add `event.stopPropagation()` before the final `return true` in `attachCustomKeyEventHandler`

- [x] Verify no existing tests break (`cd agents && pnpm test` if terminal tests exist)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---