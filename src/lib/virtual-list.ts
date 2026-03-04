/**
 * VirtualList — framework-agnostic virtual scrolling engine.
 *
 * Owns all the math, height caching, and scroll logic.
 * Never touches the DOM — receives scroll state as input,
 * emits computed virtual items as output.
 */

export interface VirtualListOptions {
  /** Total item count */
  count: number;
  /** Fixed height per item, or a function returning height for each index */
  itemHeight?: number | ((index: number) => number);
  /** Estimated height for unmeasured items (enables variable-height mode) */
  estimateHeight?: number;
  /** Extra pixels to render above/below viewport */
  overscan?: number;
  /** Distance from bottom to count as "at bottom" */
  atBottomThreshold?: number;
}

export interface VirtualItem {
  index: number;
  /** translateY offset in pixels */
  start: number;
  /** measured or fixed height in pixels */
  size: number;
  /** stable key for React */
  key: number;
}

export interface ScrollToOptions {
  index: number | "LAST";
  align?: "start" | "center" | "end";
  behavior?: ScrollBehavior;
}

export class VirtualList {
  private _count: number;
  private _itemHeight: number | ((index: number) => number) | undefined;
  private _estimateHeight: number;
  private _overscan: number;
  private _atBottomThreshold: number;

  private _scrollTop = 0;
  private _viewportHeight = 0;

  /** Per-item heights */
  private _heights: number[];
  /** Prefix-sum offsets: _offsets[i] = sum of _heights[0..i-1] */
  private _offsets: number[];

  private _listeners = new Set<() => void>();

  /** Cached computed items — invalidated on any state change */
  private _cachedItems: VirtualItem[] | null = null;
  private _cachedTotalHeight: number | null = null;
  private _prevIsAtBottom: boolean | undefined;

  constructor(opts: VirtualListOptions) {
    this._count = opts.count;
    this._itemHeight = opts.itemHeight;
    this._estimateHeight = opts.estimateHeight ?? 50;
    this._overscan = opts.overscan ?? 100;
    this._atBottomThreshold = opts.atBottomThreshold ?? 50;

    this._heights = new Array(this._count);
    this._offsets = new Array(this._count + 1);
    this._buildHeightsAndOffsets(0);
  }

  // --- Inputs ---

  updateScroll(scrollTop: number, viewportHeight: number): void {
    if (scrollTop === this._scrollTop && viewportHeight === this._viewportHeight) return;
    this._scrollTop = scrollTop;
    this._viewportHeight = viewportHeight;
    this._invalidate();
  }

  setCount(count: number, notify = true): void {
    if (count === this._count) return;
    const oldCount = this._count;
    this._count = count;

    // Resize arrays, preserving measured heights
    const newHeights = new Array(count);
    for (let i = 0; i < Math.min(oldCount, count); i++) {
      newHeights[i] = this._heights[i];
    }
    this._heights = newHeights;
    this._offsets = new Array(count + 1);

    // Rebuild from 0 since offsets array is brand new (measured heights are preserved via undefined check)
    this._buildHeightsAndOffsets(0);
    this._invalidate(notify);
  }

  setItemHeight(index: number, height: number): void {
    if (index < 0 || index >= this._count) return;
    if (this._heights[index] === height) return;
    this._heights[index] = height;
    this._rebuildOffsetsFrom(index);
    this._invalidate();
  }

  setItemHeights(entries: Array<{ index: number; height: number }>): void {
    let minChanged = this._count;
    let anyChanged = false;

    for (const { index, height } of entries) {
      if (index < 0 || index >= this._count) continue;
      if (this._heights[index] === height) continue;
      this._heights[index] = height;
      if (index < minChanged) minChanged = index;
      anyChanged = true;
    }

    if (!anyChanged) return;
    this._rebuildOffsetsFrom(minChanged);
    this._invalidate();
  }

  setOptions(opts: Partial<VirtualListOptions>, notify = true): void {
    let changed = false;

    if (opts.overscan !== undefined && opts.overscan !== this._overscan) {
      this._overscan = opts.overscan;
      changed = true;
    }
    if (opts.atBottomThreshold !== undefined && opts.atBottomThreshold !== this._atBottomThreshold) {
      this._atBottomThreshold = opts.atBottomThreshold;
      changed = true;
    }
    if (opts.estimateHeight !== undefined && opts.estimateHeight !== this._estimateHeight) {
      this._estimateHeight = opts.estimateHeight;
      changed = true;
    }
    if (opts.itemHeight !== undefined && opts.itemHeight !== this._itemHeight) {
      this._itemHeight = opts.itemHeight;
      // Force-clear heights so they get rebuilt from the new itemHeight
      this._heights = new Array(this._count);
      this._offsets = new Array(this._count + 1);
      this._buildHeightsAndOffsets(0);
      changed = true;
    }
    if (opts.count !== undefined) {
      this.setCount(opts.count, notify);
      return; // setCount already invalidates
    }

    if (changed) this._invalidate(notify);
  }

  // --- Outputs ---

  get items(): VirtualItem[] {
    if (this._cachedItems) return this._cachedItems;
    this._cachedItems = this._computeItems();
    return this._cachedItems;
  }

  get totalHeight(): number {
    if (this._cachedTotalHeight !== null) return this._cachedTotalHeight;
    this._cachedTotalHeight = this._count > 0 ? this._offsets[this._count] : 0;
    return this._cachedTotalHeight;
  }

  get isAtBottom(): boolean {
    if (this._count === 0) return true;
    const scrollBottom = this._scrollTop + this._viewportHeight;
    return this.totalHeight - scrollBottom <= this._atBottomThreshold;
  }

  getScrollTarget(opts: ScrollToOptions): { top: number; behavior: ScrollBehavior } {
    const behavior = opts.behavior ?? "auto";
    const index = opts.index === "LAST" ? this._count - 1 : opts.index;

    if (index < 0 || index >= this._count) {
      return { top: 0, behavior };
    }

    const itemOffset = this._offsets[index];
    const itemSize = this._heights[index];
    const align = opts.align ?? "start";

    let top: number;
    switch (align) {
      case "start":
        top = itemOffset;
        break;
      case "center":
        top = itemOffset - this._viewportHeight / 2 + itemSize / 2;
        break;
      case "end":
        top = itemOffset - this._viewportHeight + itemSize;
        break;
    }

    // Clamp
    top = Math.max(0, Math.min(top, this.totalHeight - this._viewportHeight));
    return { top, behavior };
  }

  // --- Subscriptions ---

  subscribe(cb: () => void): () => void {
    this._listeners.add(cb);
    return () => { this._listeners.delete(cb); };
  }

  // --- Internal ---

  private _getDefaultHeight(index: number): number {
    if (typeof this._itemHeight === "number") return this._itemHeight;
    if (typeof this._itemHeight === "function") return this._itemHeight(index);
    return this._estimateHeight;
  }

  private _buildHeightsAndOffsets(fromIndex: number): void {
    // Fill default heights for indices that don't have a measured value
    for (let i = fromIndex; i < this._count; i++) {
      if (this._heights[i] === undefined) {
        this._heights[i] = this._getDefaultHeight(i);
      }
    }

    // Rebuild prefix sums from scratch (or from fromIndex if we have a valid base)
    if (fromIndex === 0) {
      this._offsets[0] = 0;
    }
    for (let i = fromIndex; i < this._count; i++) {
      this._offsets[i + 1] = this._offsets[i] + this._heights[i];
    }
  }

  private _rebuildOffsetsFrom(index: number): void {
    for (let i = index; i < this._count; i++) {
      this._offsets[i + 1] = this._offsets[i] + this._heights[i];
    }
  }

  private _computeItems(): VirtualItem[] {
    if (this._count === 0 || this._viewportHeight === 0) return [];

    const scrollTop = this._scrollTop;
    const scrollBottom = scrollTop + this._viewportHeight;
    const overscan = this._overscan;

    // Find start index via binary search on offsets
    let startIndex = this._binarySearchOffset(Math.max(0, scrollTop - overscan));
    let endIndex = this._binarySearchOffset(scrollBottom + overscan);

    // Clamp
    startIndex = Math.max(0, startIndex);
    endIndex = Math.min(this._count - 1, endIndex);

    const items: VirtualItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        start: this._offsets[i],
        size: this._heights[i],
        key: i,
      });
    }

    return items;
  }

  /** Find the index of the item that contains the given offset */
  private _binarySearchOffset(offset: number): number {
    let lo = 0;
    let hi = this._count - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const midStart = this._offsets[mid];
      const midEnd = this._offsets[mid + 1];

      if (offset < midStart) {
        hi = mid - 1;
      } else if (offset >= midEnd) {
        lo = mid + 1;
      } else {
        return mid;
      }
    }

    return Math.min(lo, this._count - 1);
  }

  private _invalidate(notify = true): void {
    this._cachedItems = null;
    this._cachedTotalHeight = null;

    if (!notify) return;

    // Check isAtBottom transition for callbacks wired by the hook
    const currentAtBottom = this.isAtBottom;
    if (this._prevIsAtBottom !== undefined && currentAtBottom !== this._prevIsAtBottom) {
      // Transition happened — subscribers will be notified below
    }
    this._prevIsAtBottom = currentAtBottom;

    for (const cb of this._listeners) {
      cb();
    }
  }
}
