# Frame Rate Monitor

Add an always-on frame rate monitor that detects and logs slow frame rates via `logger.error()` for later correlation with lag-causing events. The RAF loop is essentially free (a subtraction + array push per frame, averaging 60 numbers every 2s), so it runs continuously with no cleanup/toggle. Only evaluates when `document.visibilityState === "visible"` to avoid misleading readings when the window is backgrounded (browsers throttle RAF to ~1fps).

## Context

The app already has diagnostic infrastructure (heartbeat monitor, memory snapshots, diagnostic panel) that follows consistent patterns. The frame rate monitor will follow the same conventions: a standalone module in `src/lib/` with start/stop lifecycle, logging via `logger`, and optional diagnostic panel integration.

## Phases

- [x] Implement `FrameRateMonitor` class in `src/lib/frame-rate-monitor.ts`
- [x] Integrate into app startup in `src/main.tsx`
- [x] Add FPS readout to the diagnostic panel
- [x] Write unit tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: `FrameRateMonitor` class

**File**: `src/lib/frame-rate-monitor.ts`

A class that uses `requestAnimationFrame` to measure frame timing and logs when the frame rate drops below a threshold.

### Design

```ts
class FrameRateMonitor {
  private rafId: number | null = null;
  private lastFrameTime: number = 0;
  private frameTimes: number[] = [];      // rolling window of frame durations (ms)
  private readonly windowSize: number;     // frames to average over
  private readonly threshold: number;      // FPS below this triggers error log
  private readonly evalIntervalMs: number; // how often to evaluate (avoid log spam)
  private lastEvalTime: number = 0;

  constructor(opts?: { threshold?: number; windowSize?: number; evalIntervalMs?: number });

  start(): void;   // begins RAF loop, idempotent
  stop(): void;    // cancels RAF, idempotent
  getCurrentFps(): number | null;  // returns rolling avg FPS or null if not enough data
}
```

### Defaults
- **threshold**: `30` FPS — anything below this is an error. 30 FPS means frames are taking >33ms each, which is noticeable jank for a desktop app.
- **windowSize**: `60` frames — roughly 1 second of data at 60fps, smooths out single-frame spikes.
- **evalIntervalMs**: `2000` ms — evaluate every 2 seconds to avoid log spam.

### RAF loop logic
1. On each `requestAnimationFrame` callback, compute `delta = now - lastFrameTime`.
2. Push `delta` onto `frameTimes`, trim to `windowSize`.
3. If `document.visibilityState !== "visible"`, skip evaluation (backgrounded windows get throttled RAF, producing misleading low FPS readings).
4. If `now - lastEvalTime >= evalIntervalMs` and we have a full window:
   - Compute average FPS: `1000 / (sum(frameTimes) / frameTimes.length)`
   - If `avgFps < threshold`, log:
     ```
     logger.error(`[frame-rate] Slow frame rate detected: ${avgFps.toFixed(1)} FPS (threshold: ${threshold})`)
     ```
   - Update `lastEvalTime`.

### Export pattern
Follow the heartbeat store's pattern of module-level start/stop functions:

```ts
export function startFrameRateMonitor(opts?: FrameRateMonitorOptions): void;
export function stopFrameRateMonitor(): void;
export function getCurrentFps(): number | null;
```

## Phase 2: App startup integration

**File**: `src/main.tsx`

Add after existing initialization (after `initWebErrorCapture`):

```ts
import { startFrameRateMonitor } from "./lib/frame-rate-monitor";
startFrameRateMonitor();
```

This starts measuring immediately so we catch any frame drops during initial render and hydration. The monitor is fire-and-forget — no cleanup needed since it lives for the window lifetime.

## Phase 3: Diagnostic panel integration

**File**: `src/components/diagnostics/diagnostic-panel.tsx`

Add an FPS readout section to the diagnostic panel, between the Memory section and the Diagnostic Modules section. Display the current FPS with a color indicator:

- Green (>=50 FPS): healthy
- Amber (30-50 FPS): degraded
- Red (<30 FPS): slow

Use a 1-second polling interval via `setInterval` + `getCurrentFps()` to update the display. This keeps the monitor itself decoupled from React — the panel just reads the current value.

## Phase 4: Unit tests

**File**: `src/lib/__tests__/frame-rate-monitor.test.ts`

Test the core logic using fake timers and mocked `requestAnimationFrame`:
- Monitor starts/stops cleanly (idempotent)
- `getCurrentFps()` returns `null` before enough data
- Slow frame simulation triggers `logger.error`
- Fast frame simulation does not trigger error log
- Evaluation interval is respected (no log spam)
