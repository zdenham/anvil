# Heap Snapshot Analysis

**Snapshot**: `~/Downloads/snapshot-1.heapsnapshot` (274 MB file)
**Total heap self_size**: 416 MB | **Nodes**: 3.49M | **Edges**: 14M

---

## Top-Level Breakdown

| Category | Size | Notes |
|---|---|---|
| **WASM Memory (Shiki/Oniguruma)** | **206.8 MB** | Single ArrayBuffer — Shiki's oniguruma WASM engine |
| **ExternalStringData** | **74.7 MB** | Native backing store for V8 strings |
| **Code** | 39.1 MB | Compiled JS bytecode/JIT |
| **Arrays** | 23.9 MB | |
| **Objects** | 18.5 MB | |
| **Strings** | 17.3 MB | |
| **Closures** | 9.4 MB | |
| Everything else | ~26 MB | Object shapes, hidden, concat strings, etc. |

---

## Key Findings

### 1. Shiki WASM Memory — 206.8 MB (50% of heap)

A single `ArrayBuffer` holds 206.8 MB of WASM linear memory for Shiki's oniguruma regex engine. This is the **dominant memory consumer** by far. The retainer chain is:

```
ArrayBuffer (206.8 MB backing store)
  ← Memory (wasm)
  ← system/Context: wasmMemory
  ← UTF8ToString, updateGlobalBufferAndViews, emscripten_realloc_buffer, fd_write
```

This is the oniguruma WASM module used by Shiki for syntax highlighting. WASM linear memory grows but **never shrinks** — once the engine has processed enough grammars/text, the memory stays allocated permanently.

**Verdict**: This is likely the single biggest memory concern. 206 MB for syntax highlighting is excessive. Options:
- Lazy-load Shiki and only initialize when syntax highlighting is actually needed
- Use Shiki's JS engine (`@shikijs/engine-javascript`) instead of the WASM oniguruma engine — trades slight perf for dramatically lower memory
- Limit the number of loaded grammars (currently loading TS, TSX, JS, JSX, Python, Go, Rust, CSS, HTML, YAML, JSON, Shell, TOML, Markdown — that's a lot)
- Dispose and recreate the highlighter periodically if usage is intermittent

### 2. Browser Extension Content Scripts — ~59 MB in ExternalStringData

19 `ExternalStringData` entries over 2 MB each, totaling ~59 MB. The content is **browser extension bundles** injected into the webview:

- `web-client-content-script.js` (3.3 MB) — appears to be a browser extension content script
- Multiple 3.18 MB and 2.95/2.71 MB copies of similar bundled extension code

**Verdict**: These are **not your app's fault** — they're Chrome/WebView2 extension scripts injected into the renderer process. However, if this is a Tauri webview, extensions shouldn't normally be present. This may indicate the snapshot was taken from a dev server in a regular browser rather than the Tauri webview, or extensions are being injected somehow.

### 3. Duplicate File Content in Memory — ~2.2 MB wasted

- **8 copies** of `pnpm-lock.yaml` content (270 KB each = ~2.1 MB)
- **4 copies** of agent source code (`PreToolUseHookInput...` — 106 KB each)
- **8 source map data URIs** (63–147 KB each)

**Verdict**: The lockfile duplication suggests the file content viewer or diff viewer is holding multiple copies of the same file in memory. Could be the Shiki highlighter caching highlighted versions alongside raw content, or multiple React renders retaining old strings. Worth investigating whether file content is being properly deduplicated or if old highlighted results are being cleaned up.

### 4. PerformanceEventTiming Accumulation — 5,830 instances

5,830 `PerformanceEventTiming` entries are being retained. These come from Chrome's Performance Observer API and accumulate over time if not cleared.

**Verdict**: If you're using a `PerformanceObserver` for event timing, make sure to either:
- Disconnect the observer when not needed
- Clear the performance buffer periodically (`performance.clearResourceTimings()`, etc.)
- Avoid buffering with `buffered: true` unless you're actively consuming entries

### 5. TextMate Grammar Objects — 0.75 MB, 20K+ objects

| Class | Count |
|---|---|
| CaptureRule | 5,659 |
| _RegExpSource | 5,129 |
| Generator | 5,138 |
| MatchRule | 1,758 |
| BeginEndRule | 1,539 |
| IncludeOnlyRule | 852 |

**Verdict**: This is normal for Shiki/TextMate grammar loading. The count is proportional to the number of loaded language grammars. Not a leak, but reducing loaded languages would reduce this.

### 6. React Fiber Count — 4,680 FiberNodes (0.59 MB)

4,680 FiberNodes is moderate for a React app of this complexity. Not a concern.

### 7. Detached Nodes — 3.36M (misleading)

The snapshot reports 3.36M "detached" nodes, but this is a V8 heap snapshot artifact — most of these are internal V8 structures (code, hidden classes, etc.) marked with nonzero detachedness. Not indicative of DOM leaks.

### 8. Event Listeners — 8,367 EventListeners, 7,772 V8EventHandlerNonNull

These are Chrome-level listener registrations. The count is high but includes all internal framework listeners (React, Tauri IPC, etc.). Not obviously leaking based on this snapshot alone — would need a comparison snapshot to confirm growth.

---

## Actionable Recommendations (Priority Order)

### P0: Shiki WASM Memory (206 MB)

This is half the heap. Investigate switching to `@shikijs/engine-javascript` or lazy-loading the WASM engine. Even just reducing the loaded language set would help cap the WASM memory growth.

### P1: Investigate File Content Duplication

8 copies of lockfile content suggests either:
- The diff viewer is holding stale copies across re-renders
- Shiki highlighted output retains copies of source text
- File content store isn't deduplicating properly

### P2: Clear PerformanceEventTiming Buffer

5,830 accumulated timing entries. Add cleanup logic or disconnect unused observers.

### P3: Audit Extension Injection

If the 59 MB of extension scripts are present in the Tauri production build, investigate why. If this was a dev browser snapshot, this is a non-issue in production.

---

## Summary

| Issue | Size Impact | Actionability |
|---|---|---|
| Shiki WASM memory | 206.8 MB | Switch engine or lazy-load |
| Extension content scripts | ~59 MB | Likely dev-only artifact |
| File content duplication | ~2.2 MB | Fix content store/caching |
| PerformanceEventTiming | minimal | Easy fix, good hygiene |
| TextMate grammar objects | 0.75 MB | Reduce loaded languages |

The app's **own** memory footprint (excluding WASM and browser extensions) is roughly **150 MB**, which is reasonable for a Tauri app with rich UI. The Shiki WASM engine at 207 MB is the clear outlier worth addressing.
