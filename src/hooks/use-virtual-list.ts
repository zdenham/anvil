/**
 * useVirtualList — React adapter for the VirtualList engine.
 *
 * Thin wiring layer that owns all DOM interaction:
 * scroll listeners, ResizeObserver, and scrollTo calls.
 */

import { useRef, useCallback, useEffect, useSyncExternalStore } from "react";
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
}

export interface UseVirtualListResult {
  items: VirtualItem[];
  totalHeight: number;
  scrollToIndex: (opts: ScrollToOptions) => void;
  /** Ref callback — attach to the item container div (variable-height mode only) */
  measureRef: (el: HTMLElement | null) => void;
  isAtBottom: boolean;
  /** The VirtualList instance, for escape hatches */
  list: VirtualList;
}

// Snapshot identity cache — avoids re-renders when items haven't changed
function itemsEqual(a: VirtualItem[], b: VirtualItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].index !== b[i].index || a[i].start !== b[i].start || a[i].size !== b[i].size) {
      return false;
    }
  }
  return true;
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

  // -- useSyncExternalStore for items --
  const snapshotRef = useRef<VirtualItem[]>(list.items);

  const subscribe = useCallback(
    (cb: () => void) => list.subscribe(cb),
    [list],
  );

  const getSnapshot = useCallback(() => {
    const next = list.items;
    if (itemsEqual(snapshotRef.current, next)) return snapshotRef.current;
    snapshotRef.current = next;
    return next;
  }, [list]);

  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // -- Scroll listener on the scroll element --
  useEffect(() => {
    const el = opts.getScrollElement();
    if (!el) return;

    // Initialize with current dimensions
    list.updateScroll(el.scrollTop, el.clientHeight);

    const onScroll = () => {
      list.updateScroll(el.scrollTop, el.clientHeight);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [list, opts.getScrollElement]);

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

  // -- Variable-height measurement via ResizeObserver on item container --
  const measureElRef = useRef<HTMLElement | null>(null);
  const measureRoRef = useRef<ResizeObserver | null>(null);

  const measureRef = useCallback(
    (el: HTMLElement | null) => {
      // Tear down old observer
      if (measureRoRef.current) {
        measureRoRef.current.disconnect();
        measureRoRef.current = null;
      }

      measureElRef.current = el;
      if (!el) return;

      // Only set up measurement if we're in variable-height mode
      if (opts.itemHeight !== undefined) return;

      const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (!measureElRef.current) return;
          const children = measureElRef.current.children;
          const entries: Array<{ index: number; height: number }> = [];

          for (let i = 0; i < children.length; i++) {
            const child = children[i] as HTMLElement;
            const dataIndex = child.getAttribute("data-index");
            if (dataIndex === null) continue;
            const index = parseInt(dataIndex, 10);
            const height = child.offsetHeight;
            if (!isNaN(index) && height > 0) {
              entries.push({ index, height });
            }
          }

          if (entries.length > 0) {
            list.setItemHeights(entries);
          }
        });
      });

      ro.observe(el);
      measureRoRef.current = ro;

      // Initial measurement
      requestAnimationFrame(() => {
        if (!measureElRef.current) return;
        const children = measureElRef.current.children;
        const entries: Array<{ index: number; height: number }> = [];

        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement;
          const dataIndex = child.getAttribute("data-index");
          if (dataIndex === null) continue;
          const index = parseInt(dataIndex, 10);
          const height = child.offsetHeight;
          if (!isNaN(index) && height > 0) {
            entries.push({ index, height });
          }
        }

        if (entries.length > 0) {
          list.setItemHeights(entries);
        }
      });
    },
    [list, opts.itemHeight],
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
  const isAtBottom = list.isAtBottom;

  useEffect(() => {
    if (prevAtBottomRef.current !== undefined && prevAtBottomRef.current !== isAtBottom) {
      opts.onAtBottomChange?.(isAtBottom);
    }
    prevAtBottomRef.current = isAtBottom;
  }, [isAtBottom, opts.onAtBottomChange]);

  // -- followOutput: auto-scroll when count increases while at bottom --
  const prevFollowCountRef = useRef(opts.count);
  useEffect(() => {
    if (!opts.followOutput) return;
    if (opts.count <= prevFollowCountRef.current) {
      prevFollowCountRef.current = opts.count;
      return;
    }
    prevFollowCountRef.current = opts.count;

    // Check if we were at bottom before the count change
    const result = opts.followOutput(isAtBottom);
    if (result === false) return;

    const el = opts.getScrollElement();
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: result });
    });
  }, [opts.count, opts.followOutput, opts.getScrollElement, isAtBottom]);

  // -- followOutput: also follow height changes (streaming content growing) --
  useEffect(() => {
    if (!opts.followOutput) return;

    const unsub = list.subscribe(() => {
      if (!list.isAtBottom) return;
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
  }, [list, opts.followOutput, opts.getScrollElement]);

  return {
    items,
    totalHeight: list.totalHeight,
    scrollToIndex,
    measureRef,
    isAtBottom,
    list,
  };
}
