import { useRef, useCallback } from "react";

/**
 * Hook for managing screen reader announcements.
 * Uses aria-live regions to announce state changes.
 */
export function useLiveAnnouncer() {
  const announceRef = useRef<HTMLDivElement | null>(null);

  const announce = useCallback((message: string) => {
    if (announceRef.current) {
      // Clear and re-set to ensure announcement is triggered
      announceRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (announceRef.current) {
          announceRef.current.textContent = message;
        }
      });
    }
  }, []);

  const setRef = useCallback((el: HTMLDivElement | null) => {
    announceRef.current = el;
  }, []);

  return { announce, setRef };
}

interface LiveAnnouncerRegionProps {
  /** Ref setter from useLiveAnnouncer */
  setRef: (el: HTMLDivElement | null) => void;
}

/**
 * Invisible region for screen reader announcements.
 * Must be present in the DOM for announcements to work.
 */
export function LiveAnnouncerRegion({ setRef }: LiveAnnouncerRegionProps) {
  return (
    <div
      ref={setRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
