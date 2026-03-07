# Terminal Improvements Plan

Make the Mort terminal render TUIs properly (claude code, vim, htop, etc.), eliminate font aliasing issues, and reduce input lag — approaching VS Code terminal quality.

## Current State

- **xterm.js v6.0** with addons: `fit`, `webgl`, `search`
- **Renderer**: WebGL (with canvas fallback on context loss)
- **Font**: `Menlo, Monaco, 'Courier New', monospace` at 13px, lineHeight 1.2
- **TERM**: `xterm-256color` (only env var set for color)
- **PTY**: `portable-pty` with 4096-byte read buffer
- **Missing addons**: unicode-graphemes, web-links, clipboard, serialize, web-fonts
- **Missing env vars**: `COLORTERM`, `LANG`, `LC_ALL`
- **No scrollback config** (uses xterm.js default of 1000 lines)
- **No `rescaleOverlappingGlyphs`** option set
- **Resize debounce**: 100ms timeout + requestAnimationFrame (double-debounce)

## Problem Analysis

### 1. TUI Rendering Issues (claude code, vim, htop, etc.)

**Root causes:**

- **Missing `COLORTERM=truecolor`** — TUI apps like neovim, helix, and claude code check this to decide whether to use 24-bit color. Without it, they fall back to 256-color or even 16-color palettes, which look wrong. ([termstandard/colors](https://github.com/termstandard/colors), [wezterm#875](https://github.com/wezterm/wezterm/issues/875))

- **Missing `LANG`/`LC_ALL` locale** — Without proper locale (e.g., `en_US.UTF-8`), TUI apps may fall back to ASCII box-drawing characters instead of Unicode, and emoji/wide-char handling breaks. Many TUI frameworks check locale before enabling UTF-8 rendering.

- **No Unicode graphemes addon** — xterm.js default Unicode handling is basic. Compound emoji, CJK wide characters, and grapheme clusters can misalign the grid. The `@xterm/addon-unicode-graphemes` addon fixes width calculations for modern Unicode. ([xtermjs#3304](https://github.com/xtermjs/xterm.js/issues/3304))

- **No scrollback tuning** — Default 1000 lines may be insufficient for TUI apps that write lots of output before switching to alternate screen buffer. VS Code defaults to 1000 but allows configuring up to 100,000.

- **`rescaleOverlappingGlyphs` not enabled** — This Terminal option (added in xterm.js 5.x) rescales glyphs that would overlap adjacent cells, which is common with powerline symbols and some box-drawing characters. VS Code enables this.

### 2. Font Aliasing / Blurry Text

**Root causes:**

- **Non-round `devicePixelRatio`** — Fixed in xterm.js 5.0+ ([xtermjs PRs #3926, #4009, #4105](https://github.com/xtermjs/xterm.js/releases)). We're on v6.0 so this core fix is present, but we may still have issues from:

- **No `-webkit-font-smoothing` CSS override** — Tauri's WebView2/WKWebView may apply suboptimal font smoothing by default. Adding `-webkit-font-smoothing: antialiased` on the terminal container can produce crisper text on macOS Retina displays. ([xtermjs#2464](https://github.com/xtermjs/xterm.js/issues/2464))

- **`allowTransparency` interaction** — Not currently set (good), but worth noting: enabling it disables subpixel anti-aliasing in the WebGL renderer since text must be drawn without opaque background. ([xtermjs#973](https://github.com/xtermjs/xterm.js/issues/973))

- **Container padding (`p-2`)** — The `p-2` (8px) padding on the terminal container may cause the xterm canvas to be slightly misaligned with the pixel grid, contributing to subpixel rendering artifacts. The fit addon calculates dimensions based on available space minus padding.

### 3. Input Lag

**Root causes:**

- **Double-debounce on resize** — The ResizeObserver callback wraps `handleResize` in `requestAnimationFrame`, but `handleResize` itself applies a 100ms `setTimeout` debounce. This means resizes take at minimum 100ms + 1 frame. This shouldn't cause typing lag directly, but during resize operations (common when switching panes), it creates noticeable sluggishness.

- **Main-thread-bound parsing** — xterm.js does all parsing/rendering on the main thread. With heavy output (e.g., `cat large-file.txt`), the terminal can become unresponsive. This is an inherent xterm.js limitation, but we can mitigate with flow control. ([xtermjs#3368](https://github.com/xtermjs/xterm.js/issues/3368))

- **4096-byte read buffer** — The Rust PTY reader uses a 4096-byte buffer. For high-throughput scenarios, larger buffers (16KB-64KB) reduce syscall overhead and IPC message count. VS Code and Hyper batch aggressively.

- **No flow control** — `terminal.write()` is fire-and-forget. If the PTY produces data faster than xterm.js can render, the write buffer grows unboundedly and the terminal becomes sluggish. xterm.js supports write callbacks for backpressure. ([xtermjs flow control guide](https://xtermjs.org/docs/guides/flowcontrol/))

## Phases

- [x] Phase 1: Environment & TUI compatibility (quick wins)
- [x] Phase 2: Font rendering quality
- [x] Phase 3: Missing addons
- [x] Phase 4: Performance & flow control
- [x] Phase 5: Terminal options tuning

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Environment & TUI Compatibility (Quick Wins)

**Files**: `src-tauri/src/terminal.rs`

Add missing environment variables when spawning the PTY shell:

```rust
cmd.env("TERM", "xterm-256color");        // already present
cmd.env("COLORTERM", "truecolor");         // NEW — advertise 24-bit color
cmd.env("LANG", "en_US.UTF-8");            // NEW — enable UTF-8 locale
cmd.env("LC_ALL", "en_US.UTF-8");          // NEW — consistent locale
```

**Why**: This is the single most impactful change for TUI rendering. Most TUI frameworks (ink, blessed, ncurses, crossterm) check `COLORTERM` to decide color depth and `LANG`/`LC_ALL` for character encoding. Without these, apps render with degraded palettes and broken Unicode.

**Risk**: Low. These are standard values set by iTerm2, VS Code, WezTerm, etc.

## Phase 2: Font Rendering Quality

**Files**: `src/components/content-pane/terminal-content.tsx`

1. Add CSS font smoothing to the terminal container:
```tsx
<div
  ref={containerRef}
  className="w-full h-full bg-surface-950"
  style={{
    overflow: "hidden",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  }}
/>
```

2. Remove `p-2` padding from container — let xterm.js handle its own margins via the `theme.background` fill. The padding creates a visual gutter but can cause subpixel misalignment. If a visual margin is desired, use xterm's `scrollMarginTop`/`scrollMarginBottom` or wrap in an outer div.

3. Consider adding `letterSpacing: 0` explicitly to the Terminal options to prevent any inherited spacing.

**Risk**: Low. Visual-only changes.

## Phase 3: Missing Addons

**Files**: `package.json`, `src/components/content-pane/terminal-content.tsx`

Install and load these addons:

| Addon | Purpose | Priority |
|-------|---------|----------|
| `@xterm/addon-unicode-graphemes` | Fix emoji, CJK, compound Unicode width calculation | High |
| `@xterm/addon-web-links` | Clickable URLs in terminal output | Medium |
| `@xterm/addon-clipboard` | Proper clipboard integration (OSC 52) | Medium |
| `@xterm/addon-serialize` | Serialize terminal state for reconnection (replaces raw output buffer) | Low |

```bash
pnpm add @xterm/addon-unicode-graphemes @xterm/addon-web-links @xterm/addon-clipboard
```

Load in terminal-content.tsx after terminal creation:

```ts
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";

// After terminal.open():
terminal.loadAddon(new UnicodeGraphemesAddon());
terminal.unicode.activeVersion = "15";  // or latest supported
terminal.loadAddon(new WebLinksAddon());
terminal.loadAddon(new ClipboardAddon());
```

**Risk**: Low. Addons are maintained by the xterm.js team. Unicode graphemes is marked experimental but is used by VS Code.

## Phase 4: Performance & Flow Control

### 4a. Larger PTY read buffer

**File**: `src-tauri/src/terminal.rs`

```rust
// Change from:
let mut buf = [0u8; 4096];
// To:
let mut buf = [0u8; 16384];  // 16KB — reduce syscall + IPC overhead
```

### 4b. Flow control with write backpressure

**File**: `src/components/content-pane/terminal-content.tsx` (or output-buffer module)

Use xterm.js write callback to implement backpressure. When the terminal's internal write buffer exceeds a threshold, pause reading from the PTY until it drains:

```ts
// Concept — actual implementation depends on IPC mechanism:
const HIGH_WATER = 1024 * 64;   // 64KB
const LOW_WATER = 1024 * 16;    // 16KB

// In the output handler:
const unsubOutput = onOutput(terminalId, (text) => {
  if (disposed) return;
  terminal.write(text, () => {
    // Write callback fires when data is processed
    // Could signal PTY to resume if paused
  });
});
```

Note: Full backpressure requires a pause/resume mechanism on the Rust side (e.g., stop reading from the PTY fd when the frontend is overwhelmed). This is a larger change — consider as a follow-up if basic buffer increase isn't sufficient.

### 4c. Simplify resize debounce

**File**: `src/components/content-pane/terminal-content.tsx`

The current double-debounce (requestAnimationFrame + 100ms setTimeout) is overly cautious. Simplify to a single `requestAnimationFrame` debounce which is sufficient and more responsive:

```ts
const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      // ... resize PTY
    } catch { /* container not visible */ }
  });
});
```

Or keep a single short debounce (50ms) without the nested rAF.

**Risk**: Medium for flow control (needs Rust-side changes). Low for buffer size and debounce simplification.

## Phase 5: Terminal Options Tuning

**File**: `src/components/content-pane/terminal-content.tsx`

Update Terminal constructor options:

```ts
const terminal = new Terminal({
  cursorBlink: true,
  cursorStyle: "block",
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  letterSpacing: 0,
  theme: MORT_TERMINAL_THEME,
  allowProposedApi: true,
  scrollback: 5000,                    // NEW — up from default 1000
  rescaleOverlappingGlyphs: true,      // NEW — fix powerline/box-drawing overlap
  customGlyphs: true,                  // NEW — use built-in box-drawing/powerline glyphs
  drawBoldTextInBrightColors: false,   // NEW — prevent bold text color shift
});
```

Key additions:
- **`scrollback: 5000`** — More scrollback for TUI apps that produce lots of output
- **`rescaleOverlappingGlyphs: true`** — Rescales glyphs that would bleed into adjacent cells (common with Nerd Font / powerline symbols)
- **`customGlyphs: true`** — Uses xterm.js's built-in rendering for box-drawing and block element characters instead of the font's glyphs. This is what VS Code uses — it ensures consistent rendering regardless of font, and recently expanded to ~800 characters
- **`drawBoldTextInBrightColors: false`** — Prevents bold text from being rendered in bright ANSI colors, which can cause unexpected color shifts in TUI apps

**Risk**: Low. These are well-established options.

---

## Summary: Expected Impact

| Issue | Fix | Impact |
|-------|-----|--------|
| TUI colors wrong | `COLORTERM=truecolor` | High — unlocks 24-bit color for all TUI apps |
| Unicode/emoji broken | `LANG=en_US.UTF-8` + graphemes addon | High — proper character width |
| Box-drawing glitches | `customGlyphs` + `rescaleOverlappingGlyphs` | High — clean TUI borders |
| Font blurriness | `-webkit-font-smoothing` + remove padding | Medium — crisper text |
| Powerline symbol overlap | `rescaleOverlappingGlyphs` | Medium — clean prompt symbols |
| Input lag on heavy output | Larger read buffer + flow control | Medium — smoother heavy output |
| Clickable URLs | web-links addon | Nice-to-have |
| Bold color shift | `drawBoldTextInBrightColors: false` | Nice-to-have |

## References

- [VS Code terminal renderer blog post](https://code.visualstudio.com/blogs/2017/10/03/terminal-renderer)
- [How VS Code terminal is fast](https://gist.github.com/weihanglo/8b5efd2dbc4302d123af089e510f5326)
- [VS Code terminal advanced docs](https://code.visualstudio.com/docs/terminal/advanced)
- [xterm.js flow control guide](https://xtermjs.org/docs/guides/flowcontrol/)
- [xterm.js anti-aliasing issue #2464](https://github.com/xtermjs/xterm.js/issues/2464)
- [xterm.js sub-pixel AA issue #973](https://github.com/xtermjs/xterm.js/issues/973)
- [xterm.js grapheme clustering #3304](https://github.com/xtermjs/xterm.js/issues/3304)
- [COLORTERM standard](https://github.com/termstandard/colors)
- [xterm.js addon docs](https://xtermjs.org/docs/guides/using-addons/)
- [VS Code Dec 2025 release — custom glyphs expansion](https://code.visualstudio.com/updates/v1_108)
