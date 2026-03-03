/**
 * useVirtualList — React adapter for the VirtualList engine.
 *
 * Thin wiring layer that owns all DOM interaction:
 * scroll listeners, ResizeObserver, and scrollTo calls.
 */

import { useRef, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { VirtualList, type VirtualItem, type ScrollToOptions } from "@/lib/virtual-list";

export type { VirtualItem, ScrollToOptions } from "@/lib/virtual-list";

export interface UseVirtualListOptions {
  count: number;
  getScrollElement: () => HTMLElement | null;
  /** Fixed height per item (skips measurement) */
  itemHeight?: number | ((index: number) => number);
  /** Estimated height for variable-height items */
  estimateHeight?: number;
  /** Extra pixels to render above/below viewport */
  overscan?: number;
  /** Callback when at-bottom state changes */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Distance from bottom to count as "at bottom" */
  atBottomThreshold?: number;
  /** Return a ScrollBehavior to auto-follow when items are added at the bottom, or false to skip */
  followOutput?: (atBottom: boolean) => ScrollBehavior | false;
  /** Enable intent-based sticky scroll (opt-in) */
  sticky?: boolean;
  /** Callback when sticky state changes */
  onStickyChange?: (sticky: boolean) => void;
}

export interface UseVirtualListResult {
  items: VirtualItem[];
  totalHeight: number;
  scrollToIndex: (opts: ScrollToOptions) => void;
  /** Ref callback — attach to each virtual item element for height measurement */
  measureItem: (el: HTMLElement | null) => void;
  isAtBottom: boolean;
  /** Whether auto-scroll is engaged (sticky mode only) */
  isSticky: boolean;
  /** Manually set sticky state (e.g., to re-engage on scroll-to-bottom click) */
  setSticky: (sticky: boolean) => void;
  /** The VirtualList instance, for escape hatches */
  list: VirtualList;
}

// Snapshot identity cache — avoids re-renders when nothing changed
function itemsEqual(a: VirtualItem[], b: VirtualItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].index !== b[i].index || a[i].start !== b[i].start || a[i].size !== b[i].size) {
      return false;
    }
  }
  return true;
}

interface VirtualSnapshot {
  items: VirtualItem[];
  totalHeight: number;
  isAtBottom: boolean;
}

function snapshotEqual(a: VirtualSnapshot, b: VirtualSnapshot): boolean {
  return (
    a.totalHeight === b.totalHeight &&
    a.isAtBottom === b.isAtBottom &&
    itemsEqual(a.items, b.items)
  );
}

export function useVirtualList(opts: UseVirtualListOptions): UseVirtualListResult {
  const listRef = useRef<VirtualList | null>(null);

  // Create once, stable across renders
  if (!listRef.current) {
    listRef.current = new VirtualList({
      count: opts.count,
      itemHeight: opts.itemHeight,
      estimateHeight: opts.estimateHeight,
      overscan: opts.overscan,
      atBottomThreshold: opts.atBottomThreshold,
    });
  }

  const list = listRef.current;

  // Sync count changes
  const prevCountRef = useRef(opts.count);
  if (opts.count !== prevCountRef.current) {
    prevCountRef.current = opts.count;
    list.setCount(opts.count);
  }

  // Sync option changes
  const prevOptsRef = useRef(opts);
  if (
    opts.overscan !== prevOptsRef.current.overscan ||
    opts.atBottomThreshold !== prevOptsRef.current.atBottomThreshold ||
    opts.itemHeight !== prevOptsRef.current.itemHeight
  ) {
    list.setOptions({
      overscan: opts.overscan,
      atBottomThreshold: opts.atBottomThreshold,
      itemHeight: opts.itemHeight,
    });
  }
  prevOptsRef.current = opts;

  // -- Sticky mode state --
  const [isSticky, setIsStickyState] = useState(true);
  const isStickyRef = useRef(true);
  const setSticky = useCallback((value: boolean) => {
    if (isStickyRef.current === value) return;
    isStickyRef.current = value;
    setIsStickyState(value);
  }, []);

  // -- useSyncExternalStore for reactive snapshot (items + totalHeight + isAtBottom) --
  const snapshotRef = useRef<VirtualSnapshot>({
    items: list.items,
    totalHeight: list.totalHeight,
    isAtBottom: list.isAtBottom,
  });

  const subscribe = useCallback(
    (cb: () => void) => list.subscribe(cb),
    [list],
  );

  const getSnapshot = useCallback((): VirtualSnapshot => {
    const next: VirtualSnapshot = {
      items: list.items,
      totalHeight: list.totalHeight,
      isAtBottom: list.isAtBottom,
    };
    if (snapshotEqual(snapshotRef.current, next)) return snapshotRef.current;
    snapshotRef.current = next;
    return next;
  }, [list]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // -- Scroll listener on the scroll element --
  useEffect(() => {
    const el = opts.getScrollElement();
    if (!el) return;

    // Initialize with current dimensions
    list.updateScroll(el.scrollTop, el.clientHeight);

    const onScroll = () => {
      list.updateScroll(el.scrollTop, el.clientHeight);

      // Re-engage sticky when user scrolls to near bottom
      if (opts.sticky && !isStickyRef.current) {
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (gap <= 20) {
          setSticky(true);
        }
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    if (!opts.sticky) {
      return () => el.removeEventListener("scroll", onScroll);
    }

    // User-intent detection: wheel-up disengages sticky
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && isStickyRef.current) {
        setSticky(false);
      }
    };

    // User-intent detection: scrollbar drag disengages sticky
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === el && isStickyRef.current) {
        setSticky(false);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
    };
  }, [list, opts.getScrollElement, opts.sticky, setSticky]);

  // -- Viewport ResizeObserver on scroll element --
  useEffect(() => {
    const el = opts.getScrollElement();
    if (!el) return;

    const ro = new ResizeObserver(() => {
      list.updateScroll(el.scrollTop, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, opts.getScrollElement]);

  // -- Per-item height measurement via a single shared ResizeObserver --
  // Items self-register by attaching `measureItem` as a ref callback.
  // No MutationObserver needed — React tells us about mounts directly.
  const roRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef(new Map<number, HTMLElement>());

  if (!roRef.current && opts.itemHeight === undefined) {
    roRef.current = new ResizeObserver((entries) => {
      const heightEntries: Array<{ index: number; height: number }> = [];
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const dataIndex = target.getAttribute("data-index");
        if (dataIndex === null) continue;
        const index = parseInt(dataIndex, 10);
        const height = Math.round(
          entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight,
        );
        if (!isNaN(index) && height > 0) {
          heightEntries.push({ index, height });
        }
      }
      if (heightEntries.length > 0) {
        requestAnimationFrame(() => {
          list.setItemHeights(heightEntries);
        });
      }
    });
  }

  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
      observedRef.current.clear();
    };
  }, []);

  const measureItem = useCallback(
    (el: HTMLElement | null) => {
      const ro = roRef.current;
      if (!ro || !el) return;

      const dataIndex = el.getAttribute("data-index");
      if (dataIndex === null) return;
      const index = parseInt(dataIndex, 10);
      if (isNaN(index)) return;

      // If the DOM element changed for this index, swap observation
      const prev = observedRef.current.get(index);
      if (prev === el) return;
      if (prev) ro.unobserve(prev);

      observedRef.current.set(index, el);
      ro.observe(el);
    },
    [],
  );

  // -- scrollToIndex --
  const scrollToIndex = useCallback(
    (scrollOpts: ScrollToOptions) => {
      const el = opts.getScrollElement();
      if (!el) return;
      const { top, behavior } = list.getScrollTarget(scrollOpts);
      el.scrollTo({ top, behavior });
    },
    [list, opts.getScrollElement],
  );

  // -- atBottomChange callback --
  const prevAtBottomRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (prevAtBottomRef.current !== undefined && prevAtBottomRef.current !== snapshot.isAtBottom) {
      opts.onAtBottomChange?.(snapshot.isAtBottom);
    }
    prevAtBottomRef.current = snapshot.isAtBottom;
  }, [snapshot.isAtBottom, opts.onAtBottomChange]);

  // -- stickyChange callback --
  const prevStickyRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevStickyRef.current !== undefined && prevStickyRef.current !== isSticky) {
      opts.onStickyChange?.(isSticky);
    }
    prevStickyRef.current = isSticky;
  }, [isSticky, opts.onStickyChange]);

  // -- followOutput: auto-scroll when count increases while at bottom --
  const prevFollowCountRef = useRef(opts.count);
  useEffect(() => {
    if (!opts.followOutput) return;
    if (opts.count <= prevFollowCountRef.current) {
      prevFollowCountRef.current = opts.count;
      return;
    }
    prevFollowCountRef.current = opts.count;

    // Check if we should follow (sticky mode uses intent, otherwise position)
    const shouldFollow = opts.sticky ? isSticky : snapshot.isAtBottom;
    const result = opts.followOutput(shouldFollow);
    if (result === false) return;

    const el = opts.getScrollElement();
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: result });
    });
  }, [opts.count, opts.followOutput, opts.getScrollElement, opts.sticky, isSticky, snapshot.isAtBottom]);

  // -- followOutput: also follow height changes (streaming content growing) --
  useEffect(() => {
    if (!opts.followOutput) return;

    const unsub = list.subscribe(() => {
      const shouldFollow = opts.sticky ? isStickyRef.current : list.isAtBottom;
      if (!shouldFollow) return;
      const result = opts.followOutput!(true);
      if (result === false) return;

      const el = opts.getScrollElement();
      if (!el) return;

      // Only scroll if we're actually behind
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap > 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: result });
      }
    });

    return unsub;
  }, [list, opts.followOutput, opts.getScrollElement, opts.sticky]);

  return {
    items: snapshot.items,
    totalHeight: snapshot.totalHeight,
    scrollToIndex,
    measureItem,
    isAtBottom: snapshot.isAtBottom,
    isSticky,
    setSticky,
    list,
  };
}
