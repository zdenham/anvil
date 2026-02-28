import { logger } from "@/lib/logger-client";

export interface FrameRateMonitorOptions {
  threshold?: number;
  windowSize?: number;
  evalIntervalMs?: number;
}

class FrameRateMonitor {
  private rafId: number | null = null;
  private lastFrameTime: number = 0;
  private frameTimes: number[] = [];
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly evalIntervalMs: number;
  private lastEvalTime: number = 0;

  constructor(opts?: FrameRateMonitorOptions) {
    this.threshold = opts?.threshold ?? 30;
    this.windowSize = opts?.windowSize ?? 60;
    this.evalIntervalMs = opts?.evalIntervalMs ?? 2000;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastFrameTime = performance.now();
    this.lastEvalTime = performance.now();
    this.frameTimes = [];
    this.tick();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  getCurrentFps(): number | null {
    if (this.frameTimes.length < this.windowSize) return null;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return avg > 0 ? 1000 / avg : null;
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame((now) => {
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;

      this.frameTimes.push(delta);
      if (this.frameTimes.length > this.windowSize) {
        this.frameTimes.shift();
      }

      if (
        document.visibilityState === "visible" &&
        now - this.lastEvalTime >= this.evalIntervalMs &&
        this.frameTimes.length >= this.windowSize
      ) {
        const avgFps = this.getCurrentFps();
        if (avgFps !== null && avgFps < this.threshold) {
          logger.error(
            `[frame-rate] Slow frame rate detected: ${avgFps.toFixed(1)} FPS (threshold: ${this.threshold})`
          );
        }
        this.lastEvalTime = now;
      }

      this.tick();
    });
  };
}

let instance: FrameRateMonitor | null = null;

export function startFrameRateMonitor(opts?: FrameRateMonitorOptions): void {
  if (instance) return;
  instance = new FrameRateMonitor(opts);
  instance.start();
}

export function stopFrameRateMonitor(): void {
  instance?.stop();
  instance = null;
}

export function getCurrentFps(): number | null {
  return instance?.getCurrentFps() ?? null;
}
