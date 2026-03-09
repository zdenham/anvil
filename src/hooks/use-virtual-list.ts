/**
 * useVirtualList — React adapter for the VirtualList engine.
 *
 * Thin wiring layer that owns all DOM interaction:
 * scroll listeners, ResizeObserver, and scrollTo calls.
 * Auto-scroll decisions are delegated to ScrollCoordinator.
 */

import { useRef, useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { VirtualList, type VirtualItem, type ScrollToOptions } from "@/lib/virtual-list";
import { ScrollCoordinator } from "@/lib/scroll-coordinator";

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
  /** Enable intent-based sticky scroll (opt-in) */
  sticky?: boolean;
  /** When true, height growth triggers auto-scroll (use for streaming) */
  autoScrollOnGrowth?: boolean;
  /** Callback when sticky state changes */
  onStickyChange?: (sticky: boolean) => void;
  /** When true, re-snap to bottom after each measurement batch until heights stabilize */
  initialScrollToBottom?: boolean;
  /** Returns the content wrapper element for transform-based scroll correction */
  getContentWrapper?: () => HTMLElement | null;
}

export interface UseVirtualListResult {
  items: VirtualItem[];
  totalHeight: number;
  /** Padding above the first visible item (for flow-based layout) */
  paddingBefore: number;
  /** Padding below the last visible item (for flow-based layout) */
  paddingAfter: number;
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

  // -- ScrollCoordinator: single source of truth for sticky + auto-scroll --
  const [isStickyState, setIsStickyState] = useState(true);

  const coordinatorRef = useRef<ScrollCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new ScrollCoordinator({
      onStickyChange: (sticky) => {
        setIsStickyState(sticky);
        opts.onStickyChange?.(sticky);
        if (!sticky) pendingScrollToBottomRef.current = false;
      },
      reengageThreshold: 20,
    });
  }
  const coordinator = coordinatorRef.current;

  // Sync count changes — silent (no subscriber notification) to avoid
  // setState-during-render warnings. useSyncExternalStore's getSnapshot
  // picks up the change naturally on this render pass.
  const prevCountRef = useRef(opts.count);
  if (opts.count !== prevCountRef.current) {
    const countIncreased = opts.count > prevCountRef.current;
    prevCountRef.current = opts.count;
    list.setCount(opts.count, false);
    if (countIncreased && opts.sticky) {
      coordinator.onItemAdded();
    }
  }

  // Sync option changes (also silent during render)
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
    }, false);
  }
  prevOptsRef.current = opts;

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

  // -- Scroll listener + coordinator attach/detach --
  // useLayoutEffect so we can pre-scroll to bottom before the browser paints,
  // eliminating the flash-of-top-content on tab switch.
  useLayoutEffect(() => {
    const el = opts.getScrollElement();
    if (!el) return;

    coordinator.attach(el);

    // Pre-scroll to bottom on mount when sticky, before first paint
    if (opts.sticky && el.scrollHeight > el.clientHeight) {
      correctionRef.current = 0;
      const wrapper = getContentWrapperRef.current?.();
      if (wrapper) wrapper.style.transform = "";
      el.scrollTop = el.scrollHeight;
    }

    list.updateScroll(el.scrollTop, el.clientHeight);

    const onScroll = () => {
      // Track scrolling state for transform-based correction
      isScrollingRef.current = true;
      if (scrollIdleTimerRef.current !== null) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        scrollIdleTimerRef.current = null;
        // Absorb accumulated correction into scrollTop now that momentum stopped
        if (correctionRef.current !== 0) {
          el.scrollTop += correctionRef.current;
          const wrapper = getContentWrapperRef.current?.();
          if (wrapper) wrapper.style.transform = "";
          correctionRef.current = 0;
          list.updateScroll(el.scrollTop, el.clientHeight);
        }
      }, 150);

      // Overscroll-past-top guard — see block comment on correctionRef above.
      // Absorb entire correction in one shot when effective position would go
      // negative. scrollTop clamps to 0, giving a hard stop at the list top.
      if (correctionRef.current < 0 && el.scrollTop + correctionRef.current < 0) {
        el.scrollTop = Math.max(0, el.scrollTop + correctionRef.current);
        correctionRef.current = 0;
        const wrapper = getContentWrapperRef.current?.();
        if (wrapper) wrapper.style.transform = "";
      }

      // Feed effective scroll position (including any transform correction)
      const effectiveScrollTop = el.scrollTop + correctionRef.current;
      list.updateScroll(effectiveScrollTop, el.clientHeight);
      if (opts.sticky) {
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        coordinator.onScrollPositionChanged(gap);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    if (!opts.sticky) {
      return () => {
        if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
        coordinator.detach();
        el.removeEventListener("scroll", onScroll);
      };
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) coordinator.onUserScrolledUp();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.target === el) coordinator.onUserScrolledUp();
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);

    return () => {
      if (scrollIdleTimerRef.current !== null) clearTimeout(scrollIdleTimerRef.current);
      coordinator.detach();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
    };
  }, [list, coordinator, opts.getScrollElement, opts.sticky]);

  // -- Content growth subscriber: auto-scroll when heights change --
  useEffect(() => {
    if (!opts.sticky || !opts.autoScrollOnGrowth) return;
    const unsub = list.subscribe(() => {
      coordinator.onContentGrew();
    });
    return unsub;
  }, [list, coordinator, opts.sticky, opts.autoScrollOnGrowth]);

  // -- Viewport ResizeObserver on scroll element --
  useEffect(() => {
    const el = opts.getScrollElement();
    if (!el) return;

    const ro = new ResizeObserver(() => {
      list.updateScroll(el.scrollTop + correctionRef.current, el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [list, opts.getScrollElement]);

  // -- Per-item height measurement via a single shared ResizeObserver --
  // Ref so the RO callback (created once) can access the latest scroll element
  const getScrollElementRef = useRef(opts.getScrollElement);
  getScrollElementRef.current = opts.getScrollElement;

  // -- Transform-based scroll correction --
  //
  // When items get measured (ResizeObserver), heights above the viewport change,
  // shifting the anchor item's offset. We need to correct scrollTop to keep the
  // anchor visually stable. But during macOS momentum scrolling, writing to
  // scrollTop fights the compositor and causes visible jitter.
  //
  // Solution: accumulate corrections as CSS transforms on the content wrapper
  // (`translateY(-correction)`) and defer the scrollTop write until momentum
  // stops (the 150ms idle timer in onScroll).
  //
  // OVERSCROLL-PAST-TOP GUARD:
  // Items are often shorter than `estimateHeight`, so correction goes negative
  // (items above shrank → anchor offset decreased). The transform shifts content
  // DOWN by |correction| pixels. When the user scrolls up, scrollTop decreases
  // toward 0 while the transform keeps content pushed down — creating a blank
  // gap at the top that the user can't scroll past (scrollTop can't go negative).
  //
  // Fix: in onScroll, when `scrollTop + correction < 0`, absorb the entire
  // correction into scrollTop immediately (one-time write, clamps to 0) and
  // clear the transform. This snaps to the true list top.
  //
  // Why absorb-all instead of per-frame capping? A per-frame cap
  // (`correction = -scrollTop`) vibrates: each frame the ResizeObserver adds
  // correction for newly-measured items, then the next onScroll caps it back,
  // causing a visible oscillation. A single full absorption settles in one frame.
  //
  // The scroll container also uses `overscroll-behavior: contain` (set in
  // message-list.tsx) to prevent macOS elastic bounce at the boundary, giving
  // a hard stop when the correction is absorbed.
  const correctionRef = useRef(0);
  const isScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getContentWrapperRef = useRef(opts.getContentWrapper);
  getContentWrapperRef.current = opts.getContentWrapper;

  const roRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef(new Map<number, HTMLElement>());

  const pendingHeightsRef = useRef<Map<number, number>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const hasInitialMeasurementRef = useRef(false);
  const measureDirtyRef = useRef(false);
  const pendingScrollToBottomRef = useRef(!!opts.initialScrollToBottom);

  if (!roRef.current && opts.itemHeight === undefined) {
    roRef.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const dataIndex = target.getAttribute("data-index");
        if (dataIndex === null) continue;
        const index = parseInt(dataIndex, 10);
        const height = Math.round(
          entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight,
        );
        if (!isNaN(index) && height > 0) {
          pendingHeightsRef.current.set(index, height);
        }
      }

      // First measurement batch — flush immediately (skip throttle)
      if (!hasInitialMeasurementRef.current) {
        hasInitialMeasurementRef.current = true;
        const pending = pendingHeightsRef.current;
        if (pending.size === 0) return;
        const batch = Array.from(pending.entries()).map(([index, height]) => ({ index, height }));
        pending.clear();
        const changed = list.setItemHeights(batch);
        const el = getScrollElementRef.current();
        if (el) {
          if (pendingScrollToBottomRef.current) {
            correctionRef.current = 0;
            const wrapper = getContentWrapperRef.current?.();
            if (wrapper) wrapper.style.transform = "";
            el.scrollTop = el.scrollHeight;
            list.updateScroll(el.scrollTop, el.clientHeight);
            if (changed === 0) pendingScrollToBottomRef.current = false;
          } else if (changed !== 0) {
            if (isScrollingRef.current && getContentWrapperRef.current) {
              correctionRef.current += changed;
              const wrapper = getContentWrapperRef.current();
              if (wrapper) wrapper.style.transform = `translateY(${-correctionRef.current}px)`;
              list.updateScroll(el.scrollTop + correctionRef.current, el.clientHeight);
            } else {
              el.scrollTop += changed;
              list.updateScroll(el.scrollTop, el.clientHeight);
            }
          }
        }
        return;
      }

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const pending = pendingHeightsRef.current;
          if (pending.size === 0) return;

          const batch = Array.from(pending.entries()).map(([index, height]) => ({ index, height }));
          pending.clear();
          const changed = list.setItemHeights(batch);
          const el = getScrollElementRef.current();
          if (el) {
            if (pendingScrollToBottomRef.current) {
              correctionRef.current = 0;
              const wrapper = getContentWrapperRef.current?.();
              if (wrapper) wrapper.style.transform = "";
              el.scrollTop = el.scrollHeight;
              list.updateScroll(el.scrollTop, el.clientHeight);
              if (changed === 0) pendingScrollToBottomRef.current = false;
            } else if (changed !== 0) {
              if (isScrollingRef.current && getContentWrapperRef.current) {
                correctionRef.current += changed;
                const wrapper = getContentWrapperRef.current();
                if (wrapper) wrapper.style.transform = `translateY(${-correctionRef.current}px)`;
                list.updateScroll(el.scrollTop + correctionRef.current, el.clientHeight);
              } else {
                el.scrollTop += changed;
                list.updateScroll(el.scrollTop, el.clientHeight);
              }
            }
          }
        });
      }
    });
  }

  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
      observedRef.current.clear();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Synchronous initial measurement — read heights before first paint
  // so the browser never shows estimated-height positions.
  // Gated by dirtyRef to avoid forcing layout reflow on every render.
  useLayoutEffect(() => {
    if (!measureDirtyRef.current) return;
    measureDirtyRef.current = false;

    const observed = observedRef.current;
    if (observed.size === 0) return;

    const batch: Array<{ index: number; height: number }> = [];
    for (const [index, el] of observed) {
      const height = Math.round(el.offsetHeight);
      if (height > 0) {
        batch.push({ index, height });
      }
    }

    if (batch.length > 0) {
      // Clear any pending async measurements for these items
      for (const { index } of batch) {
        pendingHeightsRef.current.delete(index);
      }
      const changed = list.setItemHeights(batch);
      const el = opts.getScrollElement();
      if (el) {
        if (pendingScrollToBottomRef.current) {
          correctionRef.current = 0;
          const wrapper = getContentWrapperRef.current?.();
          if (wrapper) wrapper.style.transform = "";
          el.scrollTop = el.scrollHeight;
          list.updateScroll(el.scrollTop, el.clientHeight);
          if (changed === 0) pendingScrollToBottomRef.current = false;
        } else if (changed !== 0) {
          if (isScrollingRef.current && getContentWrapperRef.current) {
            correctionRef.current += changed;
            const wrapper = getContentWrapperRef.current();
            if (wrapper) wrapper.style.transform = `translateY(${-correctionRef.current}px)`;
            list.updateScroll(el.scrollTop + correctionRef.current, el.clientHeight);
          } else {
            el.scrollTop += changed;
            list.updateScroll(el.scrollTop, el.clientHeight);
          }
        }
      }
    }
  });

  const measureItem = useCallback(
    (el: HTMLElement | null) => {
      const ro = roRef.current;
      if (!ro || !el) return;

      const dataIndex = el.getAttribute("data-index");
      if (dataIndex === null) return;
      const index = parseInt(dataIndex, 10);
      if (isNaN(index)) return;

      const prev = observedRef.current.get(index);
      if (prev === el) return;
      if (prev) ro.unobserve(prev);

      observedRef.current.set(index, el);
      ro.observe(el);
      measureDirtyRef.current = true;
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

  const setSticky = useCallback((value: boolean) => {
    coordinator.setSticky(value);
  }, [coordinator]);

  const { items: snapshotItems } = snapshot;
  const lastItem = snapshotItems[snapshotItems.length - 1];
  const paddingBefore = snapshotItems[0]?.start ?? 0;
  const paddingAfter = lastItem
    ? Math.max(0, snapshot.totalHeight - (lastItem.start + lastItem.size))
    : 0;

  return {
    items: snapshotItems,
    totalHeight: snapshot.totalHeight,
    paddingBefore,
    paddingAfter,
    scrollToIndex,
    measureItem,
    isAtBottom: snapshot.isAtBottom,
    isSticky: isStickyState,
    setSticky,
    list,
  };
}
