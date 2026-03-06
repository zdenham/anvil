import { useEffect, type RefObject } from "react";

/**
 * Adds an `is-scrolling` class to the referenced element while it is
 * actively scrolling. Removes it after a short debounce once scrolling stops.
 *
 * Useful for hiding hover-triggered UI (e.g. gutter buttons) during scroll
 * to prevent visual jank.
 */
export function useScrolling(ref: RefObject<HTMLElement | null>, debounceMs = 150) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: number;
    let scrolling = false;

    const onScroll = () => {
      if (!scrolling) {
        scrolling = true;
        el.classList.add("is-scrolling");
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        scrolling = false;
        el.classList.remove("is-scrolling");
      }, debounceMs);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [ref, debounceMs]);
}
