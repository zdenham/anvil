// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger before importing module under test
vi.mock("@/lib/logger-client", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  },
}));

// Mock document.visibilityState
let visibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  get: () => visibilityState,
  configurable: true,
});

import {
  startFrameRateMonitor,
  stopFrameRateMonitor,
  getCurrentFps,
} from "../frame-rate-monitor";
import { logger } from "@/lib/logger-client";

// Capture RAF callbacks so we can drive them manually
let rafCallbacks: Array<(time: number) => void> = [];
let rafId = 0;

beforeEach(() => {
  rafCallbacks = [];
  rafId = 0;
  visibilityState = "visible";
  vi.clearAllMocks();

  vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
    rafCallbacks.push(cb);
    return ++rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (_id: number) => {
    rafCallbacks = [];
  });
});

afterEach(() => {
  stopFrameRateMonitor();
  vi.unstubAllGlobals();
});

function simulateFrames(count: number, deltaMs: number, startTime = 0): number {
  let time = startTime;
  for (let i = 0; i < count; i++) {
    time += deltaMs;
    const cb = rafCallbacks.shift();
    if (cb) cb(time);
  }
  return time;
}

describe("frame-rate-monitor", () => {
  it("starts and stops idempotently", () => {
    startFrameRateMonitor();
    startFrameRateMonitor(); // second call is a no-op
    expect(rafCallbacks.length).toBe(1);

    stopFrameRateMonitor();
    stopFrameRateMonitor(); // second call is a no-op
  });

  it("getCurrentFps returns null before enough data", () => {
    startFrameRateMonitor({ windowSize: 60 });
    // Only simulate a few frames, not enough for a full window
    simulateFrames(10, 16.67);
    expect(getCurrentFps()).toBeNull();
  });

  it("getCurrentFps returns correct value with full window", () => {
    startFrameRateMonitor({ windowSize: 10 });
    // ~60fps = ~16.67ms per frame, need 10 frames + 1 initial RAF
    simulateFrames(11, 16.67);
    const fps = getCurrentFps();
    expect(fps).not.toBeNull();
    expect(fps!).toBeCloseTo(60, 0);
  });

  it("logs error when frame rate drops below threshold", () => {
    startFrameRateMonitor({
      windowSize: 10,
      threshold: 30,
      evalIntervalMs: 0, // evaluate immediately
    });

    // Simulate slow frames: ~20fps = 50ms per frame
    simulateFrames(11, 50);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[frame-rate] Slow frame rate detected")
    );
  });

  it("does not log when frame rate is above threshold", () => {
    startFrameRateMonitor({
      windowSize: 10,
      threshold: 30,
      evalIntervalMs: 0,
    });

    // Simulate fast frames: ~60fps
    simulateFrames(11, 16.67);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("respects evaluation interval (no log spam)", () => {
    startFrameRateMonitor({
      windowSize: 10,
      threshold: 30,
      evalIntervalMs: 2000,
    });

    // Simulate slow frames for 1 second — not enough to trigger eval (2s interval)
    // Each frame is 50ms, 20 frames = 1000ms
    simulateFrames(21, 50);

    // Should have logged at most once (the first eval at/after 2000ms may not have triggered)
    const callCount = (logger.error as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(1);
  });

  it("skips evaluation when document is not visible", () => {
    startFrameRateMonitor({
      windowSize: 10,
      threshold: 30,
      evalIntervalMs: 0,
    });

    visibilityState = "hidden";

    // Simulate slow frames
    simulateFrames(11, 50);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
