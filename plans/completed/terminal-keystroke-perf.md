# Terminal Keystroke Performance

## Problem

Multiple bottlenecks on the terminal hot path slow down keystrokes and add memory pressure.

## Phases

- [x] Fix `appendOutput` — the biggest offender
- [x] Eliminate double decoding of PTY output
- [x] Reduce allocations on the write (input) path

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix `appendOutput`

`store.ts:131-146` — called on **every** output chunk:

```ts
const existing = state.outputBuffers[id] || "";
let newBuffer = existing + data;
const lines = newBuffer.split("\n");
if (lines.length > OUTPUT_BUFFER_MAX_LINES) {
  newBuffer = lines.slice(-OUTPUT_BUFFER_MAX_LINES).join("\n");
}
return { outputBuffers: { ...state.outputBuffers, [id]: newBuffer } };
```

Problems:
- **`split("\n")` on the entire buffer every chunk** — with a 5000-line buffer, this allocates thousands of strings just to count lines
- **`join("\n")` to reassemble** — equally wasteful
- **String concatenation** on a growing buffer creates intermediate strings
- **Shallow copy of `outputBuffers`** triggers Zustand notification to all subscribers

Fix: Track a line count separately. Only trim when the count exceeds the limit, and trim by finding the Nth newline index rather than split/join. Batch Zustand updates by only calling `set()` when trimming is needed — or better, move outputBuffers out of Zustand entirely since no React component subscribes to live output changes (it's only read at mount time via `useState` initializer).

**Best approach**: Move `outputBuffers` out of Zustand into a plain `Map<string, string>` + line counter. This completely eliminates Zustand overhead (shallow copy, subscriber notification) from the hot path. The only consumer is `TerminalContent`'s `useState(() => ...)` initializer which reads it once at mount — it doesn't need reactivity.

## Phase 2: Eliminate double decoding

Both `listeners.ts` and `terminal-content.tsx` independently listen to `terminal:output` and each creates:
- `new TextDecoder()` — new instance per event
- `new Uint8Array(data)` — new typed array per event

That's **2x TextDecoder instantiations** and **2x Uint8Array allocations** per output event.

Fix: Decode once in `listeners.ts`, store the decoded string, and have `terminal-content.tsx` consume from the store or a shared event emitter rather than re-listening to the Tauri event and re-decoding. A simple approach: have `listeners.ts` emit a decoded event (e.g., via a lightweight EventEmitter or callback registry), and have `terminal-content.tsx` subscribe to that instead.

## Phase 3: Reduce write-path allocations

`service.ts:86-88` — called on **every keystroke**:

```ts
async write(id: string, data: string): Promise<void> {
  const bytes = Array.from(new TextEncoder().encode(data));
  await invoke("write_terminal", { id: parseInt(id, 10), data: bytes });
}
```

Problems:
- `new TextEncoder()` — new instance per keystroke (should be reused)
- `Array.from(...)` — converts `Uint8Array` → regular `Array` (extra allocation + copy)
- `parseInt(id, 10)` — re-parses on every call

Fix:
- Cache a `TextEncoder` instance on the service class
- Cache parsed numeric IDs (or store them as numbers from the start)
- Check if Tauri's `invoke` accepts `Uint8Array` directly — if so, skip `Array.from()`
