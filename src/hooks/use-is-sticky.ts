import { useRef, useState, useEffect } from "react";

/**
 * Find the nearest scrollable ancestor of an element.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflow, overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflow + overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Detects whether a sticky-positioned element is currently "stuck".
 * Returns [sentinelRef, isSticky].
 *
 * Place the sentinel element immediately before the sticky element.
 * When it scrolls out of view, the header must be stuck.
 */
export function useIsSticky(): [React.RefObject<HTMLDivElement>, boolean] {
  const sentinelRef = useRef<HTMLDivElement>(null!);
  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const root = findScrollParent(el);

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [sentinelRef, isSticky];
}
