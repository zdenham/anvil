# Fix Terminal TUI Rendering Issues

Three issues to fix: garbled characters, cursor misalignment, and resize flicker.

## Analysis

### 1. Garbled characters (`─���─`) — UTF-8 split across chunks

**Root cause**: The Rust PTY reader reads in 16KB chunks (`terminal.rs:157`). Multi-byte UTF-8 characters (like box-drawing `─` = 3 bytes) can be split across two reads. Each chunk is decoded independently by a **single shared `TextDecoder`** (`output-buffer.ts:21`) without `{ stream: true }`, so:

- Read 1 ends with bytes 1-2 of a 3-byte char → decoded as `�` (replacement)
- Read 2 starts with orphan continuation byte → decoded as `�`

Worse, the decoder is shared across **all terminals**. Even with `stream: true`, interleaved output from different terminals would corrupt each other's buffered partial sequences.

**Fix**: Use per-terminal `TextDecoder` instances with `{ stream: true }` in the decode call. This lets the decoder buffer incomplete sequences and complete them on the next chunk for that specific terminal.

**Files**: `src/entities/terminal-sessions/output-buffer.ts`

- Remove the shared `decoder` singleton
- Create a `Map<string, TextDecoder>` keyed by terminal ID
- In `decodeOutput`, accept the terminal ID and get/create a per-terminal decoder
- Call `decoder.decode(data, { stream: true })` to enable streaming mode
- Clean up the decoder in `clearOutputBuffer`
- Update `listeners.ts` to pass the terminal ID to `decodeOutput`

### 2. Cursor position off in TUIs — likely caused by #1

Garbled UTF-8 corrupts escape sequences too, not just visible characters. A TUI cursor-positioning sequence like `\x1b[10;5H` (move to row 10, col 5) split across chunks would be partially decoded, causing xterm.js to misinterpret it. Fixing #1 should resolve most cursor issues.

If cursor issues persist after fixing #1, secondary suspects:
- `rescaleOverlappingGlyphs: true` — can distort glyph metrics in the cell grid
- WebGL renderer edge cases with certain character widths

### 3. Black flicker on resize

During resize, the WebGL canvas framebuffer is cleared before the terminal re-renders content. The default WebGL clear color is `#000000`, so even though the terminal theme background is `#141514`, there's a visible black flash between frames. VS Code's terminal (also xterm.js + WebGL) avoids this.

**Root cause**: `new WebglAddon()` is called without `preserveDrawingBuffer`, so the GPU discards the back buffer after each present. During resize, the canvas dimensions change → old buffer is discarded → brief black frame → terminal re-renders.

**Fix** (two layers):

1. **`preserveDrawingBuffer: true`** — pass to `WebglAddon` constructor (`terminal-content.tsx:157`). This tells the GPU to keep the last rendered frame in the buffer, so during resize the old content stays visible until the terminal re-renders. This is the primary fix and matches how VS Code handles it. The perf cost is negligible for a terminal (no 60fps animation).

2. **Background color on inner container** — add `bg-[#141514]` to the inner div as a safety net for edge cases where the canvas hasn't painted yet (first render, WebGL context loss recovery). Use the raw hex to exactly match the WebGL clear color and theme background.

**File**: `src/components/content-pane/terminal-content.tsx`

```tsx
// Before:
const webglAddon = new WebglAddon();

// After:
const webglAddon = new WebglAddon(true); // preserveDrawingBuffer — prevents black flash on resize
```

### 4. Buffer size

Both `scrollback` (xterm.js) and `OUTPUT_BUFFER_MAX_LINES` (replay buffer) are 5000 lines. For long build output or logs this can feel short. Bump both to 10,000 — memory cost is ~10MB worst case per terminal, which is fine.

**Files**: `src/components/content-pane/terminal-content.tsx` (scrollback), `src/entities/terminal-sessions/types.ts` (OUTPUT_BUFFER_MAX_LINES)

## Phases

- [x] Fix per-terminal TextDecoder with stream mode (output-buffer.ts + listeners.ts)
- [x] Fix resize flicker: preserveDrawingBuffer + inner div background (terminal-content.tsx)
- [x] Bump scrollback and output buffer to 10,000 lines
- [x] Test TUI rendering — verify box-drawing characters, cursor positioning, and smooth resize

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
