# Fix Clipboard Stale Query and Entries

## Problem

The clipboard panel opens with the previous search query still populated and shows stale entries. The design intent is for the `ClipboardManager` component to **remount with fresh state** each time the panel is hidden (via `instanceKey` increment in `ClipboardManagerWrapper`).

## Root Cause

**`clipboard-main.tsx` never calls `connectWs()`** — the WebSocket connection is never established.

All event delivery in this app flows through WebSocket push messages (`ws_broadcast` from Rust → WS server → client). Without a WS connection, the clipboard window cannot receive:

1. **`panel-hidden`** — triggers the `instanceKey` increment that remounts `ClipboardManager`, resetting query to `""` and entries to `[]`
2. **`clipboard-entry-added`** — triggers `loadEntries()` to pick up new clipboard items while the panel is open
3. **`window:focus-changed`** — triggers auto-focus of the search input when the panel regains focus

Every other window (`main.tsx:27`, `spotlight-main.tsx:29`, `control-panel-main.tsx:63`) calls `connectWs()` at module level. The clipboard window is the only one missing it.

## Evidence

- `src/clipboard-main.tsx` — imports `invoke` from `@/lib/invoke` but does NOT import or call `connectWs`
- `src/lib/invoke.ts:176` — `connectWs()` establishes the WebSocket that receives push events
- `src/lib/events.ts:30-41` — `dispatchWsEvent` is the only way push events reach `listen()` handlers
- `src-tauri/src/panels.rs:324` — `panel-hidden` is sent via `ws_broadcast`, not Tauri IPC
- Native commands (`get_clipboard_history`, `paste_clipboard_entry`, etc.) still work because they route through Tauri IPC per `NATIVE_COMMANDS` set — this is why the panel partially works despite the missing WS connection

## Phases

- [x] Add `connectWs()` call to `clipboard-main.tsx`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

In `src/clipboard-main.tsx`:

1. Add `connectWs` to the import from `@/lib/invoke`
2. Call `connectWs().catch(() => {})` at module level before `bootstrap()`, matching the pattern in other windows

**That's it.** One import change, one line added. The existing `ClipboardManagerWrapper` remount logic and `ClipboardManager` event listeners are already correct — they just never receive events because the transport isn't connected.
