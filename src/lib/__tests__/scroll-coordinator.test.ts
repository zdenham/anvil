import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScrollCoordinator } from "../scroll-coordinator";

function createMockScrollElement(overrides?: Partial<HTMLElement>) {
  return {
    scrollHeight: 2000,
    scrollTop: 1400,
    clientHeight: 500, // gap = 2000 - 1400 - 500 = 100
    scrollTo: vi.fn(),
    ...overrides,
  } as unknown as HTMLElement;
}

describe("ScrollCoordinator", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("onContentGrew when sticky scrolls with auto behavior", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });
  });

  it("onContentGrew when not sticky does nothing", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onUserScrolledUp(); // disengage
    coord.onContentGrew();

    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it("onItemAdded when sticky scrolls with smooth behavior", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onItemAdded();

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });
  });

  it("onItemAdded when not sticky does nothing", () => {
    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onUserScrolledUp();
    coord.onItemAdded();

    expect(el.scrollTo).not.toHaveBeenCalled();
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

    coord.onUserScrolledUp(); // disengage first
    onStickyChange.mockClear();

    coord.onScrollPositionChanged(15); // within default threshold of 20

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

  it("last behavior wins when multiple signals fire in same frame", () => {
    // Prevent rAF from firing immediately so we can queue both signals
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onItemAdded();    // requests "smooth"
    coord.onContentGrew();  // overwrites with "auto"

    // Now fire the rAF
    expect(callbacks).toHaveLength(1); // single rAF scheduled
    callbacks[0](0);

    expect(el.scrollTo).toHaveBeenCalledTimes(1);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });
  });

  it("detach cancels pending rAF", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    const el = createMockScrollElement();
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew(); // schedules rAF
    coord.detach();

    expect(cancelAnimationFrame).toHaveBeenCalled();
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

  it("does not scroll when gap <= 1 (already at bottom)", () => {
    const el = createMockScrollElement({
      scrollHeight: 2000,
      scrollTop: 1500,
      clientHeight: 500, // gap = 0
    } as Partial<HTMLElement>);
    const coord = new ScrollCoordinator();
    coord.attach(el);

    coord.onContentGrew();

    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it("does not fire callback on duplicate sticky value", () => {
    const onStickyChange = vi.fn();
    const coord = new ScrollCoordinator({ onStickyChange });

    // Already sticky, setting sticky again should be a no-op
    coord.setSticky(true);

    expect(onStickyChange).not.toHaveBeenCalled();
  });
});
