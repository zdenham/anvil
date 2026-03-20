# Fix: Terminal blank and non-functional after creation

## Problem

When opening a terminal, xterm.js renders but is completely blank — no shell prompt, no output, and keyboard input does nothing. The terminal is fully non-functional.

## Root Cause

The transport layer was migrated from Tauri IPC to WebSocket-only (sidecar) for data commands, but the terminal subsystem wasn't fully migrated. Two gaps remain:

### 1. Event transport mismatch (no output reaches xterm.js)

Terminal event listeners in `listeners.ts:5` and `terminal-content.tsx:26` import `listen` from `@tauri-apps/api/event` (Tauri IPC). But terminal events (`terminal:output`, `terminal:exit`, `terminal:killed`) are now broadcast by the **sidecar** via WebSocket push — they never touch Tauri IPC. The listeners wait forever on the wrong transport and never fire.

**The fix**: Import `listen` from `@/lib/events` (WebSocket-based) instead of `@tauri-apps/api/event`.

### 2. Data format mismatch (byte arrays vs strings)

The old Rust PTY used byte arrays (`number[]`) for I/O. The sidecar uses `node-pty` which works with strings. Both directions are broken:

- **Output**: `listeners.ts` expects `data: number[]` and calls `decodeOutput()` which does `new Uint8Array(data)`. The sidecar sends `data` as a string (node-pty `onData` returns strings). Constructing `Uint8Array` from a string produces garbage.

- **Input**: `service.ts:189` encodes the string to a byte array (`Array.from(encoder.encode(data))`), then sends it as `data: number[]`. The sidecar's `dispatch-terminal.ts:28` extracts it as `string`, but at runtime it's still a `number[]`. `pty.write([65])` coerces to `"65"` — typing "A" sends literal "65" to the shell.

**The fix**: Align both sides on strings — the sidecar's native format.

## Phases

- [x] Phase 1: Fix event listener transport (`@tauri-apps/api/event` → `@/lib/events`)

- [x] Phase 2: Fix data format mismatch (byte arrays → strings)

- [x] Phase 3: Verify build and existing tests pass

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix event listener transport

### `src/entities/terminal-sessions/listeners.ts`

**Line 5**: Change import from:

```ts
import { listen } from "@tauri-apps/api/event";
```

to:

```ts
import { listen } from "@/lib/events";
```

The `@/lib/events` `listen()` function has the same signature (`(event, handler) → Promise<UnlistenFn>`) so no other changes needed.

Also update the `UnlistenFn` type: the `@/lib/events` module exports its own `UnlistenFn` type, but `listeners.ts` doesn't import it (it uses the return type implicitly). No type change needed.

### `src/components/content-pane/terminal-content.tsx`

**Line 26**: Change import from:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
```

to:

```ts
import { listen, type UnlistenFn } from "@/lib/events";
```

This fixes the `terminal:exit` listener at line 269 which also uses Tauri IPC.

## Phase 2: Fix data format mismatch

### Output: `src/entities/terminal-sessions/listeners.ts`

The sidecar sends `terminal:output` with `{ id: number, data: string }`. Update the payload type and skip the byte-to-string decode:

```ts
// Before:
interface TerminalOutputPayload {
  id: number;
  data: number[];
}

// After:
interface TerminalOutputPayload {
  id: number;
  data: string;
}
```

In the listener handler, replace:

```ts
const text = decodeOutput(termId, data);
appendOutput(termId, text);
```

with:

```ts
appendOutput(termId, data);
```

The `decodeOutput()` function (byte array → string via TextDecoder) is no longer needed on this path since the sidecar already sends decoded strings. Leave `decodeOutput` in `output-buffer.ts` for now (it may be used elsewhere or for tests).

### Input: `src/entities/terminal-sessions/service.ts`

**Line 188-191**: The `write()` method currently converts string → byte array. Since the sidecar expects a string directly:

```ts
// Before:
async write(id: string, data: string): Promise<void> {
  const bytes = Array.from(this.encoder.encode(data));
  await invoke("write_terminal", { id: this.getPtyId(id), data: bytes });
}

// After:
async write(id: string, data: string): Promise<void> {
  await invoke("write_terminal", { id: this.getPtyId(id), data });
}
```

The `encoder` field on the class (`private readonly encoder = new TextEncoder()`) can also be removed since it's no longer used.

## Phase 3: Build and test verification

- Run `pnpm check` (TypeScript) to verify no type errors from the import changes
- Run `pnpm test` to verify no unit test regressions
- Verify no other files import `decodeOutput` that might be affected

## Files to modify

| File | Change |
| --- | --- |
| `src/entities/terminal-sessions/listeners.ts` | Import `listen` from `@/lib/events`; change payload type to `string`; skip `decodeOutput` |
| `src/components/content-pane/terminal-content.tsx` | Import `listen` + `UnlistenFn` from `@/lib/events` |
| `src/entities/terminal-sessions/service.ts` | Send `data` as string directly in `write()`; remove `encoder` |
