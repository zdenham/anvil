import { useRef, useState, useEffect } from "react";

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

    const observer = new IntersectionObserver(
      ([entry]) => setIsSticky(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [sentinelRef, isSticky];
}
