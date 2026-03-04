# Heap Timeline Analysis

**File**: `~/Downloads/timeline-heap.heaptimeline` (124 MB, allocation tracking enabled)
**Total heap self_size**: 95.04 MB | **Nodes**: 1.36M | **Edges**: 5.96M

Compared to the previous `snapshot-1.heapsnapshot` (416 MB), the Shiki WASM 207MB allocation is gone — this is a much leaner snapshot. The remaining 95MB is predominantly your app's actual runtime footprint.

---

## Top-Level Breakdown

| Category | Size | % | Notes |
|---|---|---|---|
| **ExternalStringData** | 36.75 MB | 38.7% | Native string backing store (2,752 objects) |
| Code (compiled JS) | 19.89 MB | 20.9% | Bytecode + JIT |
| Strings | 10.01 MB | 10.5% | V8 string heap |
| Arrays | 8.70 MB | 9.2% | |
| Objects | 6.08 MB | 6.4% | 277K objects |
| Closures | 5.06 MB | 5.3% | 178K closures |
| Object shapes | 3.67 MB | 3.9% | |
| Hidden (V8 internal) | 2.56 MB | 2.7% | |
| Everything else | ~2.3 MB | | concat strings, numbers, regexp, etc. |

---

## Key Findings

### 1. ExternalStringData — 36.75 MB (38.7% of heap)

2,752 `ExternalStringData` objects hold 36.75 MB. These are strings backed by native memory (outside V8's managed heap), typically from WebView/browser extension injection, source map data URIs, and large file content.

Top string consumers identified:
- **pnpm-lock.yaml**: 4 copies in memory (2× 270.5 KB + 2× 269.1 KB = ~1.08 MB)
- **Compiled Tailwind CSS**: 175 KB single string (the full `@import url(...)` stylesheet)
- **Vite source maps**: 147 strings over 10KB, mostly `data:application/json;base64,...` — totaling several MB
- **Vite HMR client source map**: 147 KB base64 string
- **3 identical copies of a stdout JSON blob**: 3× 60.6 KB = 182 KB

The source maps are expected in dev mode (Vite HMR injects inline source maps). In production builds this category would shrink dramatically.

**Actionable**: The pnpm-lock.yaml quadruplication indicates the file content viewer or diff system retains multiple copies when viewing that file. The 3 identical stdout JSON blobs suggest a stale data issue in the thread content renderer.

### 2. PerformanceEventTiming — 6,064 instances (0.79 MB)

Up from 5,830 in the previous snapshot. These are Chrome `PerformanceObserver` entries that accumulate unboundedly.

**No PerformanceObserver is registered by app code** (grep found zero matches in `src/`). This means either:
- A browser extension is registering the observer
- Chrome DevTools itself creates them when the Performance panel is active
- The Tauri WebView internally registers one

**Actionable**: Add periodic cleanup: `performance.clearMeasures(); performance.clearMarks();` on a timer, or call `performance.getEntriesByType("event").length` to monitor accumulation and clear when it exceeds a threshold.

### 3. Thread State Cache — No Eviction Strategy

`useThreadStore.threadStates` (`src/entities/threads/store.ts:23`) caches full thread state JSON for every thread that has been viewed. There is **no LRU eviction, no max size, and no cleanup when switching threads**.

The `setThreadState` method only adds entries; nothing removes them except `_applyDelete` (archive). Over a session where the user views multiple threads with large conversation histories, this can grow to tens of MB.

From `memory-snapshot.ts`, the estimation is ~2KB per message + ~1KB per tool state. A thread with 100 messages and 50 tool states = ~250KB. Viewing 20 threads = ~5MB stuck in memory permanently.

Additionally, `structuredClone(currentState)` at `listeners.ts:176` creates a full deep copy of the entire thread state on **every single delta patch event** during streaming. For a thread with hundreds of messages, this is a significant transient allocation burst.

**Actionable**:
- Add LRU eviction to `threadStates` — only keep the active thread + 2-3 recently viewed threads
- Replace `structuredClone` with `fast-json-patch`'s built-in immutable apply (or apply patches in-place since the store already creates a new reference)

### 4. Allocation Hot Spots (from allocation traces)

| Size | Allocs | Location | What |
|---|---|---|---|
| 92.2 KB | 1,966 | `FiberNode` (React internals) | React fiber allocation — normal |
| 56.2 KB | 81 | `invoke.ts:162` (anonymous) | WebSocket reconnect timer closures |
| 17.7 KB | 411 | `toString` (native) | String conversion overhead |
| 2.5 KB | 80 | `updateFiberRecursively` (React DevTools ext) | DevTools extension overhead |
| 0.5 KB | 17 | `readText` @ `app-data-store.ts:55` | Frequent disk reads |
| 0.5 KB | 15 | `startStream` @ `gateway/client.ts:32` | Gateway stream setup |
| 0.8 KB | 36 | `dispatchSetState` (React) | Zustand state updates |

The `invoke.ts:162` allocation (56.2 KB from 81 calls) is inside the `scheduleReconnect` closure. Each reconnect attempt creates new `setTimeout` + `Promise` closures that allocate. This is benign if reconnect succeeds quickly, but if the WebSocket keeps disconnecting, closures pile up.

**Actionable**: The reconnect logic already caps at 10s backoff. Minor — but could add a max reconnect attempt count or dispose pending timers more aggressively in `disconnectWs()`.

### 5. Detached DOM Elements — 508 objects (0.07 MB)

| Element | Count | Size |
|---|---|---|
| SVGPathElement | 82 | 12.2 KB |
| SVGSVGElement | 50 | 10.2 KB |
| HTMLDocument | 2 | 6.4 KB |
| Text nodes | 27 | 2.5 KB |
| SVG shapes (circle, rect, line) | 38 | 6.2 KB |
| `<div class="px-4 py-2 ...">` | 13 | 1.4 KB |
| `<article role="article" ...>` (assistant messages) | 11 | 1.2 KB |
| `<button aria-label="Copy command">` | 6 | 1.1 KB |

The detached SVG elements (170 total) are unmounted icon components (likely Lucide icons) that are retained by React's fiber tree or event listeners. The detached `<article>` and `<div>` elements correspond to unmounted thread message components.

**Actionable**: Low priority at 0.07 MB. However, the pattern of detached assistant message DOM (`<article role="article">`) suggests message components may hold references (closures, refs) that prevent GC after scrolling out of the virtualized list. Worth checking that the virtual list properly unmounts message components.

### 6. Object & Closure Count

- **150,196 plain Objects** (3.36 MB) — normal for an app of this size
- **96,568 closures** (2.74 MB) — somewhat high. The event bridge registers listeners for all ~35 broadcast events on every window, plus mitt handlers for each. Each `eventBus.on()` creates a closure.
- **74,726 Arrays** (1.14 MB) — normal

### 7. Logger Queue — Unbounded in-flight batches

`logger-client.ts` flushes on a 500ms timer, but each `flushQueue()` call fires an `invoke("web_log_batch", { entries })` and doesn't track whether the previous batch completed. If the WebSocket is slow or disconnected, batches pile up as unresolved Promises holding log entry arrays.

**Actionable**: Add a max queue size and drop oldest entries when exceeded. Also consider not retrying failed batches.

---

## Comparison with Previous Snapshot

| Metric | Previous (snapshot-1) | Current (timeline) | Change |
|---|---|---|---|
| Total heap | 416 MB | 95 MB | -77% |
| Shiki WASM | 206.8 MB | 0 MB | Eliminated |
| ExternalStringData | 74.7 MB | 36.75 MB | -51% |
| PerformanceEventTiming | 5,830 | 6,064 | +4% (still accumulating) |
| FiberNodes | 4,680 | 1,733 | -63% |
| pnpm-lock copies | 8 copies | 4 copies | -50% (still duplicated) |

The Shiki WASM removal is the biggest win. The remaining 95MB heap is reasonable for a Tauri app, but has room for optimization.

---

## Recommendations (Priority Order)

### P0: Thread State Cache Eviction
**Impact**: Prevents unbounded growth over long sessions
**File**: `src/entities/threads/store.ts`
- Add LRU cache with max 3-5 entries to `threadStates`
- Evict on `setActiveThread` — remove states for threads that aren't active or recently active
- This is the only in-memory store with no size bound that can grow proportional to user activity

### P1: Eliminate structuredClone in Delta Patching
**Impact**: Eliminates transient allocation spikes during streaming
**File**: `src/entities/threads/listeners.ts:176`
- `structuredClone(currentState)` deep-copies the entire thread state (~250KB+) on every delta event
- `fast-json-patch` supports immutable mode, or patches can be applied to a fresh shallow copy instead

### P2: Clear PerformanceEventTiming Buffer
**Impact**: Prevents slow accumulation of 6K+ entries
**File**: `src/main.tsx` or a cleanup utility
- Add periodic `performance.clearResourceTimings()` and clear event timing entries
- Or simply ignore if this is a DevTools/extension artifact

### P3: Investigate pnpm-lock.yaml Quadruplication
**Impact**: ~1 MB wasted
**Files**: File content viewer, diff viewer
- Check if viewing a file in the diff viewer retains multiple copies (raw + highlighted + previous version)
- May need content deduplication or cleanup on navigation away

### P4: Logger Queue Bounds
**Impact**: Prevents unbounded growth during WS disconnects
**File**: `src/lib/logger-client.ts`
- Cap `queue` array at e.g. 500 entries
- Drop oldest when cap exceeded

---

## Phases

- [ ] Add LRU eviction to threadStates (P0)
- [ ] Replace structuredClone with efficient patching (P1)
- [ ] Add PerformanceEventTiming cleanup (P2)
- [ ] Investigate and fix file content duplication (P3)
- [ ] Add logger queue bounds (P4)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Raw Data Reference

<details>
<summary>Top 30 constructors by size</summary>

```
ExternalStringData:     36.75 MB (2,752 objects)
(object properties):     5.74 MB (9,891 objects)
Object:                  3.36 MB (150,196 objects)
(closure):               2.74 MB (96,568 objects)
(object elements):       2.01 MB (72,671 objects)
system / Map:            1.77 MB (46,639 objects)
(shared function info):  1.67 MB (36,470 objects)
system / DescriptorArray:1.62 MB (15,471 objects)
system / TrustedByteArray:1.54 MB (14,485 objects)
system / UncompiledData: 1.47 MB (77,161 objects)
(code):                  1.41 MB (1,788 objects)
system / FeedbackCell:   1.40 MB (92,067 objects)
system / ScopeInfo:      1.39 MB (23,673 objects)
system / BytecodeArray:  1.17 MB (4,235 objects)
Array:                   1.14 MB (74,726 objects)
```

</details>

<details>
<summary>App-specific allocation sites</summary>

```
56.2 KB | 81 allocs  | (anon)       @ invoke.ts:162 (reconnect timer)
 0.5 KB | 17 allocs  | readText     @ app-data-store.ts:55
 0.5 KB | 15 allocs  | startStream  @ gateway/client.ts:32
 0.2 KB |  8 allocs  | wsInvoke     @ invoke.ts:160
 0.2 KB |  8 allocs  | flushQueue   @ logger-client.ts:21
 0.1 KB |  3 allocs  | getBaseDir   @ app-data-store.ts:10
 0.1 KB |  3 allocs  | setState     @ zustand:12
```

</details>
