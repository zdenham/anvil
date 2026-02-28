import { describe, it, expect, vi } from "vitest";
import { VirtualList } from "../virtual-list";

describe("VirtualList", () => {
  describe("fixed-height mode", () => {
    it("computes correct item range for a viewport", () => {
      const list = new VirtualList({
        count: 100,
        itemHeight: 24,
        overscan: 0,
      });

      list.updateScroll(0, 240); // viewport fits 10 items (0-9), plus boundary item 10
      const items = list.items;

      expect(items[0].index).toBe(0);
      expect(items[items.length - 1].index).toBe(10);
      expect(items).toHaveLength(11);
    });

    it("applies overscan correctly", () => {
      const list = new VirtualList({
        count: 100,
        itemHeight: 24,
        overscan: 48, // 2 extra items worth
      });

      // Scroll to middle
      list.updateScroll(480, 240); // items 20-29 visible
      const items = list.items;

      // Should include overscan items before and after (plus boundary)
      expect(items[0].index).toBe(18); // 20 - 2 overscan
      expect(items[items.length - 1].index).toBe(32); // 29 + 2 overscan + 1 boundary
    });

    it("computes correct start offsets", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 30,
        overscan: 0,
      });

      list.updateScroll(0, 300);
      const items = list.items;

      expect(items[0].start).toBe(0);
      expect(items[1].start).toBe(30);
      expect(items[2].start).toBe(60);
    });

    it("reports correct totalHeight", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });

      expect(list.totalHeight).toBe(1200); // 50 * 24
    });

    it("returns empty items when count is 0", () => {
      const list = new VirtualList({
        count: 0,
        itemHeight: 24,
      });

      list.updateScroll(0, 500);
      expect(list.items).toHaveLength(0);
      expect(list.totalHeight).toBe(0);
    });
  });

  describe("function-based itemHeight", () => {
    it("uses per-index heights and binary search", () => {
      // Headers 24px, items 22px
      const list = new VirtualList({
        count: 10,
        itemHeight: (i) => (i % 3 === 0 ? 24 : 22),
        overscan: 0,
      });

      // Verify heights: [24, 22, 22, 24, 22, 22, 24, 22, 22, 24]
      // Offsets: [0, 24, 46, 68, 92, 114, 136, 160, 182, 204, 228]
      expect(list.totalHeight).toBe(228);

      list.updateScroll(0, 100);
      const items = list.items;

      expect(items[0].start).toBe(0);
      expect(items[0].size).toBe(24);
      expect(items[1].start).toBe(24);
      expect(items[1].size).toBe(22);
    });
  });

  describe("getScrollTarget", () => {
    it("align: start — returns item offset", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      const target = list.getScrollTarget({ index: 10, align: "start" });
      expect(target.top).toBe(240); // 10 * 24
    });

    it("align: center — centers item in viewport", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      const target = list.getScrollTarget({ index: 10, align: "center" });
      // offset=240, center = 240 - 120 + 12 = 132
      expect(target.top).toBe(132);
    });

    it("align: end — aligns item to bottom of viewport", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      const target = list.getScrollTarget({ index: 10, align: "end" });
      // offset=240, end = 240 - 240 + 24 = 24
      expect(target.top).toBe(24);
    });

    it("index: LAST — targets the last item", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      const target = list.getScrollTarget({ index: "LAST", align: "end" });
      // last item offset = 49 * 24 = 1176, end = 1176 - 240 + 24 = 960
      expect(target.top).toBe(960);
    });

    it("clamps to valid range", () => {
      const list = new VirtualList({
        count: 5,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      // Total height = 120px, viewport = 240px — can't scroll at all
      const target = list.getScrollTarget({ index: 4, align: "start" });
      expect(target.top).toBe(0); // clamped to 0 since totalHeight < viewportHeight
    });

    it("uses provided behavior", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
      });
      list.updateScroll(0, 240);

      const target = list.getScrollTarget({ index: 10, behavior: "smooth" });
      expect(target.behavior).toBe("smooth");
    });
  });

  describe("isAtBottom", () => {
    it("returns true when scrolled to bottom", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
        atBottomThreshold: 50,
      });

      // Total = 1200, viewport = 240, scrollTop for bottom = 960
      list.updateScroll(960, 240);
      expect(list.isAtBottom).toBe(true);
    });

    it("returns true within threshold", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
        atBottomThreshold: 50,
      });

      // 30px from bottom — within threshold
      list.updateScroll(930, 240);
      expect(list.isAtBottom).toBe(true);
    });

    it("returns false when far from bottom", () => {
      const list = new VirtualList({
        count: 50,
        itemHeight: 24,
        atBottomThreshold: 50,
      });

      list.updateScroll(0, 240);
      expect(list.isAtBottom).toBe(false);
    });

    it("returns true for empty list", () => {
      const list = new VirtualList({ count: 0, itemHeight: 24 });
      expect(list.isAtBottom).toBe(true);
    });
  });

  describe("setCount", () => {
    it("resizes and preserves measured heights", () => {
      const list = new VirtualList({
        count: 5,
        estimateHeight: 50,
      });

      // Simulate measured heights
      list.setItemHeights([
        { index: 0, height: 100 },
        { index: 1, height: 80 },
        { index: 2, height: 60 },
      ]);

      list.setCount(10);

      // Old measured heights should be preserved
      list.updateScroll(0, 1000);
      const items = list.items;
      expect(items[0].size).toBe(100);
      expect(items[1].size).toBe(80);
      expect(items[2].size).toBe(60);
      // New items should use estimate
      expect(items[3].size).toBe(50);
    });

    it("handles count decrease", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      list.setCount(3);
      expect(list.totalHeight).toBe(72); // 3 * 24
    });

    it("is a no-op if count unchanged", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      const cb = vi.fn();
      list.subscribe(cb);

      list.setCount(10);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("setItemHeights", () => {
    it("updates offsets and notifies subscribers", () => {
      const list = new VirtualList({
        count: 5,
        estimateHeight: 50,
      });

      const cb = vi.fn();
      list.subscribe(cb);

      list.setItemHeights([
        { index: 1, height: 100 },
        { index: 3, height: 200 },
      ]);

      expect(cb).toHaveBeenCalledTimes(1);
      // Total: 50 + 100 + 50 + 200 + 50 = 450
      expect(list.totalHeight).toBe(450);
    });

    it("is a no-op if heights unchanged", () => {
      const list = new VirtualList({
        count: 3,
        itemHeight: 24,
      });

      const cb = vi.fn();
      list.subscribe(cb);

      // Setting to same values
      list.setItemHeights([
        { index: 0, height: 24 },
        { index: 1, height: 24 },
      ]);

      expect(cb).not.toHaveBeenCalled();
    });

    it("ignores out-of-range indices", () => {
      const list = new VirtualList({
        count: 3,
        itemHeight: 24,
      });

      const cb = vi.fn();
      list.subscribe(cb);

      list.setItemHeights([{ index: 10, height: 100 }]);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("notifies on state changes", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      const cb = vi.fn();
      list.subscribe(cb);

      list.updateScroll(100, 500);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("stops notifying after unsubscribe", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      const cb = vi.fn();
      const unsub = list.subscribe(cb);

      list.updateScroll(100, 500);
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      list.updateScroll(200, 500);
      expect(cb).toHaveBeenCalledTimes(1); // no additional call
    });

    it("supports multiple subscribers", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      list.subscribe(cb1);
      list.subscribe(cb2);

      list.updateScroll(100, 500);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe("setOptions", () => {
    it("updates overscan", () => {
      const list = new VirtualList({
        count: 100,
        itemHeight: 24,
        overscan: 0,
      });

      list.updateScroll(480, 240);
      const before = list.items.length;

      list.setOptions({ overscan: 96 }); // 4 extra items each side
      const after = list.items.length;

      expect(after).toBeGreaterThan(before);
    });

    it("updates itemHeight and rebuilds", () => {
      const list = new VirtualList({
        count: 10,
        itemHeight: 24,
      });

      expect(list.totalHeight).toBe(240);

      list.setOptions({ itemHeight: 48 });
      expect(list.totalHeight).toBe(480);
    });
  });
});
