import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScrollCoordinator } from "../scroll-coordinator";

function createMockScrollElement(overrides?: Partial<HTMLElement>) {
  return {
    scrollHeight: 2000,
    scrollTop: 1400,
    clientHeight: 500, // gap = 2000 - 1400 - 500 = 100
    ...overrides,
  } as unknown as HTMLElement;
}

describe("ScrollCoordinator", () => {
  let rafMap: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  function flushOneFrame(): void {
    const entries = [...rafMap.entries()];
    rafMap.clear();
    for (const [, cb] of entries) cb(0);
  }

  function runToCompletion(maxFrames = 200): void {
    for (let i = 0; i < maxFrames && rafMap.size > 0; i++) {
      flushOneFrame();
    }
  }

  beforeEach(() => {
    rafMap = new Map();
    nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafMap.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafMap.delete(id);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("onContentGrew when sticky animates scrollTop to bottom", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();
    runToCompletion();

    expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight);
  });

  it("onContentGrew when not sticky does nothing", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onUserScrolledUp();
    coord.onContentGrew();
    runToCompletion();

    expect(el.scrollTop).toBe(1400);
  });

  it("onItemAdded when sticky animates scrollTop to bottom", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onItemAdded();
    runToCompletion();

    expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight);
  });

  it("onItemAdded when not sticky does nothing", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onUserScrolledUp();
    coord.onItemAdded();
    runToCompletion();

    expect(el.scrollTop).toBe(1400);
  });

  it("onUserScrolledUp disengages sticky and fires callback", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    coord.onUserScrolledUp();

    expect(coord.isSticky).toBe(false);
    expect(onStickyChange).toHaveBeenCalledWith(false);
  });

  it("onScrollPositionChanged re-engages when near bottom", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    coord.onUserScrolledUp();
    onStickyChange.mockClear();

    coord.onScrollPositionChanged(15);

    expect(coord.isSticky).toBe(true);
    expect(onStickyChange).toHaveBeenCalledWith(true);
  });

  it("onScrollPositionChanged does not re-engage when far from bottom", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    coord.onUserScrolledUp();
    onStickyChange.mockClear();

    coord.onScrollPositionChanged(100);

    expect(coord.isSticky).toBe(false);
    expect(onStickyChange).not.toHaveBeenCalled();
  });

  it("multiple signals in same frame result in single animation", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onItemAdded();
    coord.onContentGrew();

    // Only one rAF scheduled — second call is a no-op
    expect(rafMap.size).toBe(1);
  });

  it("animation uses exponential decay (intermediate step check)", () => {
    const el = createMockScrollElement(); // gap = 100
    const coord = new ScrollCoordinator({ lerpFactor: 0.15 });
    coord.attach(el);

    coord.onContentGrew();
    flushOneFrame();

    // gap was 100, step = ceil(100 * 0.15) = 15
    expect(el.scrollTop).toBe(1415);
  });

  it("detach cancels running animation", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();
    expect(rafMap.size).toBe(1);

    coord.detach();
    expect(rafMap.size).toBe(0);

    // No scrollTop change since animation was cancelled before first frame
    expect(el.scrollTop).toBe(1400);
  });

  it("onUserScrolledUp stops running animation", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();
    flushOneFrame(); // one step
    const afterOneStep = el.scrollTop;
    expect(afterOneStep).toBeGreaterThan(1400);

    coord.onUserScrolledUp();
    runToCompletion();

    // No further movement after disengage
    expect(el.scrollTop).toBe(afterOneStep);
  });

  it("setSticky(true) re-engages from disengaged state", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    coord.onUserScrolledUp();
    onStickyChange.mockClear();

    coord.setSticky(true);

    expect(coord.isSticky).toBe(true);
    expect(onStickyChange).toHaveBeenCalledWith(true);
  });

  it("does not animate when already at bottom", () => {
    const el = createMockScrollElement({
      scrollHeight: 2000,
      scrollTop: 1500,
      clientHeight: 500, // gap = 0
    } as Partial<HTMLElement>);
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();
    flushOneFrame();

    // Gap was 0, tick exits immediately
    expect(el.scrollTop).toBe(1500);
    expect(rafMap.size).toBe(0);
  });

  it("does not fire callback on duplicate sticky value", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    coord.setSticky(true);

    expect(onStickyChange).not.toHaveBeenCalled();
  });

  it("animation restarts after convergence when new content arrives", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();
    runToCompletion();
    expect(el.scrollTop).toBe(1500);
    expect(rafMap.size).toBe(0);

    // Simulate new content arriving
    (el as Record<string, unknown>).scrollHeight = 2200;
    coord.onContentGrew();
    runToCompletion();

    expect(el.scrollTop).toBe(2200 - 500);
  });

  it("custom lerpFactor controls animation speed", () => {
    const slow = createMockScrollElement(); // gap = 100
    const fast = createMockScrollElement(); // gap = 100

    const slowCoord = new ScrollCoordinator({ lerpFactor: 0.1 });
    const fastCoord = new ScrollCoordinator({ lerpFactor: 0.3 });

    slowCoord.attach(slow);
    fastCoord.attach(fast);

    slowCoord.onContentGrew();
    fastCoord.onContentGrew();
    flushOneFrame();

    // ceil(100 * 0.1) = 10 vs ceil(100 * 0.3) = 30
    expect(slow.scrollTop).toBe(1410);
    expect(fast.scrollTop).toBe(1430);
  });
});
